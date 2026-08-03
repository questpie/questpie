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
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const errors: Error[] = [];
		const epochEnds: Error[] = [];
		const manager = new SseConnectionManager({
			baseUrl: "http://localhost:3000",
			withCredentials: true,
			fetcher: async (_input, init) => {
				requests += 1;
				if (requests === 1) throw new Error("socket unavailable");
				return openStream(requests, init?.signal, controllers);
			},
			debounceMs: 0,
			retryBaseMs: 40,
			maxRetryMs: 40,
			random: () => 0,
		});
		const release = registerChannel(manager, "channel:news", errors, epochEnds);

		await waitFor(() => requests === 1);
		await Bun.sleep(10);
		expect(requests).toBe(1);
		expect(errors).toEqual([]);
		await waitFor(() => controllers.length === 1);
		expect(requests).toBe(2);
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
