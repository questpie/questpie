/**
 * Visual Edit utility tests
 *
 * Covers the pure helpers used by the Visual Edit Workspace —
 * `block-paths`, `selectionFieldPath`, and the preview click router.
 */

import { describe, expect, it } from "bun:test";

import {
	blockTreePath,
	blockValuePath,
	defaultBlocksPath,
	parseBlockValuePath,
} from "#questpie/admin/client/preview/block-paths";
import {
	applyPatchBatch,
	applyPatchBatchImmutable,
	applyRemove,
	applySet,
	parsePath,
} from "#questpie/admin/client/preview/patch";
import {
	isAdminToPreviewMessage,
	isPreviewToAdminMessage,
	type PreviewPatchOp,
} from "#questpie/admin/client/preview/types";
import {
	mapPreviewBlockClickToSelection,
	mapPreviewClickToSelection,
} from "#questpie/admin/client/components/visual-edit/click-router";
import { selectionFieldPath } from "#questpie/admin/client/components/visual-edit/types";

describe("block-paths", () => {
	it("builds a flat block value path regardless of nesting", () => {
		expect(blockValuePath("content", "abc")).toBe("content._values.abc");
		expect(blockValuePath("content", "abc", "title")).toBe(
			"content._values.abc.title",
		);
		expect(blockValuePath("page.body", "abc", "media.alt")).toBe(
			"page.body._values.abc.media.alt",
		);
	});

	it("builds the tree path", () => {
		expect(blockTreePath("content")).toBe("content._tree");
		expect(blockTreePath("page.body")).toBe("page.body._tree");
	});

	it("parses fully-scoped block value paths", () => {
		expect(parseBlockValuePath("content._values.abc.title")).toEqual({
			blocksPath: "content",
			blockId: "abc",
			fieldPath: "title",
		});
		expect(parseBlockValuePath("content._values.abc")).toEqual({
			blocksPath: "content",
			blockId: "abc",
		});
		expect(parseBlockValuePath("page.body._values.abc.media.alt")).toEqual({
			blocksPath: "page.body",
			blockId: "abc",
			fieldPath: "media.alt",
		});
	});

	it("returns null for non-block paths", () => {
		expect(parseBlockValuePath("title")).toBeNull();
		expect(parseBlockValuePath("content.blocks.abc.title")).toBeNull();
		expect(parseBlockValuePath("")).toBeNull();
	});

	it("rejects degenerate block paths", () => {
		// Empty rest after the marker — no blockId at all.
		expect(parseBlockValuePath("content._values.")).toBeNull();
		// Empty blockId between two consecutive dots after the marker.
		expect(parseBlockValuePath("content._values..title")).toBeNull();
		// Missing leading blocksPath segment — would otherwise round-trip
		// to `{ blocksPath: "", blockId: "abc" }` which the patcher can't
		// resolve back through the form tree.
		expect(parseBlockValuePath("._values.abc.title")).toBeNull();
	});

	it("treats a trailing dot after blockId as an empty fieldPath", () => {
		// `content._values.abc.` is permissive on purpose: the blockId is
		// well-formed, the empty fieldPath just means "select the block
		// root" — same as `content._values.abc`.
		expect(parseBlockValuePath("content._values.abc.")).toEqual({
			blocksPath: "content",
			blockId: "abc",
		});
	});

	it("exposes the canonical default blocks path", () => {
		expect(defaultBlocksPath()).toBe("content");
	});
});

describe("selectionFieldPath", () => {
	it("returns null for idle selection", () => {
		expect(selectionFieldPath({ kind: "idle" })).toBeNull();
	});

	it("returns the field path for plain field selections", () => {
		expect(selectionFieldPath({ kind: "field", fieldPath: "title" })).toBe(
			"title",
		);
		expect(
			selectionFieldPath({ kind: "field", fieldPath: "meta.seo.title" }),
		).toBe("meta.seo.title");
	});

	it("composes block selection paths", () => {
		expect(
			selectionFieldPath({
				kind: "block",
				blocksPath: "content",
				blockId: "abc",
			}),
		).toBe("content._values.abc");
		expect(
			selectionFieldPath({
				kind: "block-field",
				blocksPath: "page.body",
				blockId: "abc",
				fieldPath: "title",
			}),
		).toBe("page.body._values.abc.title");
	});

	it("composes array-item paths with the index", () => {
		expect(
			selectionFieldPath({
				kind: "array-item",
				fieldPath: "items",
				index: 2,
			}),
		).toBe("items.2");
	});

	it("returns the field path for relations and arrays", () => {
		expect(
			selectionFieldPath({ kind: "relation", fieldPath: "author" }),
		).toBe("author");
		expect(selectionFieldPath({ kind: "array", fieldPath: "items" })).toBe(
			"items",
		);
	});
});

describe("mapPreviewClickToSelection", () => {
	it("maps a regular field click", () => {
		expect(
			mapPreviewClickToSelection({ fieldPath: "title" }),
		).toEqual({ kind: "field", fieldPath: "title" });
	});

	it("short-circuits relation clicks regardless of path shape", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "author",
				context: { fieldType: "relation", targetCollection: "users" },
			}),
		).toEqual({
			kind: "relation",
			fieldPath: "author",
			targetCollection: "users",
		});
	});

	it("recognises fully-scoped block paths and returns block-field", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "content._values.abc.title",
			}),
		).toEqual({
			kind: "block-field",
			blocksPath: "content",
			blockId: "abc",
			fieldPath: "title",
		});
	});

	it("returns whole-block selection when path stops at the block id", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "content._values.abc",
			}),
		).toEqual({
			kind: "block",
			blocksPath: "content",
			blockId: "abc",
		});
	});

	it("uses the blockId hint with a fallback blocksPath when path is bare", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "title",
				context: { blockId: "abc" },
				fallbackBlocksPath: "page.body",
			}),
		).toEqual({
			kind: "block-field",
			blocksPath: "page.body",
			blockId: "abc",
			fieldPath: "title",
		});
	});

	it("uses defaultBlocksPath() when blockId hint is set but no fallback is provided", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "title",
				context: { blockId: "abc" },
			}),
		).toEqual({
			kind: "block-field",
			blocksPath: "content",
			blockId: "abc",
			fieldPath: "title",
		});
	});

	it("returns a relation selection without targetCollection when context is incomplete", () => {
		// `targetCollection` is optional; passing only `fieldType: "relation"`
		// should still short-circuit to the relation branch — the workspace
		// renders a generic relation editor when the collection is unknown.
		expect(
			mapPreviewClickToSelection({
				fieldPath: "author",
				context: { fieldType: "relation" },
			}),
		).toEqual({
			kind: "relation",
			fieldPath: "author",
			targetCollection: undefined,
		});
	});

	it("handles nested paths inside blocks", () => {
		expect(
			mapPreviewClickToSelection({
				fieldPath: "page.body._values.abc.media.alt",
			}),
		).toEqual({
			kind: "block-field",
			blocksPath: "page.body",
			blockId: "abc",
			fieldPath: "media.alt",
		});
	});
});

describe("mapPreviewBlockClickToSelection", () => {
	it("uses defaultBlocksPath() when fallback is omitted", () => {
		expect(mapPreviewBlockClickToSelection({ blockId: "abc" })).toEqual({
			kind: "block",
			blocksPath: "content",
			blockId: "abc",
		});
	});

	it("respects the provided fallback blocks path", () => {
		expect(
			mapPreviewBlockClickToSelection({
				blockId: "abc",
				fallbackBlocksPath: "page.body",
			}),
		).toEqual({
			kind: "block",
			blocksPath: "page.body",
			blockId: "abc",
		});
	});
});

describe("parsePath", () => {
	it("returns numeric segments as numbers", () => {
		expect(parsePath("items.2.label")).toEqual(["items", 2, "label"]);
	});

	it("treats non-numeric segments as strings", () => {
		expect(parsePath("meta.seo.title")).toEqual([
			"meta",
			"seo",
			"title",
		]);
	});

	it("returns an empty array for the empty path", () => {
		expect(parsePath("")).toEqual([]);
	});
});

describe("applySet", () => {
	it("sets a top-level key", () => {
		const obj = applySet({}, "title", "Hello");
		expect(obj).toEqual({ title: "Hello" });
	});

	it("creates intermediate object containers", () => {
		const obj = applySet({}, "meta.seo.title", "T");
		expect(obj).toEqual({ meta: { seo: { title: "T" } } });
	});

	it("creates intermediate array containers when next segment is numeric", () => {
		const obj: Record<string, unknown> = applySet({}, "items.0.label", "A");
		expect(obj).toEqual({ items: [{ label: "A" }] });
		expect(Array.isArray((obj as any).items)).toBe(true);
	});

	it("overwrites existing primitive values", () => {
		const obj = applySet({ a: 1 }, "a", 2);
		expect(obj).toEqual({ a: 2 });
	});

	it("handles deeply nested block paths", () => {
		const obj = applySet({}, "content._values.abc.title", "Hi");
		expect(obj).toEqual({
			content: { _values: { abc: { title: "Hi" } } },
		});
	});

	it("is a no-op for an empty path", () => {
		// Empty path means "no segment to write to"; the snapshot
		// should round-trip unchanged so callers can pass through
		// optional paths without guarding.
		const obj = applySet({ a: 1 }, "", "ignored");
		expect(obj).toEqual({ a: 1 });
	});
});

describe("applyRemove", () => {
	it("removes a top-level key", () => {
		const obj = applyRemove({ a: 1, b: 2 }, "a");
		expect(obj).toEqual({ b: 2 });
	});

	it("removes a nested key", () => {
		const obj = applyRemove(
			{ meta: { seo: { title: "T" } } },
			"meta.seo.title",
		);
		expect(obj).toEqual({ meta: { seo: {} } });
	});

	it("is a no-op when intermediate path is missing", () => {
		const obj = applyRemove({ a: 1 }, "b.c.d");
		expect(obj).toEqual({ a: 1 });
	});

	it("is a no-op for an empty path", () => {
		const obj = applyRemove({ a: 1 }, "");
		expect(obj).toEqual({ a: 1 });
	});
});

describe("applyPatchBatch", () => {
	it("applies a sequence of set ops in order", () => {
		const obj = applyPatchBatch(
			{},
			[
				{ op: "set", path: "title", value: "Hello" },
				{ op: "set", path: "meta.seo", value: { title: "M" } },
			],
		);
		expect(obj).toEqual({ title: "Hello", meta: { seo: { title: "M" } } });
	});

	it("supports remove after set", () => {
		const obj = applyPatchBatch(
			{},
			[
				{ op: "set", path: "title", value: "Hello" },
				{ op: "remove", path: "title" },
			],
		);
		expect(obj).toEqual({});
	});

	it("is a no-op for an empty ops list", () => {
		const obj = applyPatchBatch({ a: 1 }, []);
		expect(obj).toEqual({ a: 1 });
	});

	it("stops on the first unknown op so the snapshot doesn't drift", () => {
		// Unknown op type is treated as a sentinel — anything after
		// it is dropped. The snapshot retains the ops applied before
		// the bad one, but the rest are skipped.
		const obj = applyPatchBatch({}, [
			{ op: "set", path: "title", value: "Hello" },
			// @ts-expect-error — intentional unknown op for the safety test
			{ op: "patch", path: "title" },
			{ op: "set", path: "later", value: "ignored" },
		] as PreviewPatchOp[]);
		expect(obj).toEqual({ title: "Hello" });
	});
});

describe("applyPatchBatchImmutable", () => {
	it("does not mutate the input", () => {
		const before = { title: "Old" };
		const after = applyPatchBatchImmutable(before, [
			{ op: "set", path: "title", value: "New" },
		]);
		expect(before).toEqual({ title: "Old" });
		expect(after).toEqual({ title: "New" });
		expect(after).not.toBe(before);
	});

	it("deep-clones nested containers so mutations don't leak", () => {
		// `structuredClone` is the contract — nested objects + arrays
		// in the result must NOT share references with the input. The
		// patcher relies on this when handing the result to react-
		// hook-form so subsequent edits don't surprise consumers
		// holding the original ref.
		const before = {
			meta: { seo: { title: "T" } },
			tags: ["a", "b"],
		};
		const after = applyPatchBatchImmutable(before, [
			{ op: "set", path: "meta.seo.title", value: "New" },
		]);

		expect(after.meta).not.toBe(before.meta);
		expect(after.meta).toEqual({ seo: { title: "New" } });
		// Untouched arrays still get a fresh container under
		// structuredClone semantics.
		expect(after.tags).not.toBe(before.tags);
		expect(after.tags).toEqual(["a", "b"]);
		// And the original is untouched.
		expect(before.meta.seo.title).toBe("T");
	});
});

describe("isAdminToPreviewMessage", () => {
	it("accepts every known admin → preview message type", () => {
		// Lock the full set in by iterating over every type the
		// receiving side handles. If a new admin-side message is
		// added without updating the validator's set, this test
		// flags the gap immediately.
		const ALL_ADMIN_TYPES = [
			"PREVIEW_REFRESH",
			"SELECT_BLOCK",
			"FOCUS_FIELD",
			"INIT_SNAPSHOT",
			"PATCH_BATCH",
			"COMMIT",
			"FULL_RESYNC",
			"SELECT_TARGET",
			"NAVIGATE_PREVIEW",
		];
		for (const type of ALL_ADMIN_TYPES) {
			expect(isAdminToPreviewMessage({ type })).toBe(true);
		}
	});

	it("rejects iframe → admin types that aren't part of the admin → preview surface", () => {
		expect(isAdminToPreviewMessage({ type: "PREVIEW_READY" })).toBe(false);
		expect(isAdminToPreviewMessage({ type: "FIELD_CLICKED" })).toBe(false);
		expect(isAdminToPreviewMessage({ type: "PATCH_APPLIED" })).toBe(false);
	});

	it("rejects unknown / malformed payloads", () => {
		expect(isAdminToPreviewMessage(null)).toBe(false);
		expect(isAdminToPreviewMessage(undefined)).toBe(false);
		expect(isAdminToPreviewMessage("PREVIEW_REFRESH")).toBe(false);
		expect(isAdminToPreviewMessage({})).toBe(false);
		expect(isAdminToPreviewMessage({ type: 42 })).toBe(false);
		expect(isAdminToPreviewMessage({ type: "OOPS" })).toBe(false);
	});
});

describe("isPreviewToAdminMessage", () => {
	it("accepts every known preview → admin message type", () => {
		const ALL_PREVIEW_TYPES = [
			"PREVIEW_READY",
			"FIELD_CLICKED",
			"BLOCK_CLICKED",
			"REFRESH_COMPLETE",
			"PATCH_APPLIED",
			"RESYNC_REQUEST",
		];
		for (const type of ALL_PREVIEW_TYPES) {
			expect(isPreviewToAdminMessage({ type })).toBe(true);
		}
	});

	it("rejects admin → preview types", () => {
		expect(isPreviewToAdminMessage({ type: "INIT_SNAPSHOT" })).toBe(false);
		expect(isPreviewToAdminMessage({ type: "PATCH_BATCH" })).toBe(false);
		expect(isPreviewToAdminMessage({ type: "NAVIGATE_PREVIEW" })).toBe(false);
	});

	it("rejects unknown / malformed payloads", () => {
		expect(isPreviewToAdminMessage(null)).toBe(false);
		expect(isPreviewToAdminMessage(undefined)).toBe(false);
		expect(isPreviewToAdminMessage("PREVIEW_READY")).toBe(false);
		expect(isPreviewToAdminMessage({})).toBe(false);
		expect(isPreviewToAdminMessage({ type: 42 })).toBe(false);
		expect(isPreviewToAdminMessage({ type: "OOPS" })).toBe(false);
	});
});
