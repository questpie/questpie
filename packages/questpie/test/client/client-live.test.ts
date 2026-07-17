import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { createClient } from "../../src/client/index.js";
import {
	RealtimeMultiplexer,
	RealtimeTopicRejectedError,
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
	sendError: (
		topicId: string,
		message: string,
		payload?: Record<string, unknown>,
	) => void;
	close: () => void;
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
	let controlTopologies: Array<Record<string, any>>;
	let client: ReturnType<typeof createClient<any>>;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		connections = [];
		controlTopologies = [];

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
				controlTopologies.push(payload.topology);
				return Response.json({ status: "accepted" }, { status: 202 });
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
				sendError(topicId, message, payload = {}) {
					controller.enqueue(
						encoder.encode(
							`event: error\ndata: ${JSON.stringify({ topicId, message, ...payload })}\n\n`,
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
					`event: session\ndata: ${JSON.stringify({ sessionId: `session-${connections.length}`, token: `token-${connections.length}`, control: { protocol: "questpie-realtime-topology", versions: [1] } })}\n\n`,
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

		// Removing the last topic closes locally without a control request.
		stop();
		await waitFor(() => connection.aborted);
		expect(controlTopologies).toHaveLength(0);
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

	it("adds one mounted topic with desired topology and no reconnect", async () => {
		const stopPosts = client.collections.posts.live({}, () => {});
		await waitFor(() => connections.length === 1);
		await new Promise((resolve) => setTimeout(resolve, 20));

		const stopPages = client.collections.pages.live({}, () => {});
		await waitFor(() =>
			controlTopologies.some((topology) =>
				topology.topics.some((entry: any) => entry.topic.resource === "pages"),
			),
		);

		expect(connections).toHaveLength(1);
		expect(connections[0].aborted).toBe(false);
		expect(controlTopologies).toHaveLength(1);
		expect(controlTopologies[0].protocol).toBe("questpie-realtime-topology");
		expect(controlTopologies[0].topics).toHaveLength(2);

		stopPages();
		stopPosts();
	});

	it("coalesces advertised v1 desired topology and closes the last topic locally", async () => {
		const controls: Array<Record<string, any>> = [];
		let streamController!: ReadableStreamDefaultController<Uint8Array>;
		let aborted = false;
		const fetcher: typeof fetch = async (_input, init) => {
			const payload = JSON.parse(String(init?.body));
			if (payload.sessionId) {
				controls.push(payload);
				return Response.json(
					{
						protocol: "questpie-realtime-topology",
						version: 1,
						status: "accepted",
						revision: payload.topology.revision,
						desiredRevision: payload.topology.revision,
						appliedRevision: payload.topology.revision - 1,
					},
					{ status: 202 },
				);
			}
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					streamController = controller;
					controller.enqueue(
						encoder.encode(
							`event: session\ndata: ${JSON.stringify({
								sessionId: "session-v1",
								token: "token-v1",
								control: {
									protocol: "questpie-realtime-topology",
									versions: [1],
								},
							})}\n\n`,
						),
					);
				},
			});
			init?.signal?.addEventListener("abort", () => {
				aborted = true;
				streamController.close();
			});
			return new Response(stream, {
				headers: { "Content-Type": "text/event-stream" },
			});
		};
		const multiplexer = new RealtimeMultiplexer(
			"http://localhost:3000",
			true,
			0,
			{},
			undefined,
			fetcher,
		);
		const stopPosts = multiplexer.subscribe(
			{ resourceType: "collection", resource: "posts" },
			() => {},
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const stopPages = multiplexer.subscribe(
			{ resourceType: "collection", resource: "pages" },
			() => {},
		);
		const stopUsers = multiplexer.subscribe(
			{ resourceType: "collection", resource: "users" },
			() => {},
		);

		await waitFor(() => controls.length === 1);
		expect(controls[0].topology.revision).toBe(1);
		expect(controls[0].topology.topics).toHaveLength(3);
		expect(controls[0].frames).toBeUndefined();

		stopPages();
		stopUsers();
		await waitFor(() => controls.length === 2);
		expect(controls[1].topology.revision).toBe(2);
		expect(controls[1].topology.topics).toHaveLength(1);
		stopPosts();
		await waitFor(() => aborted);
		expect(controls).toHaveLength(2);
		multiplexer.destroy();
	});

	it("reconnects with the exact active topic set and per-topic sinceSeq", async () => {
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
		multiplexer.subscribe(
			{ resourceType: "collection", resource: "pages" },
			(snapshot) => snapshots.push(snapshot),
			undefined,
			"resume-pages",
		);
		await waitFor(() => connections.length === 1);
		connections[0].sendSnapshot("resume-posts", 7, { docs: [{ id: "7" }] });
		connections[0].sendSnapshot("resume-pages", 11, { docs: [{ id: "11" }] });
		await waitFor(() => snapshots.length === 2);

		connections[0].close();
		await new Promise((resolve) => setTimeout(resolve, 1));
		expect(connections).toHaveLength(1);
		await waitFor(() => connections.length === 2);
		expect(
			connections[1].topics
				.map(({ id, resource, sinceSeq }) => ({ id, resource, sinceSeq }))
				.sort((left, right) => left.id.localeCompare(right.id)),
		).toEqual([
			{ id: "resume-pages", resource: "pages", sinceSeq: 11 },
			{ id: "resume-posts", resource: "posts", sinceSeq: 7 },
		]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(snapshots).toHaveLength(2);
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

		connections[0].sendError(
			"posts-topic",
			"Topic limit must be between 1 and 100",
			{
				code: "REALTIME_TOPIC_REJECTED",
				resource: "posts",
				operation: "find",
				retryable: false,
				details: {
					reason: "query_limit",
					requestedLimit: 240,
					configuredLimit: 100,
				},
			},
		);
		await waitFor(() => postErrors.length === 1);
		expect(postErrors[0]).toBeInstanceOf(RealtimeTopicRejectedError);
		expect(postErrors[0]).toMatchObject({
			code: "REALTIME_TOPIC_REJECTED",
			topicId: "posts-topic",
			resource: "posts",
			operation: "find",
			retryable: false,
			details: {
				reason: "query_limit",
				requestedLimit: 240,
				configuredLimit: 100,
			},
		});
		expect(pageErrors).toHaveLength(0);
		expect(client.realtime.topicCount).toBe(1);

		stopPosts();
		stopPages();
	});

	it("delivers an initial admission response once and removes the rejected topic", async () => {
		let calls = 0;
		const fetcher = (async () => {
			calls += 1;
			return Response.json(
				{
					errors: [
						{
							code: "REALTIME_TOPIC_REJECTED",
							message: "Topic limit must be between 1 and 100",
							topicId: "media-topic",
							resource: "media",
							operation: "find",
							retryable: false,
							details: {
								reason: "query_limit",
								requestedLimit: 240,
								configuredLimit: 100,
							},
						},
					],
				},
				{ status: 400 },
			);
		}) as typeof fetch;
		const multiplexer = new RealtimeMultiplexer(
			"http://localhost",
			true,
			0,
			{ retryBaseMs: 1, maxRetryMs: 1 },
			undefined,
			fetcher,
		);
		const errors: Error[] = [];
		multiplexer.subscribe(
			{ resourceType: "collection", resource: "media", limit: 240 },
			() => {},
			undefined,
			"media-topic",
			(error) => errors.push(error),
		);

		await waitFor(() => errors.length === 1);
		expect(errors[0]).toBeInstanceOf(RealtimeTopicRejectedError);
		expect(calls).toBe(1);
		expect(multiplexer.topicCount).toBe(0);
		multiplexer.destroy();
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
