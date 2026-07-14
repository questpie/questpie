import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { createClient } from "../../src/client/index.js";
import {
	RealtimeMultiplexer,
	realtimeReconnectDelay,
} from "../../src/client/realtime/multiplexer.js";
import { sseSnapshotStream } from "../../src/client/realtime/stream.js";

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
		operation?: "find" | "count" | "get";
		recordId?: string;
		where?: Record<string, unknown>;
		with?: Record<string, unknown>;
		limit?: number;
		orderBy?: Record<string, string>;
		sinceSeq?: number;
	}>;
	sendSnapshot: (topicId: string, seq: number, data: unknown) => void;
	sendError: (topicId: string, message: string) => void;
	close: () => void;
	aborted: boolean;
};

type ControlFrame = { type: string; topicId: string; topic?: unknown };

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
	let controlFrames: ControlFrame[];
	let client: ReturnType<typeof createClient<any>>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		connections = [];
		controlFrames = [];

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			if (!url.endsWith("/realtime")) {
				throw new Error(`Unexpected fetch in test: ${url}`);
			}

			const payload = JSON.parse(String(init?.body));
			if (payload.sessionId) {
				controlFrames.push(...payload.frames);
				return new Response(null, { status: 204 });
			}
			const { topics } = payload;
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
				sendError(topicId, message) {
					controller.enqueue(
						encoder.encode(
							`event: error\ndata: ${JSON.stringify({ topicId, message })}\n\n`,
						),
					);
				},
				close() {
					controller.close();
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
			controller.enqueue(
				encoder.encode(
					`event: session\ndata: ${JSON.stringify({ sessionId: `session-${connections.length}`, token: `token-${connections.length}` })}\n\n`,
				),
			);
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

	it("jitters reconnect backoff across the full plus-or-minus 50 percent range", () => {
		expect(realtimeReconnectDelay(1000, 0, 30_000, () => 0)).toBe(500);
		expect(realtimeReconnectDelay(1000, 0, 30_000, () => 1)).toBe(1500);
		expect(realtimeReconnectDelay(1000, 10, 30_000, () => 0.5)).toBe(30_000);
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
		expect(connection.topics[0].operation).toBe("find");
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

		// Unsubscribe stops delivery through one incremental remove frame.
		stop();
		await waitFor(() =>
			controlFrames.some(
				(frame) => frame.type === "remove_topic" && frame.topicId === topicId,
			),
		);
		expect(connection.aborted).toBe(false);
		connection.sendSnapshot(topicId, 3, { docs: [], totalDocs: 0 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(snapshots).toHaveLength(2);
	});

	it("keeps collection get record ids separate from subscription ids", async () => {
		const multiplexer = new RealtimeMultiplexer(
			"http://localhost:3000",
			true,
			0,
		);
		multiplexer.subscribe(
			{
				resourceType: "collection",
				resource: "posts",
				operation: "get",
				id: "post-1",
			},
			() => {},
			undefined,
			"topic-post-1",
		);

		await waitFor(() => connections.length === 1);
		expect(connections[0].topics[0]).toMatchObject({
			id: "topic-post-1",
			resourceType: "collection",
			resource: "posts",
			operation: "get",
			recordId: "post-1",
		});
		multiplexer.destroy();
	});

	it("adds one mounted topic with one control frame and no reconnect", async () => {
		const stopPosts = client.collections.posts.live({}, () => {});
		await waitFor(() => connections.length === 1);
		await new Promise((resolve) => setTimeout(resolve, 20));

		const stopPages = client.collections.pages.live({}, () => {});
		await waitFor(() =>
			controlFrames.some(
				(frame) =>
					frame.type === "add_topic" &&
					(frame.topic as any)?.resource === "pages",
			),
		);

		expect(connections).toHaveLength(1);
		expect(connections[0].aborted).toBe(false);
		expect(
			controlFrames.filter((frame) => frame.type === "add_topic"),
		).toHaveLength(1);

		stopPages();
		stopPosts();
	});

	it("reconnects a clean close with sinceSeq and skips duplicate delivery", async () => {
		const multiplexer = new RealtimeMultiplexer(
			"http://localhost:3000",
			true,
			0,
			{
				retryBaseMs: 10,
				maxRetryMs: 10,
				pingWatchdogMs: 1000,
				random: () => 0.5,
			},
		);
		const snapshots: unknown[] = [];
		multiplexer.subscribe(
			{ resourceType: "collection", resource: "posts" },
			(snapshot) => snapshots.push(snapshot),
			undefined,
			"resume-posts",
		);
		await waitFor(() => connections.length === 1);
		connections[0].sendSnapshot("resume-posts", 7, { docs: [{ id: "7" }] });
		await waitFor(() => snapshots.length === 1);

		connections[0].close();
		await new Promise((resolve) => setTimeout(resolve, 1));
		expect(connections).toHaveLength(1);
		await waitFor(() => connections.length === 2);
		expect(connections[1].topics[0].sinceSeq).toBe(7);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(snapshots).toHaveLength(1);
		multiplexer.destroy();
	});

	it("reconnects a half-open stream when ping activity stops", async () => {
		const multiplexer = new RealtimeMultiplexer(
			"http://localhost:3000",
			true,
			0,
			{
				retryBaseMs: 5,
				maxRetryMs: 5,
				pingWatchdogMs: 20,
				random: () => 0.5,
			},
		);
		multiplexer.subscribe(
			{ resourceType: "collection", resource: "posts" },
			() => {},
		);

		await waitFor(() => connections.length === 2);
		expect(connections[0].aborted).toBe(true);
		multiplexer.destroy();
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

	it("delivers a topic error only to that topic's subscribers", async () => {
		const postErrors: Error[] = [];
		const pageErrors: Error[] = [];
		const stopPosts = client.realtime.subscribe(
			{ resourceType: "collection", resource: "posts" },
			() => {},
			undefined,
			"posts-topic",
			(error) => postErrors.push(error),
		);
		const stopPages = client.realtime.subscribe(
			{ resourceType: "collection", resource: "pages" },
			() => {},
			undefined,
			"pages-topic",
			(error) => pageErrors.push(error),
		);
		await waitFor(() => connections.length === 1);

		connections[0].sendError("posts-topic", "posts denied");
		await waitFor(() => postErrors.length === 1);
		expect(postErrors[0].message).toBe("posts denied");
		expect(pageErrors).toHaveLength(0);

		stopPosts();
		stopPages();
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

	it("liveIter() installs one abort listener for the whole snapshot stream", async () => {
		const abortController = new AbortController();
		const addSpy = spyOn(abortController.signal, "addEventListener");
		const removeSpy = spyOn(abortController.signal, "removeEventListener");
		let deliver: ((data: unknown) => void) | undefined;
		const multiplexer = {
			subscribe: (_topic: unknown, callback: (data: unknown) => void) => {
				deliver = callback;
				return () => {};
			},
		} as unknown as RealtimeMultiplexer;
		const stream = sseSnapshotStream<number>({
			multiplexer,
			topic: { resourceType: "collection", resource: "posts" },
			signal: abortController.signal,
		});

		const first = stream.next();
		await waitFor(() => typeof deliver === "function");
		deliver!(1);
		expect((await first).value).toBe(1);
		const second = stream.next();
		deliver!(2);
		expect((await second).value).toBe(2);
		expect(addSpy).toHaveBeenCalledTimes(1);

		abortController.abort();
		await stream.next();
		expect(removeSpy).toHaveBeenCalledTimes(1);
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

	// Regression: concurrent live()/realtime queries must each get a distinct
	// topic id. A truncated topic hash (slice(0,24)) keyed only the first ~5
	// chars of the resource name, so `events` and `event_members` (and any two
	// queries past the truncation window) collapsed to one id — first-writer-wins
	// dropped the loser's topic from the POST payload and cross-wired its
	// snapshots. Found dogfooding the Jubli guest feed.
	it("concurrent live() on prefix-colliding collections keep separate topics (no cross-wire)", async () => {
		const events: any[] = [];
		const members: any[] = [];

		const stopEvents = client.collections.events.live(
			{ where: { id: "evt_1" } },
			(s) => events.push(s),
		);
		const stopMembers = client.collections.event_members.live(
			{ where: { event: "evt_1" } },
			(s) => members.push(s),
		);

		await waitFor(() => connections.length >= 1);
		// Settle the debounce window so both topics are on one connection.
		await new Promise((resolve) => setTimeout(resolve, 100));

		const connection = connections[connections.length - 1];

		// Both queries must reach the server as DISTINCT topics, not collapsed.
		expect(connection.topics).toHaveLength(2);
		const eventsTopic = connection.topics.find((t) => t.resource === "events");
		const membersTopic = connection.topics.find(
			(t) => t.resource === "event_members",
		);
		expect(eventsTopic).toBeDefined();
		expect(membersTopic).toBeDefined();
		expect(eventsTopic!.id).not.toBe(membersTopic!.id);

		// A snapshot for event_members must reach ONLY the members callback.
		const memberRows = {
			docs: [{ id: "m1", displayName: "Ada" }],
			totalDocs: 1,
		};
		connection.sendSnapshot(membersTopic!.id, 1, memberRows);
		await waitFor(() => members.length === 1);
		expect(members[0]).toEqual(memberRows);
		expect(events).toHaveLength(0);

		stopEvents();
		stopMembers();
	});

	it("concurrent live() on the same collection with different where keep separate topics", async () => {
		const a: any[] = [];
		const b: any[] = [];

		const stopA = client.collections.posts.live(
			{ where: { event: "A" } },
			(s) => a.push(s),
		);
		const stopB = client.collections.posts.live(
			{ where: { event: "B" } },
			(s) => b.push(s),
		);

		await waitFor(() => connections.length >= 1);
		await new Promise((resolve) => setTimeout(resolve, 100));

		const connection = connections[connections.length - 1];
		expect(connection.topics).toHaveLength(2);

		const topicA = connection.topics.find(
			(t) => (t.where as any)?.event === "A",
		);
		const topicB = connection.topics.find(
			(t) => (t.where as any)?.event === "B",
		);
		expect(topicA).toBeDefined();
		expect(topicB).toBeDefined();
		expect(topicA!.id).not.toBe(topicB!.id);

		connection.sendSnapshot(topicA!.id, 1, {
			docs: [{ id: "a1" }],
			totalDocs: 1,
		});
		await waitFor(() => a.length === 1);
		expect(b).toHaveLength(0);

		stopA();
		stopB();
	});
});
