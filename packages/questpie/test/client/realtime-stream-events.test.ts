import { describe, expect, it } from "bun:test";

import {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	type RealtimeStreamEvent,
} from "../../src/client/realtime/stream.js";

type Row = { id: string; title: string };

describe("realtime stream events", () => {
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
		expect(result.docs).toEqual([
			first,
			{ id: "second", title: "Updated" },
		]);

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
