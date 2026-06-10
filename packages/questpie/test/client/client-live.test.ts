import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createClient } from "../../src/client/index.js";

/**
 * `live()` / `liveIter()` are thin wrappers over the realtime multiplexer,
 * which talks to `POST /realtime` via the global `fetch`. These tests mock
 * the global fetch with a controllable SSE stream and assert the full path:
 * topic payload sent to the server, snapshots delivered to callbacks,
 * unsubscribe/abort semantics, and topic dedupe.
 */

const encoder = new TextEncoder();

type SSEConnection = {
	topics: Array<{
		id: string;
		resourceType: string;
		resource: string;
		where?: Record<string, unknown>;
		with?: Record<string, unknown>;
		limit?: number;
		orderBy?: Record<string, string>;
	}>;
	sendSnapshot: (topicId: string, seq: number, data: unknown) => void;
	aborted: boolean;
};

async function waitFor(assertion: () => boolean, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for assertion");
}

describe("client live queries", () => {
	let originalFetch: typeof globalThis.fetch;
	let connections: SSEConnection[];
	let client: ReturnType<typeof createClient<any>>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		connections = [];

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected fetch in test: ${url}`);
			}

			const { topics } = JSON.parse(String(init?.body));
			let controller!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
				},
			});

			const connection: SSEConnection = {
				topics,
				aborted: false,
				sendSnapshot(topicId, seq, data) {
					try {
						controller.enqueue(
							encoder.encode(
								`event: snapshot\ndata: ${JSON.stringify({ topicId, seq, data })}\n\n`,
							),
						);
					} catch {
						// Stream already closed
					}
				},
			};

			// Mirror real fetch: aborting the request kills the body stream.
			init?.signal?.addEventListener("abort", () => {
				connection.aborted = true;
				try {
					controller.close();
				} catch {
					// Already closed
				}
			});

			connections.push(connection);
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}) as typeof fetch;

		client = createClient<any>({ baseURL: "http://localhost:3000" });
	});

	afterEach(() => {
		client.realtime.destroy();
		globalThis.fetch = originalFetch;
	});

	it("live() sends the query as a topic and delivers snapshots until unsubscribed", async () => {
		const snapshots: any[] = [];
		const stop = client.collections.posts.live(
			{ where: { status: "published" }, limit: 10 },
			(snapshot) => snapshots.push(snapshot),
		);

		await waitFor(() => connections.length === 1);
		const connection = connections[0];

		// Topic mirrors the find() options — object topic, never strings
		expect(connection.topics).toHaveLength(1);
		expect(connection.topics[0].resourceType).toBe("collection");
		expect(connection.topics[0].resource).toBe("posts");
		expect(connection.topics[0].where).toEqual({ status: "published" });
		expect(connection.topics[0].limit).toBe(10);

		// Initial snapshot
		const topicId = connection.topics[0].id;
		const first = { docs: [{ id: "1", status: "published" }], totalDocs: 1 };
		connection.sendSnapshot(topicId, 1, first);
		await waitFor(() => snapshots.length === 1);
		expect(snapshots[0]).toEqual(first);

		// Post-change snapshot
		const second = {
			docs: [
				{ id: "1", status: "published" },
				{ id: "2", status: "published" },
			],
			totalDocs: 2,
		};
		connection.sendSnapshot(topicId, 2, second);
		await waitFor(() => snapshots.length === 2);
		expect(snapshots[1]).toEqual(second);

		// Unsubscribe stops delivery (multiplexer drops the topic + aborts)
		stop();
		await waitFor(() => connection.aborted);
		connection.sendSnapshot(topicId, 3, { docs: [], totalDocs: 0 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(snapshots).toHaveLength(2);
	});

	it("live() with identical options shares one SSE topic", async () => {
		const a: any[] = [];
		const b: any[] = [];
		const options = { where: { status: "published" } };

		const stopA = client.collections.posts.live(options, (s) => a.push(s));
		const stopB = client.collections.posts.live(options, (s) => b.push(s));

		await waitFor(() => connections.length >= 1);
		// Allow the debounce window to settle before asserting topic count
		await new Promise((resolve) => setTimeout(resolve, 100));

		const connection = connections[connections.length - 1];
		expect(connection.topics).toHaveLength(1);

		connection.sendSnapshot(connection.topics[0].id, 1, { docs: [] });
		await waitFor(() => a.length === 1 && b.length === 1);

		stopA();
		stopB();
	});

	it("liveIter() yields snapshots and terminates on abort", async () => {
		const abortController = new AbortController();
		const received: any[] = [];

		const iteration = (async () => {
			for await (const snapshot of client.collections.posts.liveIter(
				{ limit: 5 },
				{ signal: abortController.signal },
			)) {
				received.push(snapshot);
			}
		})();

		await waitFor(() => connections.length === 1);
		const connection = connections[0];
		expect(connection.topics[0].resource).toBe("posts");
		expect(connection.topics[0].limit).toBe(5);

		connection.sendSnapshot(connection.topics[0].id, 1, {
			docs: [{ id: "1" }],
			totalDocs: 1,
		});
		await waitFor(() => received.length === 1);

		abortController.abort();
		await iteration; // generator must terminate
		expect(received).toHaveLength(1);
	});

	it("global live() subscribes with a global topic and delivers snapshots", async () => {
		const snapshots: any[] = [];
		const stop = client.globals.siteSettings.live(undefined, (snapshot) =>
			snapshots.push(snapshot),
		);

		await waitFor(() => connections.length === 1);
		const connection = connections[0];
		expect(connection.topics[0].resourceType).toBe("global");
		expect(connection.topics[0].resource).toBe("siteSettings");

		connection.sendSnapshot(connection.topics[0].id, 1, {
			siteName: "QUESTPIE",
		});
		await waitFor(() => snapshots.length === 1);
		expect(snapshots[0]).toEqual({ siteName: "QUESTPIE" });

		stop();
	});
});
