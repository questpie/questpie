import { describe, expect, it } from "bun:test";

import { diffSnapshot } from "#questpie/admin/client/preview/diff";

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
