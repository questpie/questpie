import { describe, expect, mock, test } from "bun:test";

type FakePusherOptions = {
	channelAuthorization: {
		customHandler: (
			input: { socketId: string; channelName: string },
			callback: (error: Error | null, auth: unknown) => void,
		) => void;
	};
};

class FakeChannel {
	private readonly listeners = new Map<string, Set<(data: unknown) => void>>();
	memberInfos: unknown[] = [{ id: "member-1", roomId: "one" }];
	readonly members = {
		each: (callback: (member: { info: unknown }) => void) => {
			for (const info of this.memberInfos) callback({ info });
		},
	};

	bind(event: string, callback: (data: unknown) => void): this {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return this;
	}

	unbind(): this {
		this.listeners.clear();
		return this;
	}

	emit(event: string, data: unknown): void {
		for (const callback of this.listeners.get(event) ?? []) callback(data);
	}
}

class FakePusher {
	static instances: FakePusher[] = [];
	readonly channel = new FakeChannel();
	disconnected = false;

	constructor(
		readonly key: string,
		readonly options: FakePusherOptions,
	) {
		FakePusher.instances.push(this);
	}

	subscribe(channelName: string): FakeChannel {
		if (
			channelName.startsWith("private-") ||
			channelName.startsWith("presence-")
		) {
			this.options.channelAuthorization.customHandler(
				{ socketId: "123.456", channelName },
				(error) => {
					if (error) throw error;
				},
			);
		}
		return this.channel;
	}

	unsubscribe(): void {}

	disconnect(): void {
		this.disconnected = true;
	}
}

mock.module("pusher-js", () => ({ default: FakePusher }));

import { PusherChannelTransport } from "../../src/client/channels/pusher.js";
import {
	ChannelReadiness,
	ChannelReadyDelivery,
} from "../../src/client/channels/readiness.js";
import { SseChannelTransport } from "../../src/client/channels/sse.js";
import { createClient } from "../../src/client/index.js";
import {
	parseTypedWire,
	serializeCompatibleTypedEventWire,
	stringifyCompatibleTypedEventWire,
} from "../../src/shared/typed-wire.js";

async function waitFor(
	assertion: () => boolean,
	timeoutMs = 3000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("channels client", () => {
	test("isolates throwing bootstrap error callbacks for message and presence subscriptions", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const clients = Array.from({ length: 2 }, () =>
				createClient<any>({
					baseURL: "http://localhost:3000",
					fetch: async () => new Response(null, { status: 500 }),
				}),
			);
			let errorCalls = 0;
			const throwFromConsumer = () => {
				errorCalls += 1;
				throw new Error("consumer bootstrap error callback failed");
			};
			clients[0]!.channels.news.subscribe(() => {}, {
				onError: throwFromConsumer,
			});
			clients[1]!.channels.room.subscribePresence({ roomId: "one" }, () => {}, {
				onError: throwFromConsumer,
			});

			await waitFor(() => errorCalls === 2);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
			for (const client of clients) client.channels.destroy();
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	test("keeps a ready FIFO ordered through a throwing re-entrant consumer", async () => {
		const readiness = new ChannelReadiness();
		readiness.admit();
		const seen: number[] = [];
		let delivery!: ChannelReadyDelivery<number>;
		delivery = new ChannelReadyDelivery(
			readiness,
			(value: number) => {
				seen.push(value);
				if (value === 1) {
					delivery.accept(3);
					throw new Error("consumer message callback failed");
				}
			},
			undefined,
			() => {
				throw new Error("unexpected overflow");
			},
		);

		delivery.accept(1);
		delivery.accept(2);
		await Promise.resolve();

		expect(seen).toEqual([1, 2, 3]);
		delivery.stop();
	});

	test("keeps explicit plain JSON channel publishing interoperable", async () => {
		const instant = new Date("2026-03-29T00:30:00.000Z");
		let publishRequest: RequestInit | undefined;
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			useSuperJSON: false,
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith("/channels/config")) {
					return Response.json({
						transport: "sse",
						channels: {
							news: { pattern: "news", visibility: "public" },
						},
					});
				}
				if (url.endsWith("/channels/publish")) {
					publishRequest = init;
					return Response.json({ eventId: "event-1" });
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});

		await client.channels.news.publish({
			event: "updated",
			data: { startsAt: instant },
		});

		expect(new Headers(publishRequest?.headers).get("Content-Type")).toBe(
			"application/json",
		);
		expect(JSON.parse(String(publishRequest?.body))).toEqual({
			channel: "news",
			params: {},
			event: "updated",
			data: { startsAt: instant.toISOString() },
		});
		client.channels.destroy();
	});

	test("subscribes and publishes through the SSE transport with fresh auth", async () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let authVersion = 0;
		const encoder = new TextEncoder();
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			expect(new Headers(init?.headers).get("Authorization")).toMatch(
				/^Bearer channel-/,
			);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
						room: {
							pattern: "room-[roomId]",
							visibility: "presence",
						},
					},
				});
			}
			if (url.endsWith("/realtime")) {
				const payload = JSON.parse(String(init?.body));
				if (payload.sessionId) return new Response(null, { status: 204 });
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({ sessionId: "s1", token: "t1", control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
							),
						);
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				});
			}
			if (url.endsWith("/channels/publish")) {
				return Response.json({ eventId: "event-1" });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({
				Authorization: `Bearer channel-${++authVersion}`,
			}),
		});
		const messages: unknown[] = [];
		const rosters: unknown[] = [];
		const errors: Error[] = [];
		const stop = client.channels.news.subscribe(
			(message: unknown) => messages.push(message),
			{ onError: (error: Error) => errors.push(error) },
		);
		const stopPresence = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
			{ onError: (error: Error) => errors.push(error) },
		);

		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ type: "channel_event", channel: "news", event: "updated", eventId: `${"d".repeat(64)}:1`, data: { title: "Hello", startsAt: instant, isoLookingString: instant.toISOString() } })}\n\n`,
			),
		);
		await waitFor(() => messages.length === 1);
		expect(messages[0]).toEqual({
			event: "updated",
			eventId: `${"d".repeat(64)}:1`,
			data: {
				title: "Hello",
				startsAt: instant,
				isoLookingString: instant.toISOString(),
			},
		});
		expect((messages[0] as any).data.startsAt).toBeInstanceOf(Date);
		expect((messages[0] as any).data.isoLookingString).not.toBeInstanceOf(Date);
		expect(errors).toHaveLength(0);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_presence\ndata: ${JSON.stringify({ type: "channel_presence", channel: "presence-room-one", members: [{ id: "member-1" }] })}\n\n`,
			),
		);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:presence-room-one" })}\n\n`,
			),
		);
		await waitFor(() => rosters.length === 1);
		expect(rosters).toEqual([[{ id: "member-1" }]]);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_presence\ndata: ${JSON.stringify({ type: "channel_presence", channel: "presence-room-one", members: [{ id: "member-1" }] })}\n\n`,
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(rosters).toHaveLength(1);

		await expect(
			client.channels.news.publish({
				event: "updated",
				data: { title: "Published", startsAt: instant },
			}),
		).resolves.toEqual({ eventId: "event-1" });
		const publishRequest = requests.find(({ url }) =>
			url.endsWith("/channels/publish"),
		);
		expect(new Headers(publishRequest?.init?.headers).get("Content-Type")).toBe(
			"application/superjson+json",
		);
		expect(parseTypedWire(String(publishRequest?.init?.body))).toEqual({
			channel: "news",
			params: {},
			event: "updated",
			data: { title: "Published", startsAt: instant },
		});

		stopPresence();
		await waitFor(() =>
			requests.some(({ url, init }) => {
				if (!url.endsWith("/realtime")) return false;
				const payload = JSON.parse(String(init?.body));
				return (
					payload.topology?.subscriptions?.length === 1 &&
					payload.topology.subscriptions[0].channel === "news"
				);
			}),
		);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${JSON.stringify({
					type: "channel_event",
					channel: "news",
					event: "updated",
					eventId: `${"d".repeat(64)}:2`,
					data: {},
					__questpieTypedWire: { version: 2, dates: [] },
				})}\n\n`,
			),
		);
		await waitFor(() => errors.length === 1);
		expect(errors[0]?.message).toContain("typed event protocol error");
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${JSON.stringify({
					type: "channel_event",
					channel: "news",
					event: "updated",
					eventId: `${"d".repeat(64)}:3`,
					data: { title: "must-not-arrive" },
				})}\n\n`,
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(messages).toHaveLength(1);
		const controlCount = requests.filter(({ url, init }) => {
			if (!url.endsWith("/realtime")) return false;
			return Boolean(JSON.parse(String(init?.body)).sessionId);
		}).length;
		stop();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(
			requests.filter(({ url, init }) => {
				if (!url.endsWith("/realtime")) return false;
				return Boolean(JSON.parse(String(init?.body)).sessionId);
			}).length,
		).toBe(controlCount);
		client.channels.destroy();
	});

	test("orders SSE replay then readiness then live delivery for every logical subscriber", async () => {
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const encoder = new TextEncoder();
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/realtime")) {
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streamControllers.push(controller);
							controller.enqueue(
								encoder.encode(
									`event: session\ndata: ${JSON.stringify({ sessionId: `ready-s${streamControllers.length}`, token: `ready-t${streamControllers.length}`, control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
								),
							);
						},
					}),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const order: string[] = [];
		const sharedReady = () => order.push("ready");
		let stoppedBeforeReady = 0;
		const stopBeforeReady = client.channels.news.subscribe(() => {}, {
			onReady: () => {
				stoppedBeforeReady += 1;
			},
		});
		stopBeforeReady();
		const stopFirst = client.channels.news.subscribe(
			(message: { eventId: string }) => order.push(`first:${message.eventId}`),
			{
				onReady: sharedReady,
				onError: (error: Error) => order.push(`error:${error.message}`),
			},
		);
		const stopSecond = client.channels.news.subscribe(
			(message: { eventId: string }) => order.push(`second:${message.eventId}`),
			{ onReady: sharedReady },
		);

		await waitFor(() => streamControllers.length === 1);
		const hash = "9".repeat(64);
		streamControllers[0]!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ channel: "news", event: "updated", eventId: `${hash}:1`, data: { phase: "replay" } })}\n\n`,
			),
		);
		streamControllers[0]!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		streamControllers[0]!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ channel: "news", event: "updated", eventId: `${hash}:2`, data: { phase: "live" } })}\n\n`,
			),
		);

		await waitFor(
			() => order.filter((item) => item.includes(":2")).length === 2,
		);
		expect(order).toEqual([
			`first:${hash}:1`,
			`second:${hash}:1`,
			"ready",
			"ready",
			`first:${hash}:2`,
			`second:${hash}:2`,
		]);
		expect(stoppedBeforeReady).toBe(0);

		let stoppedLateReady = 0;
		const stopLate = client.channels.news.subscribe(() => {}, {
			onReady: () => {
				stoppedLateReady += 1;
			},
		});
		stopLate();
		await Promise.resolve();
		expect(stoppedLateReady).toBe(0);

		let activeLateReady = 0;
		const stopActiveLate = client.channels.news.subscribe(() => {}, {
			onReady: () => {
				activeLateReady += 1;
			},
		});
		await waitFor(() => activeLateReady === 1);
		expect(activeLateReady).toBe(1);

		streamControllers[0]!.close();
		await waitFor(() => streamControllers.length === 2);
		streamControllers[1]!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		await waitFor(() => order.filter((item) => item === "ready").length === 4);
		expect(order.slice(-3)).toEqual([
			"error:Realtime stream closed",
			"ready",
			"ready",
		]);

		stopActiveLate();
		stopSecond();
		stopFirst();
		client.channels.destroy();
	});

	test("does not admit an SSE channel whose server rejects the subscription", async () => {
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const encoder = new TextEncoder();
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith("/channels/config")) {
					return Response.json({
						transport: "sse",
						channels: {
							news: { pattern: "news", visibility: "public" },
						},
					});
				}
				if (url.endsWith("/realtime")) {
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
								controller.enqueue(
									encoder.encode(
										`event: session\ndata: ${JSON.stringify({ sessionId: "denied-s1", token: "denied-t1", control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
									),
								);
							},
						}),
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});
		let ready = 0;
		const errors: string[] = [];
		client.channels.news.subscribe(() => {}, {
			onReady: () => {
				ready += 1;
			},
			onError: (error: Error) => errors.push(error.message),
		});

		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: error\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news", message: "Channel subscription is denied" })}\n\n`,
			),
		);
		await waitFor(() => errors.length === 1);
		expect(errors).toEqual(["Channel subscription is denied"]);
		expect(ready).toBe(0);
		client.channels.destroy();
	});

	test("ends an admitted sibling epoch before reconnecting after a targeted SSE topology rejection", async () => {
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const encoder = new TextEncoder();
		let rejectRoom = true;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
						room: { pattern: "room-[roomId]", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/realtime")) {
				const payload = JSON.parse(String(init?.body));
				if (payload.topology) {
					if (
						rejectRoom &&
						payload.topology.subscriptions.some(
							(entry: { id: string }) => entry.id === "channel:room-one",
						)
					) {
						rejectRoom = false;
						return Response.json(
							{
								error: {
									entries: [
										{
											id: "channel:room-one",
											kind: "channel",
											code: "REALTIME_SUBSCRIPTION_REJECTED",
											message: "Room subscription is denied",
										},
									],
								},
							},
							{ status: 400 },
						);
					}
					return new Response(null, { status: 202 });
				}
				const sequence = streamControllers.length + 1;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streamControllers.push(controller);
							controller.enqueue(
								encoder.encode(
									`event: session\ndata: ${JSON.stringify({ sessionId: `topology-s${sequence}`, token: `topology-t${sequence}`, control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
								),
							);
							init?.signal?.addEventListener(
								"abort",
								() =>
									controller.error(new DOMException("Aborted", "AbortError")),
								{ once: true },
							);
						},
					}),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const newsLifecycle: string[] = [];
		const newsMessages: string[] = [];
		const roomErrors: string[] = [];
		let roomReady = 0;
		const stopNews = client.channels.news.subscribe(
			(message: { eventId: string }) => newsMessages.push(message.eventId),
			{
				onReady: () => newsLifecycle.push("ready"),
				onError: (error: Error) => newsLifecycle.push(`error:${error.message}`),
			},
		);

		await waitFor(() => streamControllers.length === 1);
		streamControllers[0]!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		await waitFor(() => newsLifecycle.length === 1);
		const stopRoom = client.channels.room.subscribe(
			{ roomId: "one" },
			() => {},
			{
				onReady: () => {
					roomReady += 1;
				},
				onError: (error: Error) => roomErrors.push(error.message),
			},
		);

		await waitFor(() => streamControllers.length === 2);
		expect(roomErrors).toEqual(["Room subscription is denied"]);
		expect(roomReady).toBe(0);
		streamControllers[1]!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		const hash = "6".repeat(64);
		streamControllers[1]!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ channel: "news", event: "updated", eventId: `${hash}:1`, data: {} })}\n\n`,
			),
		);

		await waitFor(() => newsMessages.length === 1);
		expect(newsLifecycle).toEqual(["ready", "error:Aborted", "ready"]);
		expect(newsMessages).toEqual([`${hash}:1`]);
		stopRoom();
		stopNews();
		client.channels.destroy();
	});

	test("orders a re-entrant late SSE subscriber readiness before its first buffered live frame", async () => {
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const encoder = new TextEncoder();
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async (input) => {
				const url = String(input);
				if (url.endsWith("/realtime")) {
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
								controller.enqueue(
									encoder.encode(
										`event: session\ndata: ${JSON.stringify({ sessionId: "late-s1", token: "late-t1", control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
									),
								);
							},
						}),
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		const lifecycle: string[] = [];
		let stopLate: (() => void) | undefined;
		const stopFirst = transport.subscribe(
			input,
			(message: { eventId: string }) => {
				lifecycle.push(`first:${message.eventId}`);
				stopLate ??= transport.subscribe(
					input,
					(late: { eventId: string }) => lifecycle.push(`late:${late.eventId}`),
					{
						onReady: () => {
							lifecycle.push("late:ready");
							throw new Error("consumer readiness failure");
						},
					},
				);
			},
			{ onReady: () => lifecycle.push("first:ready") },
		);

		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		await waitFor(() => lifecycle.length === 1);
		const hash = "5".repeat(64);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ channel: "news", event: "updated", eventId: `${hash}:1`, data: {} })}\n\n`,
			),
		);

		await waitFor(() => lifecycle.includes("late:ready"));
		await Promise.resolve();
		expect(lifecycle).toEqual([
			"first:ready",
			`first:${hash}:1`,
			"late:ready",
			`late:${hash}:1`,
		]);
		stopLate?.();
		stopFirst();
		transport.destroy();
	});

	test("orders SSE presence readiness before initial and late cached roster delivery", async () => {
		let resource:
			| {
					onEvent(event: { type: string; data: string }): void;
					onEpochEnd?(error: Error): void;
			  }
			| undefined;
		const connection = {
			registerChannel(options: typeof resource): () => void {
				resource = options;
				return () => {};
			},
		};
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async () => {
				throw new Error("The shared connection owns SSE fetching");
			},
			connection: connection as any,
		});
		const input = {
			registryKey: "room",
			params: { roomId: "one" },
			resolvedName: "presence-room-one",
			visibility: "presence" as const,
		};
		const order: string[] = [];
		const stopInitial = transport.subscribePresence(
			input,
			() => order.push("initial:members"),
			{ onReady: () => order.push("initial:ready") },
		);

		resource!.onEvent({
			type: "channel_presence",
			data: JSON.stringify({
				channel: "presence-room-one",
				members: [{ id: "member-1" }],
			}),
		});
		resource!.onEvent({
			type: "channel_ready",
			data: JSON.stringify({
				channelSubscriptionId: "channel:presence-room-one",
			}),
		});
		expect(order).toEqual(["initial:ready", "initial:members"]);

		const stopLate = transport.subscribePresence(
			input,
			() => order.push("late:members"),
			{ onReady: () => order.push("late:ready") },
		);
		await Promise.resolve();
		expect(order.slice(-2)).toEqual(["late:ready", "late:members"]);

		resource!.onEpochEnd?.(new Error("presence epoch ended"));
		resource!.onEvent({
			type: "channel_presence",
			data: JSON.stringify({
				channel: "presence-room-one",
				members: [{ id: "member-2" }],
			}),
		});
		expect(order.slice(-2)).toEqual(["late:ready", "late:members"]);
		resource!.onEvent({
			type: "channel_ready",
			data: JSON.stringify({
				channelSubscriptionId: "channel:presence-room-one",
			}),
		});
		expect(order.slice(-4)).toEqual([
			"initial:ready",
			"initial:members",
			"late:ready",
			"late:members",
		]);

		stopLate();
		stopInitial();
		transport.destroy();
	});

	test("orders Pusher presence readiness before initial and late cached roster delivery", async () => {
		FakePusher.instances = [];
		const transport = new PusherChannelTransport({
			baseUrl: "http://localhost:3000",
			fetcher: async (input) => {
				if (String(input).endsWith("/channels/auth")) {
					return Response.json({ auth: "signed", channel_data: "{}" });
				}
				throw new Error(`Unexpected request: ${String(input)}`);
			},
			config: { provider: "pusher", key: "public-key" },
		});
		const input = {
			registryKey: "room",
			params: { roomId: "one" },
			resolvedName: "presence-room-one",
			visibility: "presence" as const,
		};
		const order: string[] = [];
		const stopInitial = transport.subscribePresence(
			input,
			() => order.push("initial:members"),
			{ onReady: () => order.push("initial:ready") },
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0]!;
		provider.channel.memberInfos = [{ id: "member-1" }];
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		await waitFor(() => order.length === 2);
		expect(order).toEqual(["initial:ready", "initial:members"]);

		const stopLate = transport.subscribePresence(
			input,
			() => order.push("late:members"),
			{ onReady: () => order.push("late:ready") },
		);
		await Promise.resolve();
		expect(order.slice(-2)).toEqual(["late:ready", "late:members"]);

		provider.channel.memberInfos = [{ id: "member-2" }];
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		expect(order.slice(-4)).toEqual([
			"initial:ready",
			"initial:members",
			"late:ready",
			"late:members",
		]);

		stopLate();
		stopInitial();
		transport.destroy();
	});

	test("orders late SSE presence iterator readiness before its cached roster", async () => {
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const encoder = new TextEncoder();
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith("/channels/config")) {
					return Response.json({
						transport: "sse",
						channels: {
							room: {
								pattern: "room-[roomId]",
								visibility: "presence",
							},
						},
					});
				}
				if (url.endsWith("/realtime")) {
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
								controller.enqueue(
									encoder.encode(
										`event: session\ndata: ${JSON.stringify({ sessionId: "presence-iter-s1", token: "presence-iter-t1", control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
									),
								);
							},
						}),
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});
		const rosters: unknown[] = [];
		const stop = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
		);
		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_presence\ndata: ${JSON.stringify({ channel: "presence-room-one", members: [{ id: "member-1" }] })}\n\n`,
			),
		);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:presence-room-one" })}\n\n`,
			),
		);
		await waitFor(() => rosters.length === 1);

		const order: string[] = [];
		const iterator = client.channels.room.presenceIter(
			{ roomId: "one" },
			{ onReady: () => order.push("ready") },
		);
		const result = await iterator.next().then((value: unknown) => {
			order.push("members");
			return value;
		});
		expect(order).toEqual(["ready", "members"]);
		expect(result).toMatchObject({ value: [{ id: "member-1" }] });
		await iterator.return();
		stop();
		client.channels.destroy();
	});

	test("orders late Pusher presence iterator readiness before its cached roster", async () => {
		FakePusher.instances = [];
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith("/channels/config")) {
					return Response.json({
						transport: "shared-provider",
						config: { provider: "pusher", key: "public-key" },
						channels: {
							room: {
								pattern: "room-[roomId]",
								visibility: "presence",
							},
						},
					});
				}
				if (url.endsWith("/channels/auth")) {
					return Response.json({ auth: "signed", channel_data: "{}" });
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});
		const rosters: unknown[] = [];
		const stop = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
		);
		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0]!;
		provider.channel.memberInfos = [{ id: "member-1" }];
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		await waitFor(() => rosters.length === 1);

		const order: string[] = [];
		const iterator = client.channels.room.presenceIter(
			{ roomId: "one" },
			{ onReady: () => order.push("ready") },
		);
		const result = await iterator.next().then((value: unknown) => {
			order.push("members");
			return value;
		});
		expect(order).toEqual(["ready", "members"]);
		expect(result).toMatchObject({ value: [{ id: "member-1" }] });
		await iterator.return();
		stop();
		client.channels.destroy();
	});

	test("isolates throwing SSE error listeners and still tears down", () => {
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async () =>
				new Response(new ReadableStream<Uint8Array>(), {
					headers: { "Content-Type": "text/event-stream" },
				}),
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		const siblingErrors: string[] = [];
		transport.subscribe(input, () => {}, {
			onError: () => {
				throw new Error("consumer error callback failed");
			},
		});
		transport.subscribe(input, () => {}, {
			onError: (error) => siblingErrors.push(error.message),
		});

		expect(() => transport.destroy()).not.toThrow();
		expect(siblingErrors).toEqual(["Channel transport destroyed"]);
		expect(transport.channelCount).toBe(0);
	});

	test("isolates throwing Pusher error listeners and still unmounts", async () => {
		FakePusher.instances = [];
		const transport = new PusherChannelTransport({
			baseUrl: "http://localhost:3000",
			fetcher: async () => {
				throw new Error("Unexpected request");
			},
			config: { provider: "pusher", key: "public-key" },
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		const siblingErrors: string[] = [];
		transport.subscribe(input, () => {}, {
			onError: () => {
				throw new Error("consumer error callback failed");
			},
		});
		transport.subscribe(input, () => {}, {
			onError: (error) => siblingErrors.push(error.message),
		});

		await waitFor(() => FakePusher.instances.length === 1);
		expect(() =>
			FakePusher.instances[0]!.channel.emit(
				"pusher:subscription_error",
				new Error("Provider rejected subscription"),
			),
		).not.toThrow();
		expect(siblingErrors).toEqual(["Provider rejected subscription"]);
		expect(transport.channelCount).toBe(0);
		transport.destroy();
	});

	test("keeps duplicate SSE error callbacks registered independently", () => {
		let resource:
			| {
					onEvent(event: { type: string; data: string }): void;
					onEpochEnd?(error: Error): void;
			  }
			| undefined;
		const connection = {
			registerChannel(options: typeof resource): () => void {
				resource = options;
				return () => {};
			},
		};
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async () => {
				throw new Error("The shared connection owns SSE fetching");
			},
			connection: connection as any,
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		let errorCalls = 0;
		const onError = () => {
			errorCalls += 1;
		};
		const stopFirst = transport.subscribe(input, () => {}, { onError });
		transport.subscribe(input, () => {}, { onError });
		resource!.onEvent({
			type: "channel_ready",
			data: JSON.stringify({ channelSubscriptionId: "channel:news" }),
		});

		stopFirst();
		resource!.onEpochEnd?.(new Error("subscription epoch ended"));

		expect(errorCalls).toBe(1);
		transport.destroy();
	});

	test("keeps duplicate Pusher error callbacks registered independently", async () => {
		FakePusher.instances = [];
		const transport = new PusherChannelTransport({
			baseUrl: "http://localhost:3000",
			fetcher: async () => {
				throw new Error("Unexpected request");
			},
			config: { provider: "pusher", key: "public-key" },
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		let errorCalls = 0;
		const onError = () => {
			errorCalls += 1;
		};
		const stopFirst = transport.subscribe(input, () => {}, { onError });
		transport.subscribe(input, () => {}, { onError });
		await waitFor(() => FakePusher.instances.length === 1);

		stopFirst();
		FakePusher.instances[0]!.channel.emit(
			"pusher:subscription_error",
			new Error("Provider rejected subscription"),
		);

		expect(errorCalls).toBe(1);
		transport.destroy();
	});

	test("terminates a ready-state SSE re-entrant live burst exactly once", () => {
		let resource:
			| {
					onEvent(event: { type: string; data: string }): void;
			  }
			| undefined;
		let releases = 0;
		const connection = {
			registerChannel(options: typeof resource): () => void {
				resource = options;
				return () => {
					releases += 1;
				};
			},
		};
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async () => {
				throw new Error("The shared connection owns SSE fetching");
			},
			connection: connection as any,
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		const hash = "6".repeat(64);
		const delivered: string[] = [];
		const errors: string[] = [];
		let burst = false;
		transport.subscribe(
			input,
			(message: { eventId: string }) => {
				delivered.push(message.eventId);
				if (burst) return;
				burst = true;
				for (let sequence = 2; sequence <= 102; sequence += 1) {
					resource!.onEvent({
						type: "channel_event",
						data: stringifyCompatibleTypedEventWire({
							channel: "news",
							event: "updated",
							eventId: `${hash}:${sequence}`,
							data: {},
						}),
					});
				}
			},
			{ onError: (error) => errors.push(error.message) },
		);
		resource!.onEvent({
			type: "channel_ready",
			data: JSON.stringify({ channelSubscriptionId: "channel:news" }),
		});
		resource!.onEvent({
			type: "channel_event",
			data: stringifyCompatibleTypedEventWire({
				channel: "news",
				event: "updated",
				eventId: `${hash}:1`,
				data: {},
			}),
		});

		expect(delivered).toEqual([`${hash}:1`]);
		expect(errors).toEqual(["Channel client slow consumer"]);
		expect(releases).toBe(1);
		expect(transport.channelCount).toBe(0);
		transport.destroy();
	});

	test("fails a re-entrant SSE slow-consumer entry exactly once", () => {
		let resource:
			| {
					onEvent(event: { type: string; data: string }): void;
			  }
			| undefined;
		let releases = 0;
		const connection = {
			registerChannel(options: typeof resource): () => void {
				resource = options;
				return () => {
					releases += 1;
				};
			},
		};
		const transport = new SseChannelTransport({
			baseUrl: "http://localhost:3000",
			withCredentials: false,
			fetcher: async () => {
				throw new Error("The shared connection owns SSE fetching");
			},
			connection: connection as any,
		});
		const input = {
			registryKey: "news",
			params: {},
			resolvedName: "news",
			visibility: "public" as const,
		};
		const terminalErrors = [0, 0, 0];
		let installedLateSubscribers = false;
		transport.subscribe(
			input,
			() => {
				if (installedLateSubscribers) return;
				installedLateSubscribers = true;
				for (const listener of [1, 2]) {
					transport.subscribe(input, () => {}, {
						onReady: () => {},
						onError: () => {
							terminalErrors[listener]! += 1;
						},
					});
				}
			},
			{
				onError: () => {
					terminalErrors[0]! += 1;
				},
			},
		);
		resource!.onEvent({
			type: "channel_ready",
			data: JSON.stringify({ channelSubscriptionId: "channel:news" }),
		});
		const hash = "7".repeat(64);
		for (let sequence = 1; sequence <= 101; sequence += 1) {
			resource!.onEvent({
				type: "channel_event",
				data: stringifyCompatibleTypedEventWire({
					channel: "news",
					event: "updated",
					eventId: `${hash}:${sequence}`,
					data: {},
				}),
			});
		}

		expect(terminalErrors).toEqual([1, 1, 1]);
		expect(releases).toBe(1);
		expect(transport.channelCount).toBe(0);
		transport.destroy();
	});

	test("delivers an invalidation during admission reconciliation for a trailing authoritative read", async () => {
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const encoder = new TextEncoder();
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: async (input) => {
				const url = String(input);
				if (url.endsWith("/channels/config")) {
					return Response.json({
						transport: "sse",
						channels: {
							news: { pattern: "news", visibility: "public" },
						},
					});
				}
				if (url.endsWith("/realtime")) {
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
								controller.enqueue(
									encoder.encode(
										`event: session\ndata: ${JSON.stringify({ sessionId: "race-s1", token: "race-t1", control: { protocol: "questpie-realtime-topology", versions: [2] } })}\n\n`,
									),
								);
							},
						}),
						{ headers: { "Content-Type": "text/event-stream" } },
					);
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		});
		let finishFirstRead!: () => void;
		const firstRead = new Promise<void>((resolve) => {
			finishFirstRead = resolve;
		});
		let reads = 0;
		let reading = false;
		let trailing = false;
		const reconcile = () => {
			if (reading) {
				trailing = true;
				return;
			}
			reading = true;
			reads += 1;
			void (reads === 1 ? firstRead : Promise.resolve()).then(() => {
				reading = false;
				if (!trailing) return;
				trailing = false;
				reconcile();
			});
		};
		const stop = client.channels.news.subscribe(reconcile, {
			onReady: reconcile,
		});

		await waitFor(() => !!streamController);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_ready\ndata: ${JSON.stringify({ channelSubscriptionId: "channel:news" })}\n\n`,
			),
		);
		await waitFor(() => reads === 1 && reading);
		const hash = "8".repeat(64);
		streamController!.enqueue(
			encoder.encode(
				`event: channel_event\ndata: ${stringifyCompatibleTypedEventWire({ channel: "news", event: "updated", eventId: `${hash}:1`, data: {} })}\n\n`,
			),
		);
		await waitFor(() => trailing);
		expect(reads).toBe(1);
		finishFirstRead();
		await waitFor(() => reads === 2 && !reading);
		expect(reads).toBe(2);

		stop();
		client.channels.destroy();
	});

	test("coalesces advertised v2 channel topology and closes the last channel locally", async () => {
		const controls: Array<{
			revision: number;
			subscriptions: Array<{ id: string }>;
		}> = [];
		let streamReady = false;
		let aborted = false;
		const encoder = new TextEncoder();
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "sse",
					channels: {
						news: { pattern: "news", visibility: "public" },
						room: {
							pattern: "room-[roomId]",
							visibility: "public",
						},
					},
				});
			}
			if (url.endsWith("/realtime")) {
				const payload = JSON.parse(String(init?.body));
				if (payload.topology) {
					controls.push(payload.topology);
					return Response.json({ status: "accepted" }, { status: 202 });
				}
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamReady = true;
						controller.enqueue(
							encoder.encode(
								`event: session\ndata: ${JSON.stringify({
									sessionId: "channels-v1",
									token: "token-v1",
									control: {
										protocol: "questpie-realtime-topology",
										versions: [2],
									},
								})}\n\n`,
							),
						);
						init?.signal?.addEventListener("abort", () => {
							aborted = true;
							try {
								controller.close();
							} catch {}
						});
					},
				});
				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const stopNews = client.channels.news.subscribe(() => {});
		await waitFor(() => streamReady);
		const stopOne = client.channels.room.subscribe({ roomId: "one" }, () => {});
		const stopTwo = client.channels.room.subscribe({ roomId: "two" }, () => {});
		await waitFor(() => controls.length === 1);
		expect(controls[0]).toMatchObject({ revision: 1 });
		expect(controls[0].subscriptions).toHaveLength(3);

		stopOne();
		stopTwo();
		await waitFor(() => controls.length === 2);
		expect(controls[1]).toMatchObject({ revision: 2 });
		expect(controls[1].subscriptions).toHaveLength(1);

		stopNews();
		await waitFor(() => aborted);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(controls).toHaveLength(2);
		client.channels.destroy();
	});

	test("subscribes to typed provider channels and exposes native presence", async () => {
		FakePusher.instances = [];
		const instant = new Date("2025-11-02T05:30:00.000Z");
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		let token = 0;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			expect(new Headers(init?.headers).get("Authorization")).toMatch(
				/^Bearer provider-/,
			);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key", cluster: "eu" },
					channels: {
						room: {
							pattern: "room-[roomId]",
							visibility: "presence",
						},
						signalRoom: {
							pattern: "signal-room-[signal]",
							visibility: "presence",
						},
					},
				});
			}
			if (url.endsWith("/channels/auth")) {
				return Response.json({ auth: "signed", channel_data: "{}" });
			}
			if (url.endsWith("/channels/replay")) {
				return Response.json({
					status: "events",
					events: [],
					hasMore: false,
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({
				Authorization: `Bearer provider-${++token}`,
			}),
		});
		const messages: unknown[] = [];
		const rosters: unknown[] = [];
		let presenceReady = 0;
		const stop = client.channels.room.subscribe(
			{ roomId: "one" },
			(message: unknown) => messages.push(message),
		);
		const stopPresence = client.channels.room.subscribePresence(
			{ roomId: "one" },
			(members: unknown) => rosters.push(members),
			{
				onReady: () => {
					presenceReady += 1;
				},
			},
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		expect(provider.key).toBe("public-key");
		provider.channel.memberInfos = [
			serializeCompatibleTypedEventWire({
				id: "member-1",
				roomId: "one",
				joinedAt: instant,
			}),
		];
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		provider.channel.emit(
			"questpie:channel",
			serializeCompatibleTypedEventWire({
				eventId: `${"b".repeat(64)}:2`,
				event: "message",
				data: {
					text: "hello",
					startsAt: instant,
					isoLookingString: instant.toISOString(),
				},
			}),
		);
		await waitFor(() => messages.length === 1);
		expect(messages[0]).toEqual({
			event: "message",
			eventId: `${"b".repeat(64)}:2`,
			data: {
				text: "hello",
				startsAt: instant,
				isoLookingString: instant.toISOString(),
			},
		});
		expect((messages[0] as any).data.startsAt).toBeInstanceOf(Date);
		expect((messages[0] as any).data.isoLookingString).not.toBeInstanceOf(Date);
		await waitFor(() => rosters.length === 1);
		await waitFor(() => presenceReady === 1);
		expect(rosters[0]).toEqual([
			{ id: "member-1", roomId: "one", joinedAt: instant },
		]);
		expect((rosters[0] as any)[0].joinedAt).toBeInstanceOf(Date);
		provider.channel.memberInfos = [
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		];
		provider.channel.emit("pusher:member_added", {});
		await waitFor(() => rosters.length === 2);
		expect(rosters[1]).toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		provider.channel.emit("pusher:member_added", {});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(rosters).toHaveLength(2);
		await expect(
			client.channels.room.presence({ roomId: "one" }),
		).resolves.toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		const signalPresence = client.channels.signalRoom.presence({
			signal: "two",
		});
		await waitFor(() =>
			requests
				.filter(({ url }) => url.endsWith("/channels/auth"))
				.map(({ init }) => JSON.parse(String(init?.body)))
				.some(({ channel }) => channel === "signalRoom"),
		);
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);
		await expect(signalPresence).resolves.toEqual([
			{ id: "member-1", roomId: "one" },
			{ id: "member-2", roomId: "one" },
		]);
		await waitFor(() =>
			requests.some(({ url }) => url.endsWith("/channels/auth")),
		);
		expect(
			JSON.parse(
				String(
					requests.find(({ url }) => url.endsWith("/channels/auth"))?.init
						?.body,
				),
			),
		).toEqual({
			socketId: "123.456",
			channelName: "presence-room-one",
			channel: "room",
			params: { roomId: "one" },
		});
		expect(
			requests
				.filter(({ url }) => url.endsWith("/channels/auth"))
				.map(({ init }) => JSON.parse(String(init?.body))),
		).toContainEqual({
			socketId: "123.456",
			channelName: "presence-signal-room-two",
			channel: "signalRoom",
			params: { signal: "two" },
		});

		stopPresence();
		stop();
		client.channels.destroy();
		expect(provider.disconnected).toBe(true);
	});

	test("replays missed Pusher events after subscription recovery and deduplicates live races", async () => {
		FakePusher.instances = [];
		const channelHash = "a".repeat(64);
		const replayedInstant = new Date("2025-03-30T00:30:00.123Z");
		const replayRequests: Record<string, unknown>[] = [];
		let resolveReplay: ((response: Response) => void) | undefined;
		const fetcher: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				replayRequests.push(JSON.parse(String(init?.body)));
				return new Promise<Response>((resolve) => {
					resolveReplay = resolve;
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
			getAuthHeaders: () => ({ Authorization: "Bearer fresh" }),
		});
		const messages: Array<{ eventId: string; data: any }> = [];
		const errors: Error[] = [];
		const lifecycle: string[] = [];
		const stop = client.channels.news.subscribe(
			(message: { eventId: string; data: any }) => {
				messages.push(message);
				lifecycle.push(`event:${message.eventId}`);
			},
			{
				onReady: () => lifecycle.push("ready"),
				onError: (error: Error) => {
					errors.push(error);
					lifecycle.push(`error:${error.message}`);
				},
			},
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => lifecycle[0] === "ready");
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: { value: 1 },
		});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: { value: 1 },
		});
		await waitFor(() => messages.length === 1);

		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => replayRequests.length === 1);
		expect(replayRequests[0]).toEqual({
			channel: "news",
			params: {},
			afterEventId: `${channelHash}:1`,
		});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:3`,
			event: "updated",
			data: { value: 3 },
		});
		resolveReplay?.(
			Response.json({
				status: "events",
				events: [
					{
						eventId: `${channelHash}:1`,
						event: "updated",
						data: { value: 1 },
					},
					serializeCompatibleTypedEventWire({
						eventId: `${channelHash}:2`,
						event: "updated",
						data: {
							value: 2,
							startsAt: replayedInstant,
							isoLookingString: replayedInstant.toISOString(),
						},
					}),
				],
				hasMore: false,
			}),
		);

		await waitFor(() => messages.length === 3);
		expect(messages.map((message) => message.eventId)).toEqual([
			`${channelHash}:1`,
			`${channelHash}:2`,
			`${channelHash}:3`,
		]);
		expect(messages[1]?.data.startsAt).toBeInstanceOf(Date);
		expect(messages[1]?.data.startsAt.getTime()).toBe(
			replayedInstant.getTime(),
		);
		expect(messages[1]?.data.isoLookingString).not.toBeInstanceOf(Date);
		expect(errors.map((error) => error.message)).toEqual([
			"Channel subscription epoch ended",
		]);
		expect(lifecycle).toEqual([
			"ready",
			`event:${channelHash}:1`,
			"error:Channel subscription epoch ended",
			`event:${channelHash}:2`,
			"ready",
			`event:${channelHash}:3`,
		]);

		stop();
		client.channels.destroy();
	});

	test("fences an awaited Pusher replay when the transport is destroyed", async () => {
		FakePusher.instances = [];
		const channelHash = "b".repeat(64);
		let resolveReplay: ((response: Response) => void) | undefined;
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				return new Promise<Response>((resolve) => {
					resolveReplay = resolve;
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const messages: string[] = [];
		client.channels.news.subscribe((message: { eventId: string }) =>
			messages.push(message.eventId),
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		await waitFor(() => messages.length === 1);
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => resolveReplay !== undefined);

		client.channels.destroy();
		resolveReplay?.(
			Response.json({
				status: "events",
				events: [
					{
						eventId: `${channelHash}:2`,
						event: "updated",
						data: {},
					},
				],
				hasMore: false,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(messages).toEqual([`${channelHash}:1`]);
		expect(client.channels.channelCount).toBe(0);
	});

	test("fences an awaited Pusher replay after a terminal queue failure", async () => {
		FakePusher.instances = [];
		const channelHash = "d".repeat(64);
		let resolveReplay: ((response: Response) => void) | undefined;
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				return new Promise<Response>((resolve) => {
					resolveReplay = resolve;
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const messages: string[] = [];
		const errors: string[] = [];
		client.channels.news.subscribe(
			(message: { eventId: string }) => messages.push(message.eventId),
			{ onError: (error: Error) => errors.push(error.message) },
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		await waitFor(() => messages.length === 1);
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => resolveReplay !== undefined);
		for (let index = 0; index <= 100; index += 1) {
			provider.channel.emit("questpie:channel", {
				eventId: `${channelHash}:${index + 2}`,
				event: "updated",
				data: {},
			});
		}
		await waitFor(() => errors.includes("Channel client slow consumer"));

		resolveReplay?.(
			Response.json({
				status: "events",
				events: [
					{
						eventId: `${channelHash}:2`,
						event: "updated",
						data: {},
					},
				],
				hasMore: false,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(errors).toEqual([
			"Channel subscription epoch ended",
			"Channel client slow consumer",
		]);
		expect(messages).toEqual([`${channelHash}:1`]);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("fences deferred Pusher recovery after a provider subscription error", async () => {
		FakePusher.instances = [];
		const channelHash = "4".repeat(64);
		let resolveReplay: ((response: Response) => void) | undefined;
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				return new Promise<Response>((resolve) => {
					resolveReplay = resolve;
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const messages: string[] = [];
		const errors: string[] = [];
		let ready = 0;
		client.channels.news.subscribe(
			(message: { eventId: string }) => messages.push(message.eventId),
			{
				onReady: () => {
					ready += 1;
				},
				onError: (error: Error) => errors.push(error.message),
			},
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0]!;
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => ready === 1);
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		await waitFor(() => messages.length === 1);
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => resolveReplay !== undefined);
		provider.channel.emit(
			"pusher:subscription_error",
			new Error("Provider rejected subscription"),
		);
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:3`,
			event: "updated",
			data: {},
		});
		resolveReplay?.(
			Response.json({
				status: "events",
				events: [
					{
						eventId: `${channelHash}:2`,
						event: "updated",
						data: {},
					},
				],
				hasMore: false,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(errors).toEqual([
			"Channel subscription epoch ended",
			"Provider rejected subscription",
		]);
		expect(ready).toBe(1);
		expect(messages).toEqual([`${channelHash}:1`]);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("closes only the affected Pusher channel when replay retention has a gap", async () => {
		FakePusher.instances = [];
		const channelHash = "c".repeat(64);
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				return Response.json({
					status: "gap",
					requestedEventId: `${channelHash}:1`,
					oldestEventId: `${channelHash}:9`,
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const errors: Error[] = [];
		let ready = 0;
		client.channels.news.subscribe(() => {}, {
			onReady: () => {
				ready += 1;
			},
			onError: (error: Error) => errors.push(error),
		});

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => ready === 1);
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		provider.channel.emit("pusher:subscription_succeeded", {});

		await waitFor(() =>
			errors.some((error) => error.message === "Channel event replay gap"),
		);
		expect(errors.map((error) => error.message)).toEqual([
			"Channel subscription epoch ended",
			"Channel event replay gap",
		]);
		expect(ready).toBe(1);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("terminates a Pusher channel on an incompatible live frame", async () => {
		FakePusher.instances = [];
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const messages: unknown[] = [];
		const errors: Error[] = [];
		client.channels.news.subscribe(
			(message: unknown) => messages.push(message),
			{ onError: (error: Error) => errors.push(error) },
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${"7".repeat(64)}:1`,
			event: "updated",
			data: {},
			__questpieTypedWire: { version: 2, dates: [] },
		});

		await waitFor(() => errors.length === 1);
		expect(errors[0]?.message).toContain(
			"Unsupported QUESTPIE typed event wire version",
		);
		expect(client.channels.channelCount).toBe(0);
		provider.channel.emit("questpie:channel", {
			eventId: `${"7".repeat(64)}:2`,
			event: "updated",
			data: { value: "must-not-arrive" },
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(messages).toHaveLength(0);
		client.channels.destroy();
	});

	test("rejects presence waiters on incompatible Pusher member metadata", async () => {
		FakePusher.instances = [];
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						room: {
							pattern: "room-[roomId]",
							visibility: "presence",
						},
					},
				});
			}
			if (url.endsWith("/channels/auth")) {
				return Response.json({ auth: "signed", channel_data: "{}" });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const errors: Error[] = [];
		const presence = client.channels.room.presence(
			{ roomId: "one" },
			{ onError: (error: Error) => errors.push(error) },
		);

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.memberInfos = [
			{
				id: "member-1",
				__questpieTypedWire: { version: 2, dates: [] },
			},
		];
		provider.channel.emit(
			"pusher:subscription_succeeded",
			provider.channel.members,
		);

		await expect(presence).rejects.toThrow(
			"Unsupported QUESTPIE typed event wire version",
		);
		expect(errors).toHaveLength(1);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("terminates a Pusher channel on an incompatible replay frame", async () => {
		FakePusher.instances = [];
		const channelHash = "8".repeat(64);
		let replay = 0;
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			if (url.endsWith("/channels/replay")) {
				replay += 1;
				return Response.json({
					status: "events",
					events: [
						{
							eventId: `${channelHash}:2`,
							event: "updated",
							data: {},
							__questpieTypedWire: { version: 2, dates: [] },
						},
					],
					hasMore: false,
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const errors: Error[] = [];
		client.channels.news.subscribe(() => {}, {
			onError: (error: Error) => errors.push(error),
		});

		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		provider.channel.emit("pusher:subscription_succeeded", {});

		await waitFor(() =>
			errors.some((error) =>
				error.message.includes("Unsupported QUESTPIE typed event wire version"),
			),
		);
		expect(replay).toBe(1);
		expect(errors.map((error) => error.message)).toEqual([
			"Channel subscription epoch ended",
			expect.stringContaining("Unsupported QUESTPIE typed event wire version"),
		]);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("terminates a slow channel iterator instead of buffering without a bound", async () => {
		FakePusher.instances = [];
		const channelHash = "e".repeat(64);
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		let iteratorReady = 0;
		const iterator = client.channels.news.iter({
			onReady: () => {
				iteratorReady += 1;
			},
		});
		const firstResult = iterator.next();
		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		await waitFor(() => iteratorReady === 1);
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: { value: 1 },
		});
		await expect(firstResult).resolves.toMatchObject({
			value: { eventId: `${channelHash}:1` },
		});

		for (let sequence = 2; sequence <= 102; sequence += 1) {
			provider.channel.emit("questpie:channel", {
				eventId: `${channelHash}:${sequence}`,
				event: "updated",
				data: { value: sequence },
			});
		}

		await expect(iterator.next()).rejects.toThrow(
			"Channel client slow consumer",
		);
		expect(client.channels.channelCount).toBe(0);
		client.channels.destroy();
	});

	test("keeps a channel iterator error sticky while its consumer is between yields", async () => {
		FakePusher.instances = [];
		const channelHash = "f".repeat(64);
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const iterator = client.channels.news.iter();
		const firstResult = iterator.next();
		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:1`,
			event: "updated",
			data: {},
		});
		await expect(firstResult).resolves.toMatchObject({
			value: { eventId: `${channelHash}:1` },
		});

		provider.channel.emit("questpie:channel", {
			eventId: `${channelHash}:3`,
			event: "updated",
			data: {},
		});

		await expect(iterator.next()).rejects.toThrow("Channel event replay gap");
		client.channels.destroy();
	});

	test("bounds a channel iterator by serialized UTF-8 bytes", async () => {
		FakePusher.instances = [];
		const fetcher: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/channels/config")) {
				return Response.json({
					transport: "shared-provider",
					config: { provider: "pusher", key: "public-key" },
					channels: {
						news: { pattern: "news", visibility: "public" },
					},
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const client = createClient<any>({
			baseURL: "http://localhost:3000",
			fetch: fetcher,
		});
		const iterator = client.channels.news.iter();
		const firstResult = iterator.next();
		await waitFor(() => FakePusher.instances.length === 1);
		const provider = FakePusher.instances[0];
		provider.channel.emit("pusher:subscription_succeeded", {});
		provider.channel.emit("questpie:channel", {
			eventId: `${"1".repeat(64)}:1`,
			event: "updated",
			data: { value: "💥".repeat(300_000) },
		});

		await expect(firstResult).rejects.toThrow("Channel client slow consumer");
		client.channels.destroy();
	});
});
