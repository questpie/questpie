/**
 * Snapshot diff tests
 *
 * Drives `diffSnapshot` end-to-end via `applyPatchBatch` to confirm
 * the produced ops actually transform `before` into `after`.
 */

import { describe, expect, it } from "bun:test";

import { diffSnapshot } from "#questpie/admin/client/preview/diff";
import { applyPatchBatchImmutable } from "#questpie/admin/client/preview/patch";

function roundTrip(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
) {
	const ops = diffSnapshot(before, after);
	const result = applyPatchBatchImmutable(before, ops);
	return { ops, result };
}

describe("diffSnapshot — empty inputs", () => {
	it("returns no ops when both inputs are equal", () => {
		expect(diffSnapshot({ a: 1 }, { a: 1 })).toEqual([]);
		expect(diffSnapshot({}, {})).toEqual([]);
	});

	it("returns no ops when both inputs are undefined", () => {
		expect(diffSnapshot(undefined, undefined)).toEqual([]);
	});

	it("treats missing/undefined `before` as a fresh insert", () => {
		expect(diffSnapshot(undefined, { a: 1, b: 2 })).toEqual([
			{ op: "set", path: "a", value: 1 },
			{ op: "set", path: "b", value: 2 },
		]);
	});

	it("treats missing/undefined `after` as a remove of every key", () => {
		expect(diffSnapshot({ a: 1, b: 2 }, undefined)).toEqual([
			{ op: "remove", path: "a" },
			{ op: "remove", path: "b" },
		]);
	});
});

describe("diffSnapshot — primitives", () => {
	it("emits a set for changed primitives", () => {
		expect(diffSnapshot({ title: "old" }, { title: "new" })).toEqual([
			{ op: "set", path: "title", value: "new" },
		]);
	});

	it("emits a set for newly added primitives", () => {
		expect(diffSnapshot({ a: 1 }, { a: 1, b: 2 })).toEqual([
			{ op: "set", path: "b", value: 2 },
		]);
	});

	it("emits a remove for keys that disappear", () => {
		expect(diffSnapshot({ a: 1, b: 2 }, { a: 1 })).toEqual([
			{ op: "remove", path: "b" },
		]);
	});

	it("treats undefined values as absent", () => {
		expect(diffSnapshot({ a: 1 }, { a: undefined })).toEqual([
			{ op: "remove", path: "a" },
		]);
		expect(diffSnapshot({ a: undefined }, { a: 1 })).toEqual([
			{ op: "set", path: "a", value: 1 },
		]);
		expect(diffSnapshot({ a: undefined }, { a: undefined })).toEqual([]);
	});
});

describe("diffSnapshot — recursion", () => {
	it("emits nested set for a deep change", () => {
		const before = { meta: { seo: { title: "Old", desc: "D" } } };
		const after = { meta: { seo: { title: "New", desc: "D" } } };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "set", path: "meta.seo.title", value: "New" },
		]);
	});

	it("emits multiple nested ops for sibling changes", () => {
		const before = { meta: { seo: { title: "T" }, og: { type: "x" } } };
		const after = { meta: { seo: { title: "T2" }, og: { type: "x" } } };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "set", path: "meta.seo.title", value: "T2" },
		]);
	});

	it("emits remove for a removed nested key", () => {
		const before = { meta: { seo: { title: "T", desc: "D" } } };
		const after = { meta: { seo: { title: "T" } } };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "remove", path: "meta.seo.desc" },
		]);
	});

	it("does not recurse into arrays — sends a full set", () => {
		const before = { tags: ["a", "b"] };
		const after = { tags: ["a", "c"] };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "set", path: "tags", value: ["a", "c"] },
		]);
	});

	it("treats arrays of equal primitives as equal", () => {
		const before = { tags: ["a", "b"] };
		const after = { tags: ["a", "b"] };
		expect(diffSnapshot(before, after)).toEqual([]);
	});

	it("emits a full set when an object becomes a primitive", () => {
		// Object → primitive cannot recurse — fall through to a top-level
		// set so the iframe replaces the whole subtree.
		const before = { meta: { seo: { title: "T" } } };
		const after = { meta: "n/a" };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "set", path: "meta", value: "n/a" },
		]);
	});

	it("emits a full set when a primitive becomes an object", () => {
		const before = { meta: "n/a" };
		const after = { meta: { seo: { title: "T" } } };
		expect(diffSnapshot(before, after)).toEqual([
			{ op: "set", path: "meta", value: { seo: { title: "T" } } },
		]);
	});

	it("treats class instances as opaque atomic values", () => {
		// Class instances (Date, Map, Set, …) fail `isPlainObject`'s
		// prototype check, so the diff treats them like primitives —
		// a single `set` rather than recursing into private fields.
		// (In practice form data is JSON-serialized and Date values
		// arrive as ISO strings, but lock the behaviour in regardless.)
		const a = new Date("2026-01-01T00:00:00Z");
		const b = new Date("2026-02-01T00:00:00Z");
		expect(diffSnapshot({ when: a }, { when: b })).toEqual([
			{ op: "set", path: "when", value: b },
		]);
	});
});

describe("diffSnapshot — round-trip with applyPatchBatch", () => {
	it("transforms before into after via applyPatchBatchImmutable", () => {
		const before = {
			title: "Old",
			tags: ["a"],
			meta: { seo: { title: "S" }, kept: true },
		};
		const after = {
			title: "New",
			tags: ["a", "b"],
			meta: { seo: { title: "S2" }, kept: true, extra: "x" },
		};
		const { result } = roundTrip(before, after);
		expect(result).toEqual(after);
	});

	it("round-trips a remove of a deeply nested key", () => {
		const before = { meta: { seo: { title: "T", desc: "D" } } };
		const after = { meta: { seo: { title: "T" } } };
		const { result } = roundTrip(before, after);
		expect(result).toEqual(after);
	});

	it("round-trips an add of a new top-level key", () => {
		const before = { title: "T" } as Record<string, unknown>;
		const after = { title: "T", slug: "t" };
		const { result } = roundTrip(before, after);
		expect(result).toEqual(after);
	});
});
