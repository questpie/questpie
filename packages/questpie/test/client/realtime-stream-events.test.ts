import { describe, expect, it } from "bun:test";

import {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	deriveFindDeltas,
	type RealtimeStreamEvent,
	sseEventStream,
} from "../../src/client/realtime/stream.js";
import type { RealtimeClientTransport } from "../../src/client/realtime/transport.js";

type Row = { id: string; title: string };

describe("realtime stream events", () => {
	it("fails and tears down a subscriber whose consumer queue overflows", async () => {
		let deliver: ((event: RealtimeStreamEvent) => void) | undefined;
		let unsubscribeCalls = 0;
		const transport = {
			subscribe: (
				_topic: unknown,
				onEvent: (event: RealtimeStreamEvent) => void,
			) => {
				deliver = onEvent;
				return () => {
					unsubscribeCalls += 1;
				};
			},
		} as unknown as RealtimeClientTransport;
		const stream = sseEventStream({
			multiplexer: transport,
			topic: {
				resourceType: "collection",
				resource: "posts",
				operation: "find",
			},
		});
		const first = stream.next();
		await Promise.resolve();

		for (let seq = 1; seq <= 513; seq++) {
			deliver!({ type: "delete", topicId: "posts", seq, key: String(seq) });
		}

		await expect(first).rejects.toThrow(
			"client event buffer exceeds 512 events",
		);
		expect(unsubscribeCalls).toBe(1);
	});

	it("derives keyed deltas from consecutive server snapshots", async () => {
		const unchanged = { id: "unchanged", title: "Same" };
		async function* snapshots(): AsyncGenerator<
			RealtimeStreamEvent<{ docs: Row[]; totalDocs: number }>
		> {
			yield {
				type: "snapshot",
				topicId: "posts",
				seq: 1,
				data: {
					docs: [unchanged, { id: "updated", title: "Before" }],
					totalDocs: 2,
				},
			};
			yield {
				type: "snapshot",
				topicId: "posts",
				seq: 2,
				upToDate: "42",
				data: {
					docs: [
						{ id: "unchanged", title: "Same" },
						{ id: "updated", title: "After" },
						{ id: "inserted", title: "New" },
					],
					totalDocs: 3,
				},
			};
		}

		const events: RealtimeStreamEvent[] = [];
		for await (const event of deriveFindDeltas(snapshots())) events.push(event);

		expect(events).toEqual([
			{
				type: "snapshot",
				topicId: "posts",
				seq: 1,
				data: {
					docs: [unchanged, { id: "updated", title: "Before" }],
					totalDocs: 2,
				},
			},
			{
				type: "update",
				topicId: "posts",
				seq: 2,
				key: "updated",
				row: { id: "updated", title: "After" },
				index: 1,
			},
			{
				type: "insert",
				topicId: "posts",
				seq: 2,
				key: "inserted",
				row: { id: "inserted", title: "New" },
				index: 2,
			},
			{
				type: "up-to-date",
				topicId: "posts",
				seq: 2,
				upToDate: "42",
				meta: { totalDocs: 3 },
			},
		]);
	});

	it("keeps an unchanged row identity across later snapshot reorders", async () => {
		const stable = { id: "stable", title: "Same" };
		async function* snapshots(): AsyncGenerator<
			RealtimeStreamEvent<{ docs: Row[]; totalDocs: number }>
		> {
			yield {
				type: "snapshot",
				topicId: "posts",
				seq: 1,
				data: { docs: [stable], totalDocs: 1 },
			};
			yield {
				type: "snapshot",
				topicId: "posts",
				seq: 2,
				data: {
					docs: [
						{ id: "stable", title: "Same" },
						{ id: "new", title: "New" },
					],
					totalDocs: 2,
				},
			};
			yield {
				type: "snapshot",
				topicId: "posts",
				seq: 3,
				data: {
					docs: [
						{ id: "new", title: "New" },
						{ id: "stable", title: "Same" },
					],
					totalDocs: 2,
				},
			};
		}

		const events: RealtimeStreamEvent[] = [];
		for await (const event of deriveFindDeltas(snapshots())) events.push(event);

		const moved = events.find(
			(event) => event.type === "update" && event.key === "stable",
		);
		expect(moved).toMatchObject({ type: "update", index: 1 });
		if (moved?.type === "update") expect(moved.row).toBe(stable);
	});

	it("applies keyed find deltas without replacing unchanged rows", () => {
		const first = { id: "first", title: "First" };
		const second = { id: "second", title: "Second" };
		const snapshot: RealtimeStreamEvent<{ docs: Row[]; totalDocs: number }> = {
			type: "snapshot",
			topicId: "posts",
			seq: 1,
			data: { docs: [first, second], totalDocs: 2 },
		};

		let result = applyRealtimeFindEvent(undefined, snapshot);
		result = applyRealtimeFindEvent(result, {
			type: "update",
			topicId: "posts",
			seq: 2,
			key: "second",
			row: { id: "second", title: "Updated" },
		});

		expect(result.docs[0]).toBe(first);
		expect(result.docs).toEqual([first, { id: "second", title: "Updated" }]);

		result = applyRealtimeFindEvent(result, {
			type: "insert",
			topicId: "posts",
			seq: 3,
			key: "first",
			row: { id: "first", title: "Replaced in place" },
		});
		result = applyRealtimeFindEvent(result, {
			type: "insert",
			topicId: "posts",
			seq: 3,
			key: "third",
			row: { id: "third", title: "Third" },
		});
		result = applyRealtimeFindEvent(result, {
			type: "delete",
			topicId: "posts",
			seq: 3,
			key: "second",
		});

		expect(result).toEqual({
			docs: [
				{ id: "first", title: "Replaced in place" },
				{ id: "third", title: "Third" },
			],
			totalDocs: 2,
			limit: 3,
			totalPages: 1,
			page: 1,
			pagingCounter: 1,
			hasNextPage: false,
			hasPrevPage: false,
			nextPage: null,
			prevPage: null,
		});
	});

	it("keeps the bootstrap page window across row events and totals frames", () => {
		// Page 21 of 69, the envelope a windowed live list bootstraps with.
		const bootstrap = {
			docs: [
				{ id: "a", title: "A" },
				{ id: "b", title: "B" },
			],
			totalDocs: 138,
			limit: 2,
			totalPages: 69,
			page: 21,
			pagingCounter: 41,
			hasPrevPage: true,
			hasNextPage: true,
			prevPage: 20,
			nextPage: 22,
		};

		let result = applyRealtimeFindEvent(undefined, {
			type: "snapshot",
			topicId: "posts",
			seq: 1,
			data: bootstrap,
		});

		// A write elsewhere slides the window: one row leaves, one arrives.
		result = applyRealtimeFindEvent(result, {
			type: "delete",
			topicId: "posts",
			seq: 2,
			key: "a",
		});
		result = applyRealtimeFindEvent(result, {
			type: "insert",
			topicId: "posts",
			seq: 2,
			key: "c",
			row: { id: "c", title: "C" },
			index: 1,
		});

		expect(result).toEqual({
			docs: [
				{ id: "b", title: "B" },
				{ id: "c", title: "C" },
			],
			totalDocs: 138,
			limit: 2,
			totalPages: 69,
			page: 21,
			pagingCounter: 41,
			hasPrevPage: true,
			hasNextPage: true,
			prevPage: 20,
			nextPage: 22,
		});

		// The totals frame carries the server's own count; the window stays put
		// and only the derived page counts move with it.
		result = applyRealtimeFindEvent(result, {
			type: "up-to-date",
			topicId: "posts",
			seq: 2,
			meta: { totalDocs: 139 },
		});

		expect(result).toMatchObject({
			totalDocs: 139,
			limit: 2,
			totalPages: 70,
			page: 21,
			pagingCounter: 41,
			hasPrevPage: true,
			hasNextPage: true,
		});
		expect(result.docs).toHaveLength(2);
	});

	it("keeps the total across a heartbeat that carries no meta", () => {
		const bootstrap = {
			docs: [{ id: "a", title: "A" }],
			totalDocs: 5000,
			limit: 100,
			totalPages: 50,
			page: 1,
			pagingCounter: 1,
			hasPrevPage: false,
			hasNextPage: true,
			prevPage: null,
			nextPage: 2,
		};

		const result = applyRealtimeFindEvent(
			applyRealtimeFindEvent(undefined, {
				type: "snapshot",
				topicId: "posts",
				seq: 1,
				data: bootstrap,
			}),
			{ type: "up-to-date", topicId: "posts", seq: 2, upToDate: "42" },
		);

		expect(result).toMatchObject({
			totalDocs: 5000,
			limit: 100,
			totalPages: 50,
			hasNextPage: true,
		});
	});

	it("keeps an unwindowed result on one page as its rows grow", () => {
		// Native row deltas only ever serve unwindowed topics, so the server's
		// synthesized `limit === totalDocs` has to grow with the result.
		let result = applyRealtimeFindEvent(undefined, {
			type: "snapshot",
			topicId: "posts",
			seq: 1,
			data: {
				docs: [{ id: "a", title: "A" }],
				totalDocs: 1,
				limit: 1,
				totalPages: 1,
				page: 1,
				pagingCounter: 1,
				hasPrevPage: false,
				hasNextPage: false,
				prevPage: null,
				nextPage: null,
			},
		});
		result = applyRealtimeFindEvent(result, {
			type: "insert",
			topicId: "posts",
			seq: 2,
			key: "b",
			row: { id: "b", title: "B" },
		});
		result = applyRealtimeFindEvent(result, {
			type: "up-to-date",
			topicId: "posts",
			seq: 2,
			meta: { totalDocs: 2 },
		});

		expect(result).toMatchObject({
			totalDocs: 2,
			limit: 2,
			totalPages: 1,
			page: 1,
			hasNextPage: false,
			nextPage: null,
		});
		expect(result.docs).toHaveLength(2);
	});

	it("treats a reset snapshot as an authoritative replacement", () => {
		const previous = {
			docs: [{ id: "old", title: "Old" }],
			totalDocs: 1,
		};
		const replacement = {
			docs: [{ id: "new", title: "New" }],
			totalDocs: 1,
		};

		expect(
			applyRealtimeFindEvent(previous, {
				type: "snapshot",
				topicId: "posts",
				seq: 10,
				reset: true,
				data: replacement,
			}),
		).toBe(replacement);
	});

	it("applies scalar and single-row event shapes", () => {
		expect(
			applyRealtimeScalarEvent(1, {
				type: "up-to-date",
				topicId: "posts-count",
				seq: 2,
				meta: { totalDocs: 3 },
			}),
		).toBe(3);

		const row = { id: "post", title: "Post" };
		expect(
			applyRealtimeSingleEvent(null, {
				type: "insert",
				topicId: "post",
				seq: 2,
				key: "post",
				row,
			}),
		).toBe(row);
		expect(
			applyRealtimeSingleEvent(row, {
				type: "delete",
				topicId: "post",
				seq: 3,
				key: "post",
			}),
		).toBeNull();
	});
});
