import { describe, expect, test } from "bun:test";

import {
	PusherConnectionManager,
	type PusherModule,
} from "../../src/client/realtime/pusher-connection.js";
import { PusherRealtimeTransport } from "../../src/client/realtime/pusher.js";
import {
	createRealtimeClientSession,
	RealtimeCrdtBindingRejectedError,
} from "../../src/client/realtime/session.js";
import { SseConnectionManager } from "../../src/client/realtime/sse-connection.js";

const encoder = new TextEncoder();

async function waitFor(
	assertion: () => boolean,
	timeoutMs = 3_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for assertion");
}

function within<T>(promise: Promise<T>, timeoutMs = 200): Promise<T> {
	return Promise.race([
		promise,
		Bun.sleep(timeoutMs).then(() => {
			throw new Error("Timed out waiting for promise");
		}),
	]);
}

class FakePusherChannel {
	private readonly listeners = new Map<string, Set<(value: unknown) => void>>();

	bind(event: string, callback: (value: unknown) => void): this {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return this;
	}

	unbind(): this {
		this.listeners.clear();
		return this;
	}

	emit(event: string, value: unknown): void {
		for (const callback of this.listeners.get(event) ?? []) callback(value);
	}
}

class FakePusherConnection {
	readonly state = "connected";
	readonly socket_id = "1.2";
	private readonly listeners = new Map<string, Set<(value: unknown) => void>>();

	bind(event: string, callback: (value: unknown) => void): this {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return this;
	}
}

class FakePusher {
	static instances: FakePusher[] = [];
	readonly channel = new FakePusherChannel();
	readonly connection = new FakePusherConnection();
	disconnected = false;

	constructor(
		readonly key: string,
		readonly options: {
			channelAuthorization: {
				customHandler: (
					input: { socketId: string; channelName: string },
					callback: (error: Error | null, auth: unknown) => void,
				) => void;
			};
		},
	) {
		FakePusher.instances.push(this);
	}

	subscribe(channelName: string): FakePusherChannel {
		this.options.channelAuthorization.customHandler(
			{ socketId: "1.2", channelName },
			(error) => {
				if (error) throw error;
			},
		);
		return this.channel;
	}

	unsubscribe(): void {}

	disconnect(): void {
		this.disconnected = true;
	}
}

describe("internal CRDT realtime session", () => {
	test("rejects and releases an initial SSE hold on a permanent HTTP failure", async () => {
		let requests = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async () => {
				requests += 1;
				return Response.json({ error: "unauthorized" }, { status: 401 });
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});

		await expect(within(manager.acquire())).rejects.toThrow(
			"Realtime connection failed: 401",
		);
		await Bun.sleep(20);
		expect(requests).toBe(1);
	});

	test("rejects and releases an initial SSE hold on an incompatible session protocol", async () => {
		let requests = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async () => {
				requests += 1;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									`event: session\ndata: ${JSON.stringify({
										sessionId: "old-edge",
										token: "old-token",
										control: {
											protocol: "questpie-realtime-topology",
											versions: [1],
										},
									})}\n\n`,
								),
							);
						},
					}),
				);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});

		await expect(within(manager.acquire())).rejects.toThrow(
			"Realtime server does not support desired topology v2",
		);
		await Bun.sleep(20);
		expect(requests).toBe(1);
	});

	test("keeps an initial SSE hold across a transient failure and reconnects", async () => {
		let requests = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				requests += 1;
				if (requests === 1) {
					return Response.json({ error: "unavailable" }, { status: 503 });
				}
				let streamController:
					| ReadableStreamDefaultController<Uint8Array>
					| undefined;
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({
									sessionId: "recovered-edge",
									token: "recovered-token",
									control: {
										protocol: "questpie-realtime-topology",
										versions: [2],
									},
								})}\n\n`,
							),
						);
					},
				});
				init?.signal?.addEventListener("abort", () => {
					try {
						streamController?.close();
					} catch {
						// The test stream may already be closed.
					}
				});
				return new Response(stream);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});

		const capability = await within(manager.acquire());
		expect(capability).toMatchObject({
			sessionId: "recovered-edge",
			token: "recovered-token",
		});
		expect(requests).toBe(2);
		capability.release();
	});

	test("reconnects an established SSE epoch after a retryable socket failure without a terminal resource error", async () => {
		const opens: Record<string, unknown>[] = [];
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const delivered: number[] = [];
		const errors: Error[] = [];
		const epochEnds: Error[] = [];
		let sinceSeq = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				opens.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				const streamIndex = opens.length - 1;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streamControllers.push(controller);
							controller.enqueue(
								encoder.encode(
									`event: session\ndata: ${JSON.stringify({
										sessionId: `edge-${streamIndex + 1}`,
										token: `control-${streamIndex + 1}`,
										control: {
											protocol: "questpie-realtime-topology",
											versions: [2],
										},
									})}\n\n`,
								),
							);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const release = manager.registerChannel({
			id: "channel:news",
			openPayload: () => ({
				id: "channel:news",
				channel: "news",
				sinceSeq,
			}),
			desiredPayload: () => ({
				kind: "channel",
				id: "channel:news",
				channel: "news",
				sinceSeq,
			}),
			onEvent: (event) => {
				const payload = JSON.parse(event.data) as { seq?: unknown };
				if (typeof payload.seq !== "number") return;
				sinceSeq = payload.seq;
				delivered.push(payload.seq);
			},
			onError: (error) => errors.push(error),
			onEpochEnd: (error) => epochEnds.push(error),
		});

		await waitFor(() => streamControllers.length === 1);
		streamControllers[0]!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${JSON.stringify({ topologyEntryId: "channel:news", seq: 1 })}\n\n`,
			),
		);
		await waitFor(() => delivered.length === 1);
		streamControllers[0]!.error(
			new Error("The socket connection was closed unexpectedly"),
		);

		await waitFor(() => streamControllers.length === 2);
		expect(opens).toEqual([
			{
				topics: [],
				channels: [{ id: "channel:news", channel: "news", sinceSeq: 0 }],
			},
			{
				topics: [],
				channels: [{ id: "channel:news", channel: "news", sinceSeq: 1 }],
			},
		]);
		streamControllers[1]!.enqueue(
			encoder.encode(
				[
					`event: channel_event\ndata: ${JSON.stringify({ topologyEntryId: "channel:news", seq: 2 })}`,
					`event: channel_event\ndata: ${JSON.stringify({ topologyEntryId: "channel:news", seq: 3 })}`,
					"",
				].join("\n\n"),
			),
		);
		await waitFor(() => delivered.length === 3);

		expect(delivered).toEqual([1, 2, 3]);
		expect(epochEnds.map((error) => error.message)).toEqual([
			"The socket connection was closed unexpectedly",
		]);
		expect(errors).toEqual([]);
		release();
	});

	test("fails closed when an established SSE resource reconnect receives a permanent authorization response", async () => {
		let requests = 0;
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const errors: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async () => {
				requests += 1;
				if (requests > 1) {
					return Response.json({ error: "unauthorized" }, { status: 401 });
				}
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streamController = controller;
							controller.enqueue(
								encoder.encode(
									`event: session\ndata: ${JSON.stringify({
										sessionId: "authorized-edge",
										token: "authorized-control",
										control: {
											protocol: "questpie-realtime-topology",
											versions: [2],
										},
									})}\n\n`,
								),
							);
						},
					}),
				);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const release = manager.registerChannel({
			id: "channel:private",
			openPayload: () => ({ id: "channel:private" }),
			desiredPayload: () => ({ kind: "channel", id: "channel:private" }),
			onEvent: () => {},
			onError: (error) => errors.push(error),
		});

		try {
			await waitFor(() => !!streamController);
			streamController!.error(new Error("socket closed"));
			await waitFor(() => requests >= 2);
			await Bun.sleep(20);
			expect(errors.map((error) => error.message)).toEqual([
				"Realtime connection failed: 401",
			]);
			expect(requests).toBe(2);
		} finally {
			release();
		}
	});

	test("opens one control-only SSE edge for CRDT and releases it after the final reference", async () => {
		const opens: Record<string, unknown>[] = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let openAborted = false;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({ transport: "sse" });
			}
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			opens.push(body);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamController = controller;
					controller.enqueue(
						encoder.encode(
							`event: session\ndata: ${JSON.stringify({
								sessionId: "edge-1",
								token: "control-1",
								control: {
									protocol: "questpie-realtime-topology",
									versions: [2],
								},
							})}\n\n`,
						),
					);
				},
			});
			init?.signal?.addEventListener("abort", () => {
				openAborted = true;
				try {
					streamController?.close();
				} catch {
					// The test stream may already be closed.
				}
			});
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		};
		const sse = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher,
			debounceMs: 0,
		});
		const session = createRealtimeClientSession({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher,
			sseConnection: sse,
		});

		const capability = await session.acquire();

		expect(capability.sessionId).toBe("edge-1");
		expect(capability.token).toBe("control-1");
		expect(opens).toEqual([{ topics: [], channels: [], crdtHold: true }]);
		expect(openAborted).toBe(false);

		capability.release();
		await waitFor(() => openAborted);
		session.destroy();
	});

	test("shares one SSE edge across a live query and two exact CRDT bindings", async () => {
		const opens: Record<string, unknown>[] = [];
		const controls: Record<string, unknown>[] = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let openAborted = false;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({ transport: "sse" });
			}
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				controls.push(body);
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			opens.push(body);
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamController = controller;
					controller.enqueue(
						encoder.encode(
							`event: session\ndata: ${JSON.stringify({
								sessionId: "edge-shared",
								token: "control-shared",
								control: {
									protocol: "questpie-realtime-topology",
									versions: [2],
								},
							})}\n\n`,
						),
					);
				},
			});
			init?.signal?.addEventListener("abort", () => {
				openAborted = true;
				try {
					streamController?.close();
				} catch {
					// The test stream may already be closed.
				}
			});
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		};
		const session = createRealtimeClientSession({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher,
		});
		const stopQuery = session.subscribe(
			{
				resourceType: "collection",
				resource: "articles",
				operation: "find",
			},
			() => {},
		);
		const [first, second] = await Promise.all([
			session.acquire(),
			session.acquire(),
		]);
		let firstDirty = 0;
		let secondDirty = 0;
		const releaseFirst = await first.register({
			kind: "crdt",
			id: "crdt:first",
			bindingId: "binding-first",
			onDirty: () => {
				firstDirty += 1;
			},
			onError: () => {},
		});
		const releaseSecond = await second.register({
			kind: "crdt",
			id: "crdt:second",
			bindingId: "binding-second",
			onDirty: () => {
				secondDirty += 1;
			},
			onError: () => {},
		});

		await waitFor(() => controls.length > 0);
		const latestControl = controls.at(-1) as {
			topology: { subscriptions: unknown[] };
		};
		expect(opens).toHaveLength(1);
		expect(latestControl.topology.subscriptions).toEqual([
			{
				kind: "query",
				id: expect.any(String),
				topic: {
					resourceType: "collection",
					resource: "articles",
					operation: "find",
				},
			},
			{ kind: "crdt", id: "crdt:first", bindingId: "binding-first" },
			{ kind: "crdt", id: "crdt:second", bindingId: "binding-second" },
		]);

		streamController?.enqueue(
			encoder.encode(
				[
					`event: crdt_dirty\ndata: ${JSON.stringify({
						topologyEntryId: "crdt:first",
					})}`,
					`event: crdt_dirty\ndata: ${JSON.stringify({
						topologyEntryId: "crdt:first",
					})}`,
					`event: crdt_dirty\ndata: ${JSON.stringify({
						topologyEntryId: "crdt:second",
					})}`,
					"",
				].join("\n\n"),
			),
		);
		await waitFor(() => firstDirty === 1 && secondDirty === 1);
		expect(firstDirty).toBe(1);
		expect(secondDirty).toBe(1);

		const firstErrors: Error[] = [];
		releaseFirst();
		const releaseFirstAfterError = await first.register({
			kind: "crdt",
			id: "crdt:first",
			bindingId: "binding-first",
			onDirty: () => {
				firstDirty += 1;
			},
			onError: (error) => firstErrors.push(error),
		});
		streamController?.enqueue(
			encoder.encode(
				`event: error\ndata: ${JSON.stringify({
					topologyEntryId: "crdt:first",
					kind: "crdt",
					code: "REALTIME_SUBSCRIPTION_REJECTED",
					message: "CRDT realtime binding unavailable",
				})}\n\n`,
			),
		);
		await waitFor(() => firstErrors.length === 1);
		expect(firstErrors[0]).toBeInstanceOf(RealtimeCrdtBindingRejectedError);
		expect(firstErrors[0]?.message).toBe("CRDT realtime binding unavailable");
		expect(firstDirty).toBe(1);

		first.release();
		releaseFirstAfterError();
		second.release();
		releaseSecond();
		expect(openAborted).toBe(false);
		stopQuery();
		await waitFor(() => openAborted);
		session.destroy();
	});

	test("reopens a query-only SSE edge before a late CRDT acquire", async () => {
		const opens: Record<string, unknown>[] = [];
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({ transport: "sse" });
			}
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			opens.push(body);
			const index = opens.length - 1;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamControllers[index] = controller;
					controller.enqueue(
						encoder.encode(
							`event: session\ndata: ${JSON.stringify({
								sessionId: `edge-${index + 1}`,
								token: `control-${index + 1}`,
								control: {
									protocol: "questpie-realtime-topology",
									versions: [2],
								},
							})}\n\n`,
						),
					);
				},
			});
			init?.signal?.addEventListener("abort", () => {
				try {
					streamControllers[index]?.close();
				} catch {
					// The replacement may already have closed the old stream.
				}
			});
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		};
		const session = createRealtimeClientSession({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher,
		});
		const stopQuery = session.subscribe(
			{
				resourceType: "collection",
				resource: "articles",
				operation: "find",
			},
			() => {},
		);
		await waitFor(() => opens.length === 1);

		const capability = await session.acquireEdgeCapability();

		expect(capability.sessionId).toBe("edge-2");
		expect(opens).toHaveLength(2);
		expect(opens[0]).not.toHaveProperty("crdtHold");
		expect(opens[1]).toMatchObject({ crdtHold: true });
		expect(opens[1]?.topics).toEqual([
			expect.objectContaining({ resource: "articles" }),
		]);

		capability.release();
		stopQuery();
		session.destroy();
	});

	test("replays exact CRDT topology after an SSE edge reconnect", async () => {
		const opens: Record<string, unknown>[] = [];
		const controls: Record<string, unknown>[] = [];
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		let dirty = 0;
		let activeStreamAborted = false;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				controls.push(body);
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			opens.push(body);
			const streamIndex = opens.length - 1;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamControllers.push(controller);
					controller.enqueue(
						encoder.encode(
							`event: session\ndata: ${JSON.stringify({
								sessionId: `edge-${streamIndex + 1}`,
								token: `control-${streamIndex + 1}`,
								control: {
									protocol: "questpie-realtime-topology",
									versions: [2],
								},
							})}\n\n`,
						),
					);
				},
			});
			init?.signal?.addEventListener("abort", () => {
				if (streamIndex === 1) activeStreamAborted = true;
				try {
					streamControllers[streamIndex]?.close();
				} catch {
					// The test stream may already be closed.
				}
			});
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		};
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher,
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});

		const capability = await manager.acquire();
		const release = await capability.register({
			kind: "crdt",
			id: "crdt:article",
			bindingId: "binding-article",
			onDirty: () => {
				dirty += 1;
			},
			onError: () => {},
		});
		await waitFor(() => controls.length === 1);

		streamControllers[0]?.close();
		await waitFor(() => opens.length === 2);
		await waitFor(() => controls.length === 2);

		expect(opens).toEqual([
			{ topics: [], channels: [], crdtHold: true },
			{ topics: [], channels: [], crdtHold: true },
		]);
		expect(
			controls.map(
				(control) =>
					(control.topology as { subscriptions: unknown[] }).subscriptions,
			),
		).toEqual([
			[{ kind: "crdt", id: "crdt:article", bindingId: "binding-article" }],
			[{ kind: "crdt", id: "crdt:article", bindingId: "binding-article" }],
		]);

		streamControllers[1]?.enqueue(
			encoder.encode(
				`event: crdt_dirty\ndata: ${JSON.stringify({
					topologyEntryId: "crdt:article",
				})}\n\n`,
			),
		);
		await waitFor(() => dirty === 1);

		release();
		capability.release();
		await waitFor(() => activeStreamAborted);
	});

	test("classifies an SSE exact topology rejection without reporting dirtiness", async () => {
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				return Response.json(
					{
						error: {
							code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
							entries: [
								{
									id: "crdt:forged",
									kind: "crdt",
									code: "REALTIME_SUBSCRIPTION_REJECTED",
									message: "CRDT realtime binding unavailable",
								},
							],
						},
					},
					{ status: 400 },
				);
			}
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({
									sessionId: "edge-rejected",
									token: "control-rejected",
									control: {
										protocol: "questpie-realtime-topology",
										versions: [2],
									},
								})}\n\n`,
							),
						);
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		};
		const sse = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher,
			debounceMs: 0,
		});
		const capability = await sse.acquire();
		let dirty = 0;
		const errors: Error[] = [];

		await expect(
			capability.register({
				kind: "crdt",
				id: "crdt:forged",
				bindingId: "binding-forged",
				onDirty: () => {
					dirty++;
				},
				onError: (error) => errors.push(error),
			}),
		).rejects.toThrow("Realtime CRDT topology registration failed");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(RealtimeCrdtBindingRejectedError);
		expect(dirty).toBe(0);

		capability.release();
		try {
			streamController?.close();
		} catch {
			// The failed control request may already have aborted the stream.
		}
	});

	test("releases a CRDT binding after retryable SSE control failure so the caller can retry", async () => {
		const opens: Record<string, unknown>[] = [];
		let controls = 0;
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected request: ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (body.sessionId) {
				controls += 1;
				return Response.json(
					{ error: { code: "REALTIME_TOPOLOGY_STORAGE_UNAVAILABLE" } },
					{ status: 503 },
				);
			}
			opens.push(body);
			const sequence = opens.length;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						streamControllers.push(controller);
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({
									sessionId: `retryable-edge-${sequence}`,
									token: `retryable-control-${sequence}`,
									control: {
										protocol: "questpie-realtime-topology",
										versions: [2],
									},
								})}\n\n`,
							),
						);
						init?.signal?.addEventListener(
							"abort",
							() => controller.error(new DOMException("Aborted", "AbortError")),
							{ once: true },
						);
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		};
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher,
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const capability = await manager.acquire();
		let dirty = 0;
		const errors: Error[] = [];

		await expect(
			capability.register({
				kind: "crdt",
				id: "crdt:retryable",
				bindingId: "binding-retryable",
				onDirty: () => {
					dirty += 1;
				},
				onError: (error) => errors.push(error),
			}),
		).rejects.toThrow("Realtime CRDT topology registration failed");
		await waitFor(() => streamControllers.length === 2);
		expect(controls).toBe(1);
		expect(opens).toEqual([
			{ topics: [], channels: [], crdtHold: true },
			{ topics: [], channels: [], crdtHold: true },
		]);
		expect(errors).toEqual([]);

		streamControllers[1]!.enqueue(
			encoder.encode(
				`event: crdt_dirty\ndata: ${JSON.stringify({ topologyEntryId: "crdt:retryable" })}\n\n`,
			),
		);
		await Bun.sleep(10);
		expect(dirty).toBe(0);

		capability.release();
	});

	test("holds a zero-query Pusher edge and coalesces targeted CRDT dirty notices", async () => {
		FakePusher.instances = [];
		const opens: Record<string, unknown>[] = [];
		const controls: Record<string, unknown>[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
				});
			}
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, unknown>;
				if (body.transport === "shared-provider") {
					opens.push(body);
					return Response.json({
						transport: "shared-provider",
						sessionId: "pusher-edge",
						token: "pusher-control",
						channel: "private-questpie-rt-pusher-edge",
						control: {
							protocol: "questpie-realtime-topology",
							versions: [2],
						},
					});
				}
				controls.push(body);
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const connection = new PusherConnectionManager({
			loadPusher: async () =>
				({ default: FakePusher }) as unknown as PusherModule,
		});
		const session = createRealtimeClientSession({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher,
			refetchTopic: async () => ({}),
			pusherConnection: connection,
		});

		const capability = await session.acquireEdgeCapability();
		const dirtyLanes: string[] = [];
		const unrelatedDirtyLanes: string[] = [];
		const releaseRegistration = await capability.registerCrdt({
			id: "crdt:pusher",
			bindingId: "binding-pusher",
			onDirty: (lane) => dirtyLanes.push(lane),
			onError: () => {},
		});
		const releaseUnrelated = await capability.registerCrdt({
			id: "crdt:unrelated",
			bindingId: "binding-unrelated",
			onDirty: (lane) => unrelatedDirtyLanes.push(lane),
			onError: () => {},
		});
		await waitFor(() => controls.length > 0);

		expect(opens).toEqual([
			{ transport: "shared-provider", topics: [], crdtHold: true },
		]);
		expect(FakePusher.instances).toHaveLength(1);
		const latestControl = controls.at(-1) as {
			topology: { subscriptions: unknown[] };
		};
		expect(latestControl.topology.subscriptions).toEqual([
			{ kind: "crdt", id: "crdt:pusher", bindingId: "binding-pusher" },
			{
				kind: "crdt",
				id: "crdt:unrelated",
				bindingId: "binding-unrelated",
			},
		]);

		const invalidation = {
			sessionId: "pusher-edge",
			targets: [{ kind: "crdt", id: "crdt:pusher" }],
		};
		FakePusher.instances[0].channel.emit("questpie:invalidate", invalidation);
		FakePusher.instances[0].channel.emit("questpie:invalidate", invalidation);
		await waitFor(() => dirtyLanes.length === 2);
		expect(dirtyLanes).toEqual(["visible", "awareness"]);
		expect(unrelatedDirtyLanes).toEqual([]);

		capability.release();
		expect(FakePusher.instances[0].disconnected).toBe(false);
		releaseRegistration();
		releaseUnrelated();
		await waitFor(() => FakePusher.instances[0].disconnected);
		session.destroy();
	});

	test("reopens a query-only Pusher edge before a late CRDT acquire", async () => {
		FakePusher.instances = [];
		const opens: Record<string, unknown>[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, unknown>;
				if (body.transport !== "shared-provider") {
					return Response.json({ status: "accepted" }, { status: 202 });
				}
				opens.push(body);
				const index = opens.length;
				return Response.json({
					transport: "shared-provider",
					sessionId: `pusher-edge-${index}`,
					token: `pusher-control-${index}`,
					channel: `private-questpie-rt-pusher-edge-${index}`,
					control: {
						protocol: "questpie-realtime-topology",
						versions: [2],
					},
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const transport = new PusherRealtimeTransport({
			baseUrl: "http://localhost:3000",
			fetcher,
			config: { provider: "pusher", key: "public-key" },
			refetchTopic: async () => ({}),
			connection: new PusherConnectionManager({
				loadPusher: async () =>
					({ default: FakePusher }) as unknown as PusherModule,
			}),
		});
		const stopQuery = transport.subscribe(
			{
				resourceType: "collection",
				resource: "articles",
				operation: "find",
			},
			() => {},
			undefined,
			"query:articles",
		);
		await waitFor(() => opens.length === 1);

		const capability = await transport.acquire();

		expect(capability.sessionId).toBe("pusher-edge-2");
		expect(opens).toHaveLength(2);
		expect(opens[0]).not.toHaveProperty("crdtHold");
		expect(opens[1]).toMatchObject({ crdtHold: true });
		expect(opens[1]?.topics).toEqual([
			expect.objectContaining({ id: "query:articles", resource: "articles" }),
		]);

		capability.release();
		stopQuery();
		transport.destroy();
	});

	test("refetches only the opaque Pusher query targets in an invalidation", async () => {
		FakePusher.instances = [];
		const refetches = new Map<string, number>();
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, unknown>;
				if (body.transport === "shared-provider") {
					return Response.json({
						transport: "shared-provider",
						sessionId: "pusher-query-edge",
						token: "pusher-query-control",
						channel: "private-questpie-rt-pusher-query-edge",
						control: {
							protocol: "questpie-realtime-topology",
							versions: [2],
						},
					});
				}
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const connection = new PusherConnectionManager({
			loadPusher: async () =>
				({ default: FakePusher }) as unknown as PusherModule,
		});
		const transport = new PusherRealtimeTransport({
			baseUrl: "http://localhost:3000",
			fetcher,
			config: { provider: "pusher", key: "public-key" },
			refetchTopic: async (topic) => {
				refetches.set(topic.resource, (refetches.get(topic.resource) ?? 0) + 1);
				return {};
			},
			connection,
		});
		const stopFirst = transport.subscribe(
			{ resourceType: "collection", resource: "first", operation: "find" },
			() => {},
			undefined,
			"query:first",
		);
		const stopSecond = transport.subscribe(
			{ resourceType: "collection", resource: "second", operation: "find" },
			() => {},
			undefined,
			"query:second",
		);
		await waitFor(
			() => refetches.get("first") === 1 && refetches.get("second") === 1,
		);

		FakePusher.instances[0].channel.emit("questpie:invalidate", {
			sessionId: "pusher-query-edge",
			targets: [{ kind: "query", id: "query:first" }],
		});
		await waitFor(() => refetches.get("first") === 2);
		expect(refetches.get("second")).toBe(1);

		stopFirst();
		stopSecond();
		await waitFor(() => FakePusher.instances[0].disconnected);
		transport.destroy();
	});

	test("reopens an expired Pusher edge and lets CRDT replace its fenced binding", async () => {
		FakePusher.instances = [];
		const opens: Record<string, unknown>[] = [];
		const controls: Array<{
			sessionId: string;
			topology: { subscriptions: unknown[] };
		}> = [];
		let rejectNextProbe = false;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, any>;
				if (body.transport === "shared-provider") {
					opens.push(body);
					const generation = opens.length;
					return Response.json({
						transport: "shared-provider",
						sessionId: `pusher-edge-${generation}`,
						token: `pusher-control-${generation}`,
						channel: `private-questpie-rt-pusher-edge-${generation}`,
						control: {
							protocol: "questpie-realtime-topology",
							versions: [2],
						},
					});
				}
				controls.push(body);
				if (rejectNextProbe) {
					rejectNextProbe = false;
					return Response.json(
						{
							error: {
								code: "REALTIME_CONTROL_UNAVAILABLE",
								message: "Realtime control session is unavailable",
							},
						},
						{ status: 404 },
					);
				}
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const connection = new PusherConnectionManager({
			loadPusher: async () =>
				({ default: FakePusher }) as unknown as PusherModule,
		});
		let liveQueryRefetches = 0;
		const transport = new PusherRealtimeTransport({
			baseUrl: "http://localhost:3000",
			fetcher,
			config: { provider: "pusher", key: "public-key" },
			refetchTopic: async () => {
				liveQueryRefetches++;
				return {};
			},
			connection,
			edgeProbeIntervalMs: 10,
		});
		const stopQuery = transport.subscribe(
			{
				resourceType: "collection",
				resource: "articles",
				operation: "find",
			},
			() => {},
			undefined,
			"query:articles",
		);
		await waitFor(() => liveQueryRefetches === 1);
		const firstCapability = await transport.acquire();
		let replacement:
			| {
					capability: Awaited<ReturnType<typeof transport.acquire>>;
					release: () => void;
			  }
			| undefined;
		let replacementPromise: Promise<void> | undefined;
		const errors: Error[] = [];
		const releaseFirst = await firstCapability.register({
			kind: "crdt",
			id: "crdt:old",
			bindingId: "binding-old",
			onDirty: () => {},
			onError: (error) => {
				errors.push(error);
				replacementPromise ??= (async () => {
					const capability = await transport.acquire();
					const release = await capability.register({
						kind: "crdt",
						id: "crdt:new",
						bindingId: "binding-new",
						onDirty: () => {},
						onError: (replacementError) => errors.push(replacementError),
					});
					replacement = { capability, release };
				})();
			},
		});
		firstCapability.release();
		rejectNextProbe = true;

		await waitFor(() => errors.length > 0);
		await replacementPromise;
		await waitFor(() => opens.length === 3);
		await waitFor(() => liveQueryRefetches >= 2);
		await waitFor(() =>
			controls.some(
				(control) =>
					control.sessionId === "pusher-edge-3" &&
					control.topology.subscriptions.some(
						(subscription: any) => subscription.id === "crdt:new",
					),
			),
		);

		expect(errors[0]?.message).toBe("Realtime control session is unavailable");
		const replacementTopology = controls.find(
			(control) =>
				control.sessionId === "pusher-edge-3" &&
				control.topology.subscriptions.some(
					(subscription: any) => subscription.id === "crdt:new",
				),
		)!.topology;
		expect(replacementTopology.subscriptions).toEqual([
			{
				kind: "query",
				id: "query:articles",
				topic: {
					resourceType: "collection",
					resource: "articles",
					operation: "find",
				},
			},
			{ kind: "crdt", id: "crdt:new", bindingId: "binding-new" },
		]);

		releaseFirst();
		replacement?.capability.release();
		replacement?.release();
		stopQuery();
		transport.destroy();
	});

	test("dispatches a Pusher probe binding rejection only to its exact CRDT entry", async () => {
		FakePusher.instances = [];
		let rejectProbe = false;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, any>;
				if (body.transport === "shared-provider") {
					return Response.json({
						transport: "shared-provider",
						sessionId: "pusher-probe-edge",
						token: "pusher-probe-control",
						channel: "private-questpie-rt-pusher-probe-edge",
						control: {
							protocol: "questpie-realtime-topology",
							versions: [2],
						},
					});
				}
				if (rejectProbe) {
					rejectProbe = false;
					return Response.json(
						{
							error: {
								code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
								entries: [
									{
										id: "crdt:first",
										kind: "crdt",
										code: "REALTIME_SUBSCRIPTION_REJECTED",
										message: "CRDT realtime binding unavailable",
									},
								],
							},
						},
						{ status: 400 },
					);
				}
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const connection = new PusherConnectionManager({
			loadPusher: async () =>
				({ default: FakePusher }) as unknown as PusherModule,
		});
		const transport = new PusherRealtimeTransport({
			baseUrl: "http://localhost:3000",
			fetcher,
			config: { provider: "pusher", key: "public-key" },
			refetchTopic: async () => ({}),
			connection,
			edgeProbeIntervalMs: 10,
		});
		const queryErrors: Error[] = [];
		const stopQuery = transport.subscribe(
			{
				resourceType: "collection",
				resource: "articles",
				operation: "find",
			},
			() => {},
			undefined,
			"query:articles",
			(error) => queryErrors.push(error),
		);
		const capability = await transport.acquire();
		const firstErrors: Error[] = [];
		const secondErrors: Error[] = [];
		const releaseFirst = await capability.register({
			kind: "crdt",
			id: "crdt:first",
			bindingId: "binding-first",
			onDirty: () => {},
			onError: (error) => firstErrors.push(error),
		});
		const releaseSecond = await capability.register({
			kind: "crdt",
			id: "crdt:second",
			bindingId: "binding-second",
			onDirty: () => {},
			onError: (error) => secondErrors.push(error),
		});

		rejectProbe = true;
		await waitFor(() => firstErrors.length > 0);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(firstErrors).toHaveLength(1);
		expect(firstErrors[0]).toBeInstanceOf(RealtimeCrdtBindingRejectedError);
		expect(secondErrors).toEqual([]);
		expect(queryErrors).toEqual([]);

		releaseFirst();
		releaseSecond();
		capability.release();
		stopQuery();
		transport.destroy();
	});

	test("rejects a Pusher CRDT registration when exact topology admission fails", async () => {
		FakePusher.instances = [];
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/realtime/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
				});
			}
			if (url.endsWith("/realtime/auth")) {
				return Response.json({ auth: "signed" });
			}
			if (url.endsWith("/realtime") && init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as Record<string, any>;
				if (body.transport === "shared-provider") {
					return Response.json({
						transport: "shared-provider",
						sessionId: "pusher-edge",
						token: "pusher-control",
						channel: "private-questpie-rt-pusher-edge",
						control: {
							protocol: "questpie-realtime-topology",
							versions: [2],
						},
					});
				}
				if (
					body.topology?.subscriptions?.some(
						(entry: { bindingId?: string }) =>
							entry.bindingId === "binding-forged",
					)
				) {
					return Response.json(
						{
							error: {
								code: "REALTIME_TOPOLOGY_ENTRIES_REJECTED",
								entries: [
									{
										id: "crdt:forged",
										kind: "crdt",
										code: "REALTIME_SUBSCRIPTION_REJECTED",
										message: "CRDT realtime binding unavailable",
									},
								],
							},
						},
						{ status: 400 },
					);
				}
				return Response.json({ status: "accepted" }, { status: 202 });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const connection = new PusherConnectionManager({
			loadPusher: async () =>
				({ default: FakePusher }) as unknown as PusherModule,
		});
		const session = createRealtimeClientSession({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher,
			refetchTopic: async () => ({}),
			pusherConnection: connection,
		});
		const capability = await session.acquireEdgeCapability();
		const errors: Error[] = [];

		await expect(
			capability.registerCrdt({
				id: "crdt:forged",
				bindingId: "binding-forged",
				onDirty: () => {},
				onError: (error) => errors.push(error),
			}),
		).rejects.toBeInstanceOf(RealtimeCrdtBindingRejectedError);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toBeInstanceOf(RealtimeCrdtBindingRejectedError);

		capability.release();
		session.destroy();
	});
});
