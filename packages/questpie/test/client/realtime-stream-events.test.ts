import { describe, expect, it } from "bun:test";

import {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	deriveFindDeltas,
	type RealtimeStreamEvent,
} from "../../src/client/realtime/stream.js";

type Row = { id: string; title: string };

describe("realtime stream events", () => {
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
			totalPages: 1,
			page: 1,
			hasNextPage: false,
			hasPrevPage: false,
			nextPage: null,
			prevPage: null,
		});
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
