import { describe, expect, it } from "bun:test";

import {
	diffSnapshot,
	diffSnapshotAtPath,
} from "#questpie/admin/client/preview/diff";

describe("diffSnapshot", () => {
	it("returns no operations for equal snapshots", () => {
		expect(
			diffSnapshot(
				{ title: "Hello", nested: { enabled: true } },
				{ title: "Hello", nested: { enabled: true } },
			),
		).toEqual([]);
	});

	it("creates set and remove operations for primitive changes", () => {
		expect(
			diffSnapshot(
				{ title: "Before", slug: "before", count: 1 },
				{ title: "After", count: 1 },
			),
		).toEqual([
			{ op: "remove", path: "slug" },
			{ op: "set", path: "title", value: "After" },
		]);
	});

	it("diffs nested object changes without replacing the parent object", () => {
		expect(
			diffSnapshot(
				{ seo: { title: "Before", description: "Stable" } },
				{ seo: { title: "After", description: "Stable" } },
			),
		).toEqual([{ op: "set", path: "seo.title", value: "After" }]);
	});

	it("treats arrays as atomic values", () => {
		expect(
			diffSnapshot(
				{ blocks: [{ id: "one", title: "Before" }] },
				{ blocks: [{ id: "one", title: "After" }] },
			),
		).toEqual([
			{
				op: "set",
				path: "blocks",
				value: [{ id: "one", title: "After" }],
			},
		]);
	});

	it("deep clones set values", () => {
		const next = { meta: { tags: ["news"] } };
		const ops = diffSnapshot({}, next);

		next.meta.tags.push("mutated");

		expect(ops).toEqual([
			{
				op: "set",
				path: "meta",
				value: { tags: ["news"] },
			},
		]);
	});
});

describe("diffSnapshotAtPath", () => {
	it("diffs only the changed path", () => {
		expect(
			diffSnapshotAtPath(
				{ title: "Before", seo: { title: "Stable" } },
				{ title: "After", seo: { title: "Changed" } },
				"title",
			),
		).toEqual([{ op: "set", path: "title", value: "After" }]);
	});

	it("supports nested array paths", () => {
		expect(
			diffSnapshotAtPath(
				{ blocks: [{ title: "Before" }] },
				{ blocks: [{ title: "After" }] },
				"blocks.0.title",
			),
		).toEqual([{ op: "set", path: "blocks.0.title", value: "After" }]);
	});

	it("creates remove operations when the changed path disappears", () => {
		expect(
			diffSnapshotAtPath(
				{ seo: { description: "Remove me" } },
				{ seo: {} },
				"seo.description",
			),
		).toEqual([{ op: "remove", path: "seo.description" }]);
	});

	it("returns no operations for unchanged path values", () => {
		expect(
			diffSnapshotAtPath(
				{ title: "Stable", seo: { title: "Before" } },
				{ title: "Stable", seo: { title: "After" } },
				"title",
			),
		).toEqual([]);
	});
});
