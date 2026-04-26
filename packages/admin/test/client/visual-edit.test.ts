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
