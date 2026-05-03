import { describe, expect, it } from "bun:test";

import {
	applyPatchBatchImmutable,
	shouldApplyPatchBatch,
} from "#questpie/admin/client/preview/patch";

describe("applyPatchBatchImmutable", () => {
	it("sets and removes nested object paths immutably", () => {
		const original = {
			title: "Before",
			seo: { title: "Old", description: "Remove me" },
		};

		const patched = applyPatchBatchImmutable(original, [
			{ op: "set", path: "title", value: "After" },
			{ op: "set", path: "seo.title", value: "New" },
			{ op: "remove", path: "seo.description" },
		]);

		expect(patched).toEqual({
			title: "After",
			seo: { title: "New" },
		});
		expect(original).toEqual({
			title: "Before",
			seo: { title: "Old", description: "Remove me" },
		});
		expect(patched).not.toBe(original);
		expect(patched.seo).not.toBe(original.seo);
	});

	it("creates missing object containers", () => {
		expect(
			applyPatchBatchImmutable({}, [
				{ op: "set", path: "seo.openGraph.title", value: "Preview" },
			]),
		).toEqual({ seo: { openGraph: { title: "Preview" } } });
	});

	it("supports array indexes in paths", () => {
		expect(
			applyPatchBatchImmutable({ blocks: [{ title: "Before" }] }, [
				{ op: "set", path: "blocks.0.title", value: "After" },
				{ op: "set", path: "blocks.1.title", value: "Second" },
			]),
		).toEqual({
			blocks: [{ title: "After" }, { title: "Second" }],
		});
	});

	it("removes array indexes with splice semantics", () => {
		expect(
			applyPatchBatchImmutable({ items: ["first", "second", "third"] }, [
				{ op: "remove", path: "items.1" },
			]),
		).toEqual({ items: ["first", "third"] });
	});

	it("deep clones set values", () => {
		const value = { nested: { label: "Before" } };
		const patched = applyPatchBatchImmutable({}, [
			{ op: "set", path: "field", value },
		]);

		value.nested.label = "Mutated";

		expect(patched).toEqual({ field: { nested: { label: "Before" } } });
	});
});

describe("shouldApplyPatchBatch", () => {
	it("rejects stale sequence numbers", () => {
		expect(shouldApplyPatchBatch(4, 4)).toBe(false);
		expect(shouldApplyPatchBatch(4, 3)).toBe(false);
		expect(shouldApplyPatchBatch(4, 5)).toBe(true);
		expect(shouldApplyPatchBatch(null, 1)).toBe(true);
	});
});
