import { describe, expect, test } from "bun:test";

import { SseConnectionManager } from "../../src/client/realtime/sse-connection.js";

const encoder = new TextEncoder();

async function waitFor(
	assertion: () => boolean,
	timeoutMs = 3_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await Bun.sleep(5);
	}
	throw new Error("Timed out waiting for assertion");
}

function sessionFrame(sequence: number): Uint8Array {
	return encoder.encode(
		`event: session\ndata: ${JSON.stringify({
			sessionId: `edge-${sequence}`,
			token: `control-${sequence}`,
			control: {
				protocol: "questpie-realtime-topology",
				versions: [2],
			},
		})}\n\n`,
	);
}

function openStream(
	sequence: number,
	signal: AbortSignal | null | undefined,
	controllers: ReadableStreamDefaultController<Uint8Array>[],
): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controllers.push(controller);
				controller.enqueue(sessionFrame(sequence));
				signal?.addEventListener(
					"abort",
					() => controller.error(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

function registerChannel(
	manager: SseConnectionManager,
	id: string,
	errors: Error[],
	epochEnds: Error[],
): () => void {
	return manager.registerChannel({
		id,
		openPayload: () => ({ id, channel: id }),
		desiredPayload: () => ({ kind: "channel", id, channel: id }),
		onEvent: () => {},
		onError: (error) => errors.push(error),
		onEpochEnd: (error) => epochEnds.push(error),
	});
}

describe("SSE connection manager failure classification", () => {
	test("backs off and retries an initial transport failure without a terminal resource error", async () => {
		let requests = 0;
		const requestStartedAt: number[] = [];
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const errors: Error[] = [];
		const epochEnds: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				requests += 1;
				requestStartedAt.push(performance.now());
				if (requests === 1) throw new Error("socket unavailable");
				return openStream(requests, init?.signal, controllers);
			},
			debounceMs: 0,
			retryBaseMs: 40,
			maxRetryMs: 40,
			random: () => 0,
		});
		const release = registerChannel(manager, "channel:news", errors, epochEnds);

		await waitFor(() => controllers.length === 1);
		expect(requests).toBe(2);
		// The configured retry delay is 20 ms. Allow 2 ms for monotonic-clock
		// precision while keeping the assertion safe when a loaded event loop
		// resumes the test after that deadline.
		expect(requestStartedAt[1]! - requestStartedAt[0]!).toBeGreaterThanOrEqual(
			18,
		);
		expect(errors).toEqual([]);
		expect(epochEnds.map((error) => error.message)).toEqual([
			"socket unavailable",
		]);

		release();
		await Bun.sleep(30);
		expect(requests).toBe(2);
		expect(errors).toEqual([]);
	});

	test("reconnects after a retryable control response without a terminal resource error", async () => {
		const opens: Record<string, unknown>[] = [];
		let controls = 0;
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const firstErrors: Error[] = [];
		const secondErrors: Error[] = [];
		const firstEpochEnds: Error[] = [];
		const secondEpochEnds: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (body.sessionId) {
					controls += 1;
					return Response.json({ error: "unavailable" }, { status: 503 });
				}
				opens.push(body);
				return openStream(opens.length, init?.signal, streamControllers);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const releaseFirst = registerChannel(
			manager,
			"channel:first",
			firstErrors,
			firstEpochEnds,
		);
		await waitFor(() => streamControllers.length === 1);
		const releaseSecond = registerChannel(
			manager,
			"channel:second",
			secondErrors,
			secondEpochEnds,
		);

		await waitFor(() => streamControllers.length === 2);
		expect(controls).toBe(1);
		expect(opens[1]).toMatchObject({
			channels: [{ id: "channel:first" }, { id: "channel:second" }],
		});
		expect(firstErrors).toEqual([]);
		expect(secondErrors).toEqual([]);
		expect(firstEpochEnds).toHaveLength(1);
		expect(secondEpochEnds).toHaveLength(1);

		releaseSecond();
		releaseFirst();
	});

	test("reopens an expired topology session after control reports unavailable", async () => {
		let opens = 0;
		let controls = 0;
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const firstErrors: Error[] = [];
		const secondErrors: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (body.sessionId) {
					controls += 1;
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
				opens += 1;
				return openStream(opens, init?.signal, streamControllers);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const releaseFirst = registerChannel(
			manager,
			"channel:first",
			firstErrors,
			[],
		);
		await waitFor(() => streamControllers.length === 1);
		const releaseSecond = registerChannel(
			manager,
			"channel:second",
			secondErrors,
			[],
		);

		await waitFor(() => streamControllers.length === 2);
		expect(controls).toBe(1);
		expect(opens).toBe(2);
		expect(firstErrors).toEqual([]);
		expect(secondErrors).toEqual([]);

		releaseSecond();
		releaseFirst();
	});

	test("surfaces a terminal control authorization response once and stops reconnecting", async () => {
		let opens = 0;
		let controls = 0;
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const firstErrors: Error[] = [];
		const secondErrors: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (body.sessionId) {
					controls += 1;
					return Response.json({ error: "unauthorized" }, { status: 401 });
				}
				opens += 1;
				return openStream(opens, init?.signal, streamControllers);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const releaseFirst = registerChannel(
			manager,
			"channel:first",
			firstErrors,
			[],
		);
		await waitFor(() => streamControllers.length === 1);
		const releaseSecond = registerChannel(
			manager,
			"channel:second",
			secondErrors,
			[],
		);

		await waitFor(() => firstErrors.length === 1 && secondErrors.length === 1);
		await Bun.sleep(20);
		expect(firstErrors.map((error) => error.message)).toEqual([
			"Realtime control failed: 401",
		]);
		expect(secondErrors.map((error) => error.message)).toEqual([
			"Realtime control failed: 401",
		]);
		expect(controls).toBe(1);
		expect(opens).toBe(1);

		releaseSecond();
		releaseFirst();
	});

	test("surfaces an undispatched control conflict once and stops reconnecting", async () => {
		let opens = 0;
		let controls = 0;
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const firstErrors: Error[] = [];
		const secondErrors: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				if (body.sessionId) {
					controls += 1;
					return Response.json({ error: "conflict" }, { status: 409 });
				}
				opens += 1;
				return openStream(opens, init?.signal, streamControllers);
			},
			debounceMs: 0,
			retryBaseMs: 1,
			maxRetryMs: 1,
			random: () => 0,
		});
		const releaseFirst = registerChannel(
			manager,
			"channel:first",
			firstErrors,
			[],
		);
		await waitFor(() => streamControllers.length === 1);
		const releaseSecond = registerChannel(
			manager,
			"channel:second",
			secondErrors,
			[],
		);

		await waitFor(() => firstErrors.length === 1 && secondErrors.length === 1);
		await Bun.sleep(20);
		expect(firstErrors.map((error) => error.message)).toEqual([
			"Realtime control failed: 409",
		]);
		expect(secondErrors.map((error) => error.message)).toEqual([
			"Realtime control failed: 409",
		]);
		expect(controls).toBe(1);
		expect(opens).toBe(1);

		releaseSecond();
		releaseFirst();
	});

	test("isolates a throwing consumer while terminating a control authorization failure", async () => {
		let opens = 0;
		let controls = 0;
		let openSignal: AbortSignal | null | undefined;
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const siblingErrors: Error[] = [];
		process.on("unhandledRejection", onUnhandled);
		try {
			const manager = new SseConnectionManager({
				baseUrl: "http://localhost:3000",
				withCredentials: true,
				fetcher: async (_input, init) => {
					const body = JSON.parse(String(init?.body)) as Record<
						string,
						unknown
					>;
					if (body.sessionId) {
						controls += 1;
						return Response.json({ error: "unauthorized" }, { status: 401 });
					}
					opens += 1;
					openSignal = init?.signal;
					return openStream(opens, init?.signal, streamControllers);
				},
				debounceMs: 0,
				retryBaseMs: 1,
				maxRetryMs: 1,
				random: () => 0,
			});
			const releaseThrowing = manager.registerChannel({
				id: "channel:throwing",
				openPayload: () => ({
					id: "channel:throwing",
					channel: "channel:throwing",
				}),
				desiredPayload: () => ({
					kind: "channel",
					id: "channel:throwing",
					channel: "channel:throwing",
				}),
				onEvent: () => {},
				onError: () => {
					throw new Error("consumer terminal callback failed");
				},
				onEpochEnd: () => {},
			});
			await waitFor(() => streamControllers.length === 1);
			const releaseSibling = registerChannel(
				manager,
				"channel:sibling",
				siblingErrors,
				[],
			);

			await waitFor(
				() => siblingErrors.length === 1 && openSignal?.aborted === true,
			);
			await Bun.sleep(20);
			expect(siblingErrors.map((error) => error.message)).toEqual([
				"Realtime control failed: 401",
			]);
			expect(unhandled).toEqual([]);
			expect(controls).toBe(1);
			expect(opens).toBe(1);

			releaseSibling();
			releaseThrowing();
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});
});

describe("SSE control session ownership", () => {
	test("does not submit topology for a stream aborted by same-tick releases", async () => {
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const controls: string[] = [];
		let opens = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				if (body.sessionId) {
					controls.push(body.sessionId);
					return Response.json({});
				}
				return openStream(++opens, init?.signal, controllers);
			},
		});
		const releaseFirst = registerChannel(manager, "first", [], []);
		const releaseSecond = registerChannel(manager, "second", [], []);
		await waitFor(() => controllers.length === 1);
		releaseFirst();
		releaseSecond();
		const releaseNew = registerChannel(manager, "new", [], []);
		try {
			await waitFor(() => controllers.length === 2);
			await Bun.sleep(20);
			expect(controls).toEqual([]);
			expect(opens).toBe(2);
		} finally {
			releaseNew();
		}
	});

	test("rechecks an aborted session after awaiting control auth headers", async () => {
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const controls: string[] = [];
		let authCalls = 0;
		let resumeAuth!: () => void;
		const authPending = new Promise<void>((resolve) => {
			resumeAuth = resolve;
		});
		let opens = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			getAuthHeaders: async () => {
				if (++authCalls === 2) await authPending;
				return {};
			},
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				if (body.sessionId) {
					controls.push(body.sessionId);
					return Response.json({});
				}
				return openStream(++opens, init?.signal, controllers);
			},
		});
		const releaseFirst = registerChannel(manager, "first", [], []);
		await waitFor(() => controllers.length === 1);
		const releaseSecond = registerChannel(manager, "second", [], []);
		await waitFor(() => authCalls === 2);
		releaseFirst();
		releaseSecond();
		const releaseNew = registerChannel(manager, "new", [], []);
		try {
			await waitFor(() => controllers.length === 2);
			resumeAuth();
			await Bun.sleep(20);
			expect(controls).toEqual([]);
			expect(opens).toBe(2);
		} finally {
			resumeAuth();
			releaseNew();
		}
	});

	for (const { status, pendingBody } of [
		{ status: 404, pendingBody: false },
		{ status: 401, pendingBody: false },
		{ status: 401, pendingBody: true },
	]) {
		test(`ignores a late ${status}${pendingBody ? " body" : " response"} from an old session and flushes the new topology`, async () => {
			const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
			const signals: AbortSignal[] = [];
			const controls: string[] = [];
			const submitted: {
				sessionId: string;
				topology: { revision: number; subscriptions: { id: string }[] };
			}[] = [];
			let respond!: (response: Response) => void;
			const pending = new Promise<Response>((resolve) => {
				respond = resolve;
			});
			let finishNew!: () => void;
			const pendingNew = new Promise<void>((resolve) => {
				finishNew = resolve;
			});
			let bodyController!: ReadableStreamDefaultController<Uint8Array>;
			const oldBody = new ReadableStream<Uint8Array>({
				start(controller) {
					bodyController = controller;
				},
			});
			let opens = 0;
			const errors: Error[] = [];
			const epochEnds: Error[] = [];
			const manager = new SseConnectionManager({
				baseUrl: "http://localhost:3000",
				withCredentials: true,
				debounceMs: 0,
				fetcher: async (_input, init) => {
					const body = JSON.parse(String(init?.body));
					if (body.sessionId) {
						controls.push(body.sessionId);
						submitted.push(body);
						if (body.sessionId === "edge-1") {
							return pendingBody ? new Response(oldBody, { status }) : pending;
						}
						if (controls.length === 2) await pendingNew;
						return Response.json({});
					}
					signals.push(init!.signal!);
					return openStream(++opens, init?.signal, controllers);
				},
			});
			const releaseFirst = registerChannel(manager, "same-id", [], []);
			await waitFor(() => controllers.length === 1);
			const releaseSecond = registerChannel(manager, "second", [], []);
			await waitFor(() => controls.length === 1);
			releaseFirst();
			releaseSecond();
			await Bun.sleep(5);
			const releaseNew = registerChannel(manager, "same-id", errors, epochEnds);
			await waitFor(() => controllers.length === 2);
			const releaseAdded = registerChannel(manager, "added", errors, epochEnds);
			try {
				await waitFor(() => controls.includes("edge-2"));
				const payload = {
					error: {
						code:
							status === 404 ? "REALTIME_CONTROL_UNAVAILABLE" : "UNAUTHORIZED",
						message: "old session failed",
						topologyEntryId: "same-id",
					},
				};
				if (pendingBody) {
					bodyController.enqueue(encoder.encode(JSON.stringify(payload)));
					bodyController.close();
				} else {
					respond(Response.json(payload, { status }));
				}
				await Bun.sleep(30);
				expect(signals[1]!.aborted).toBe(false);
				expect(opens).toBe(2);
				expect(errors).toEqual([]);
				expect(epochEnds).toEqual([]);
				expect(controls).toEqual(["edge-1", "edge-2"]);
				const releaseThird = registerChannel(
					manager,
					"third",
					errors,
					epochEnds,
				);
				try {
					await Bun.sleep(20);
					expect(controls).toEqual(["edge-1", "edge-2"]);
					finishNew();
					await waitFor(() => controls.length === 3);
					await Bun.sleep(20);
					expect(controls).toEqual(["edge-1", "edge-2", "edge-2"]);
					expect(
						submitted
							.filter((s) => s.sessionId === "edge-2")
							.map((s) => s.topology.revision),
					).toEqual([1, 2]);
					expect(
						submitted.at(-1)!.topology.subscriptions.map((s) => s.id),
					).toEqual(["same-id", "added", "third"]);
				} finally {
					releaseThird();
				}
			} finally {
				finishNew();
				releaseAdded();
				releaseNew();
			}
		});
	}
});

function unavailable(id: string): Record<string, unknown> {
	return {
		code: "REALTIME_AUTHORIZATION_UNAVAILABLE",
		channelSubscriptionId: id,
		message: `${id} authorization unavailable`,
	};
}

function channelFrame(type: string, id: string): Uint8Array {
	return encoder.encode(
		`event: ${type}\ndata: ${JSON.stringify({ channelSubscriptionId: id })}\n\n`,
	);
}

describe("SSE per-channel authorization retries", () => {
	for (const healthySibling of [false, true]) {
		test(`isolates opening 503 with${healthySibling ? "" : "out"} a healthy sibling and stops after five failures`, async () => {
			const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
			const opens: { channels: { id: string }[] }[] = [];
			const controls: { topology: { subscriptions: { id: string }[] } }[] = [];
			const errors: Error[] = [];
			const epochEnds: Error[] = [];
			const healthyErrors: Error[] = [];
			const healthyEpochEnds: Error[] = [];
			let failures = 0;
			const manager = new SseConnectionManager({
				baseUrl: "http://localhost:3000",
				withCredentials: true,
				debounceMs: 0,
				retryBaseMs: 30,
				maxRetryMs: 30,
				random: () => 0,
				fetcher: async (_input, init) => {
					const body = JSON.parse(String(init?.body));
					const entries = body.sessionId
						? body.topology.subscriptions
						: body.channels;
					if (body.sessionId) controls.push(body);
					else opens.push(body);
					if (entries.some((entry: { id: string }) => entry.id === "bad")) {
						failures += 1;
						return Response.json(
							{ error: unavailable("bad") },
							{ status: 503 },
						);
					}
					if (body.sessionId) return Response.json({});
					return openStream(opens.length, init?.signal, controllers);
				},
			});
			const releaseHealthy = healthySibling
				? registerChannel(manager, "healthy", healthyErrors, healthyEpochEnds)
				: () => {};
			const releaseBad = registerChannel(manager, "bad", errors, epochEnds);
			try {
				await waitFor(() => errors.length === 1, 500);
				await Bun.sleep(40);
				expect(failures).toBe(5);
				expect(errors.map((error) => error.message)).toEqual([
					"bad authorization unavailable",
				]);
				expect(epochEnds).toHaveLength(5);
				expect(healthyErrors).toEqual([]);
				expect(healthyEpochEnds).toEqual([]);
				expect(opens.every((body) => body.channels.length > 0)).toBe(true);
				expect(controllers).toHaveLength(healthySibling ? 1 : 0);
				if (healthySibling) {
					expect(opens).toHaveLength(2);
					expect(opens[1]!.channels).toEqual([
						{ id: "healthy", channel: "healthy" },
					]);
					expect(
						controls.at(-1)!.topology.subscriptions.map((entry) => entry.id),
					).toEqual(["healthy"]);
				}
			} finally {
				releaseBad();
				releaseHealthy();
			}
		});
	}

	test("keeps the healthy physical stream on topology 503, then recovers and resets the failure budget", async () => {
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const signals: AbortSignal[] = [];
		const submissions: string[][] = [];
		const errors: Error[] = [];
		const epochEnds: Error[] = [];
		const healthyEpochEnds: Error[] = [];
		let remainingFailures = 4;
		let ready = 0;
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			retryBaseMs: 20,
			maxRetryMs: 20,
			random: () => 0,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				if (!body.sessionId) {
					signals.push(init!.signal!);
					return openStream(signals.length, init?.signal, controllers);
				}
				const ids = body.topology.subscriptions.map(
					(entry: { id: string }) => entry.id,
				);
				submissions.push(ids);
				if (ids.includes("bad")) {
					if (remainingFailures-- > 0) {
						return Response.json(
							{ error: unavailable("bad") },
							{ status: 503 },
						);
					}
					controllers[0]!.enqueue(channelFrame("channel_ready", "bad"));
				}
				return Response.json({});
			},
		});
		const releaseHealthy = registerChannel(
			manager,
			"healthy",
			[],
			healthyEpochEnds,
		);
		await waitFor(() => controllers.length === 1);
		const releaseBad = manager.registerChannel({
			id: "bad",
			openPayload: () => ({ id: "bad", channel: "bad" }),
			desiredPayload: () => ({ kind: "channel", id: "bad", channel: "bad" }),
			onError: (error) => errors.push(error),
			onEpochEnd: (error) => epochEnds.push(error),
			onEvent: (event) => {
				if (event.type === "channel_ready") ready += 1;
			},
		});
		try {
			await waitFor(() => ready === 1, 500);
			expect(epochEnds).toHaveLength(4);
			expect(errors).toEqual([]);
			expect(signals).toHaveLength(1);
			expect(signals[0]!.aborted).toBe(false);
			expect(healthyEpochEnds).toEqual([]);
			// A timer waking before its deadline may repeat the cooling-down
			// topology. Assert transitions and retry count, not timer precision.
			const topologyChanges = submissions.filter(
				(ids, index) =>
					index === 0 || ids.join() !== submissions[index - 1]!.join(),
			);
			expect(topologyChanges).toEqual([
				...Array.from({ length: 4 }, () => [
					["healthy", "bad"],
					["healthy"],
				]).flat(),
				["healthy", "bad"],
			]);
			expect(submissions.filter((ids) => ids.includes("bad"))).toHaveLength(5);
			remainingFailures = 3;
			controllers[0]!.enqueue(
				encoder.encode(
					`event: error\ndata: ${JSON.stringify(unavailable("bad"))}\n\n`,
				),
			);
			await waitFor(() => ready === 2, 500);
			expect(errors).toEqual([]);
			expect(epochEnds).toHaveLength(8);
		} finally {
			releaseBad();
			releaseHealthy();
		}
	});

	test("omits an SSE-failed channel on physical reopen and cancels its retry on release", async () => {
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const opens: { channels: { id: string }[] }[] = [];
		const controls: unknown[] = [];
		const errors: Error[] = [];
		const epochEnds: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			retryBaseMs: 100,
			maxRetryMs: 100,
			random: () => 0,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				if (body.sessionId) {
					controls.push(body);
					return Response.json({});
				}
				opens.push(body);
				return openStream(opens.length, init?.signal, controllers);
			},
		});
		const releaseHealthy = registerChannel(manager, "healthy", [], []);
		const releaseBad = registerChannel(manager, "bad", errors, epochEnds);
		try {
			await waitFor(() => controllers.length === 1);
			controllers[0]!.enqueue(
				encoder.encode(
					`event: error\ndata: ${JSON.stringify(unavailable("bad"))}\n\n`,
				),
			);
			controllers[0]!.close();
			await waitFor(() => controllers.length === 2, 500);
			expect(opens[1]!.channels.map((entry) => entry.id)).toEqual(["healthy"]);
			expect(errors).toEqual([]);
			expect(epochEnds).toHaveLength(1);
			releaseBad();
			releaseHealthy();
			const controlCount = controls.length;
			await Bun.sleep(120);
			expect(opens).toHaveLength(2);
			expect(controls).toHaveLength(controlCount);
		} finally {
			releaseBad();
			releaseHealthy();
		}
	});
});

for (const addressed of ["released", "unknown", "query"] as const) {
	test(`in-flight topology 503 for ${addressed} id preserves resource-kind isolation`, async () => {
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const signals: AbortSignal[] = [];
		const errors: Error[] = [],
			epochEnds: Error[] = [],
			healthyEpochEnds: Error[] = [];
		const submissions: string[][] = [];
		let releaseResponse!: () => void;
		const responseGate = new Promise<void>((resolve) => {
			releaseResponse = resolve;
		});
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			debounceMs: 0,
			retryBaseMs: 20,
			maxRetryMs: 20,
			random: () => 0,
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				if (!body.sessionId) {
					signals.push(init!.signal!);
					return openStream(signals.length, init?.signal, controllers);
				}
				const ids = body.topology.subscriptions.map(
					(entry: { id: string }) => entry.id,
				);
				submissions.push(ids);
				if (submissions.length === 1) {
					await responseGate;
					return Response.json(
						{
							error: unavailable(addressed === "released" ? "bad" : addressed),
						},
						{ status: 503 },
					);
				}
				return Response.json({});
			},
		});
		const releaseHealthy = registerChannel(
			manager,
			"healthy",
			[],
			healthyEpochEnds,
		);
		await waitFor(() => controllers.length === 1);
		const releaseQuery =
			addressed === "query"
				? manager.registerTopic({
						id: "query",
						openPayload: () => ({ id: "query", resource: "posts" }),
						desiredPayload: () => ({
							kind: "query",
							id: "query",
							resource: "posts",
						}),
						onEvent: () => {},
						onError: (error) => errors.push(error),
					})
				: () => {};
		const releaseBad = registerChannel(manager, "bad", errors, epochEnds);
		try {
			await waitFor(() => submissions.length === 1);
			releaseBad();
			releaseResponse();
			if (addressed === "query") {
				await waitFor(() => signals[0]!.aborted);
			} else {
				await Bun.sleep(60);
				expect(signals).toHaveLength(1);
				expect(signals[0]!.aborted).toBe(false);
				expect(healthyEpochEnds).toEqual([]);
				expect(errors).toEqual([]);
				expect(epochEnds).toEqual([]);
				expect(submissions[1]).toEqual(["healthy"]);
			}
		} finally {
			releaseResponse();
			releaseBad();
			releaseQuery();
			releaseHealthy();
		}
	});
}
