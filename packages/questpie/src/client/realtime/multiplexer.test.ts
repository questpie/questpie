import { describe, expect, it } from "bun:test";

import { RealtimeMultiplexer, type TopicConfig } from "./multiplexer.js";

/* ============================================================================
   THE SUBSCRIBE REQUEST IS BUILT BEFORE THE FIRST `await`, NOT AFTER IT.

   `connect()` guards `this.topics.size === 0` on entry and then suspends on
   `await this.getAuthHeaders?.()`. The request body used to be a closure
   evaluated after that suspension, so anything which emptied the topic map in
   between — a route change, an effect cleanup, a double-invoked mount — put
   `{ topics: [] }` on the wire. The server answers `realtime.topicsRequired`,
   400, and the client swallows it: the `catch` sees an empty topic map and
   returns without retrying.

   Observed in a consumer as two silent `400 POST /api/realtime` on every page
   load, one per live arm. The wasted round trips were the visible half; the real
   cost is the window where topics empty and REFILL during the await, because the
   stale-empty body still 400s and the newly-arrived topics are left unsubscribed
   until something else triggers a connect.

   `getAuthHeaders` and `fetcher` are both constructor-injected, so the race can
   be reproduced exactly rather than approximated with timing.
   ============================================================================ */

const TOPIC: TopicConfig = { resourceType: "collection", resource: "tasks" };
const OTHER: TopicConfig = { resourceType: "collection", resource: "goals" };

/** A fetcher that records every body it is handed and never resolves a stream. */
function recordingFetcher() {
	const bodies: unknown[] = [];
	const fetcher = (async (_url: string, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body ?? "null")));
		// Enough of a Response for `connect()` to bail before touching the stream.
		return new Response(null, { status: 204 });
	}) as unknown as typeof fetch;
	return { bodies, fetcher };
}

/** A gate that lets the test hold `connect()` open at its suspension point. */
function gate() {
	let release!: () => void;
	const opened = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered!: () => void;
	const reached = new Promise<void>((resolve) => {
		entered = resolve;
	});
	return {
		release,
		reached,
		getAuthHeaders: async () => {
			entered();
			await opened;
			return {} as Record<string, string>;
		},
	};
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("RealtimeMultiplexer connect payload", () => {
	it("never posts an empty topics array when the last subscriber leaves mid-connect", async () => {
		const { bodies, fetcher } = recordingFetcher();
		const g = gate();
		const mux = new RealtimeMultiplexer(
			"http://localhost",
			false,
			0,
			{},
			g.getAuthHeaders,
			fetcher,
		);

		const unsubscribe = mux.subscribe(TOPIC, () => {});
		await g.reached; // connect() is parked on getAuthHeaders

		unsubscribe(); // the window: every subscriber leaves while we are suspended
		g.release();
		await tick(20);

		// Either no request at all, or one carrying real topics — never `[]`.
		for (const body of bodies) {
			const topics = (body as { topics?: unknown[] } | null)?.topics;
			expect(Array.isArray(topics) ? topics.length : 1).toBeGreaterThan(0);
		}

		mux.destroy?.();
	});

	it("still sends the topics that were present when the guard passed", async () => {
		const { bodies, fetcher } = recordingFetcher();
		const g = gate();
		const mux = new RealtimeMultiplexer(
			"http://localhost",
			false,
			0,
			{},
			g.getAuthHeaders,
			fetcher,
		);

		mux.subscribe(TOPIC, () => {});
		await g.reached;
		g.release();
		await tick(20);

		expect(bodies.length).toBeGreaterThan(0);
		const topics = (bodies[0] as { topics: Array<{ resource: string }> })
			.topics;
		expect(topics.map((topic) => topic.resource)).toContain("tasks");

		mux.destroy?.();
	});

	/**
	 * A subscriber arriving during the suspension is the case a stale snapshot
	 * cannot serve on its own. It does not have to be in THIS request — the
	 * control channel reconciles the desired topology right after connect — but
	 * the request must still be well-formed, which is what regressed.
	 */
	it("stays well-formed when a subscriber arrives mid-connect", async () => {
		const { bodies, fetcher } = recordingFetcher();
		const g = gate();
		const mux = new RealtimeMultiplexer(
			"http://localhost",
			false,
			0,
			{},
			g.getAuthHeaders,
			fetcher,
		);

		const unsubscribe = mux.subscribe(TOPIC, () => {});
		await g.reached;

		unsubscribe();
		mux.subscribe(OTHER, () => {});
		g.release();
		await tick(20);

		// A refill leaves the map non-empty, so the connect must go out. Without
		// this the loop below runs zero times and the test passes on silence.
		expect(bodies.length).toBeGreaterThan(0);
		for (const body of bodies) {
			const topics = (body as { topics?: unknown[] } | null)?.topics;
			expect(Array.isArray(topics) ? topics.length : 1).toBeGreaterThan(0);
		}

		mux.destroy?.();
	});
});
