/**
 * Block operations unit tests
 *
 * Covers the pure helpers in `client/blocks/block-operations.ts`
 * that drive both the legacy `BlockEditorProvider` and the Visual
 * Edit Workspace's `BlockInspectorBody`. Plus the `isBlockContent`
 * type guard, which BlockInspectorBody uses to gate its form-value
 * read against a fresh `EMPTY_BLOCK_CONTENT`.
 */

import { describe, expect, it } from "bun:test";

import {
	addBlockToContent,
	duplicateBlockInContent,
	moveBlockInContent,
	removeBlockFromContent,
	updateBlockValuesInContent,
} from "#questpie/admin/client/blocks/block-operations";
import {
	EMPTY_BLOCK_CONTENT,
	isBlockContent,
	type BlockContent,
} from "#questpie/admin/client/blocks/types";

// ============================================================================
// Fixtures
// ============================================================================

type AnyBlockSchema = Parameters<typeof addBlockToContent>[1][string];

function makeBlockSchema(
	type: string,
	defaults: Record<string, unknown> = {},
): AnyBlockSchema {
	const fields: Record<string, { "~options": { defaultValue?: unknown } }> = {};
	for (const [name, defaultValue] of Object.entries(defaults)) {
		fields[name] = { "~options": { defaultValue } };
	}
	return {
		name: type,
		type,
		fields: fields as unknown as AnyBlockSchema["fields"],
	} as AnyBlockSchema;
}

const heroSchema = makeBlockSchema("hero", { title: "Default", count: 1 });
const sectionSchema = makeBlockSchema("section");
const blocks = { hero: heroSchema, section: sectionSchema };

const emptyContent: BlockContent = { _tree: [], _values: {} };

// ============================================================================
// Add
// ============================================================================

describe("addBlockToContent", () => {
	it("returns null for unknown types", () => {
		const result = addBlockToContent(emptyContent, blocks, "unknown", {
			parentId: null,
			index: 0,
		});
		expect(result).toBeNull();
	});

	it("inserts a new block at the requested position", () => {
		const result = addBlockToContent(emptyContent, blocks, "hero", {
			parentId: null,
			index: 0,
		});
		expect(result).not.toBeNull();
		const { content, blockId } = result!;

		expect(content._tree).toHaveLength(1);
		expect(content._tree[0]!.id).toBe(blockId);
		expect(content._tree[0]!.type).toBe("hero");
		expect(content._values[blockId]).toEqual({
			title: "Default",
			count: 1,
		});
	});

	it("preserves the existing values map", () => {
		const seeded: BlockContent = {
			_tree: [{ id: "existing", type: "section", children: [] }],
			_values: { existing: { foo: "bar" } },
		};
		const result = addBlockToContent(seeded, blocks, "hero", {
			parentId: null,
			index: 1,
		});
		expect(result).not.toBeNull();
		expect(result!.content._values.existing).toEqual({ foo: "bar" });
	});
});

// ============================================================================
// Remove
// ============================================================================

describe("removeBlockFromContent", () => {
	it("drops the target block from the tree and values", () => {
		const seeded: BlockContent = {
			_tree: [
				{ id: "a", type: "hero", children: [] },
				{ id: "b", type: "section", children: [] },
			],
			_values: { a: { title: "A" }, b: { foo: 1 } },
		};

		const { content, removedIds } = removeBlockFromContent(seeded, "a");
		expect(removedIds).toEqual(["a"]);
		expect(content._tree).toHaveLength(1);
		expect(content._tree[0]!.id).toBe("b");
		expect(content._values).toEqual({ b: { foo: 1 } });
	});

	it("removes descendants when removing a parent", () => {
		const seeded: BlockContent = {
			_tree: [
				{
					id: "a",
					type: "section",
					children: [{ id: "child", type: "hero", children: [] }],
				},
			],
			_values: { a: {}, child: { title: "C" } },
		};

		const { content, removedIds } = removeBlockFromContent(seeded, "a");
		expect(removedIds.sort()).toEqual(["a", "child"]);
		expect(content._tree).toHaveLength(0);
		expect(content._values).toEqual({});
	});
});

// ============================================================================
// Duplicate
// ============================================================================

describe("duplicateBlockInContent", () => {
	it("clones the target block and inserts it after the original", () => {
		const seeded: BlockContent = {
			_tree: [{ id: "a", type: "hero", children: [] }],
			_values: { a: { title: "A" } },
		};

		const { content, newIds } = duplicateBlockInContent(seeded, "a");
		expect(newIds).toHaveLength(1);
		expect(content._tree).toHaveLength(2);
		expect(content._tree[1]!.id).toBe(newIds[0]);
		expect(content._values[newIds[0]!]).toEqual({ title: "A" });
	});

	it("clones nested children and rewrites their ids", () => {
		const seeded: BlockContent = {
			_tree: [
				{
					id: "parent",
					type: "section",
					children: [{ id: "child", type: "hero", children: [] }],
				},
			],
			_values: { parent: {}, child: { title: "C" } },
		};

		const { content, newIds } = duplicateBlockInContent(seeded, "parent");
		expect(newIds.length).toBeGreaterThanOrEqual(2);
		expect(content._tree).toHaveLength(2);
		const cloneRoot = content._tree[1]!;
		expect(cloneRoot.id).not.toBe("parent");
		expect(cloneRoot.children[0]!.id).not.toBe("child");
		expect(content._values[cloneRoot.children[0]!.id]).toEqual({
			title: "C",
		});
	});
});

// ============================================================================
// Move
// ============================================================================

describe("moveBlockInContent", () => {
	it("reorders siblings within the same parent", () => {
		const seeded: BlockContent = {
			_tree: [
				{ id: "a", type: "hero", children: [] },
				{ id: "b", type: "section", children: [] },
				{ id: "c", type: "hero", children: [] },
			],
			_values: {},
		};

		const next = moveBlockInContent(seeded, null, 0, 2);
		expect(next._tree.map((n) => n.id)).toEqual(["b", "c", "a"]);
	});

	it("does not touch the values map", () => {
		const seeded: BlockContent = {
			_tree: [
				{ id: "a", type: "hero", children: [] },
				{ id: "b", type: "section", children: [] },
			],
			_values: { a: { x: 1 }, b: { y: 2 } },
		};

		const next = moveBlockInContent(seeded, null, 0, 1);
		expect(next._values).toBe(seeded._values);
	});
});

// ============================================================================
// Update values
// ============================================================================

describe("updateBlockValuesInContent", () => {
	it("shallow-merges into the target block's values", () => {
		const seeded: BlockContent = {
			_tree: [{ id: "a", type: "hero", children: [] }],
			_values: { a: { title: "Old", subtitle: "S" } },
		};

		const next = updateBlockValuesInContent(seeded, "a", {
			title: "New",
		});
		expect(next._values.a).toEqual({ title: "New", subtitle: "S" });
		expect(next._tree).toBe(seeded._tree);
	});

	it("seeds the entry when no existing values are recorded", () => {
		const seeded: BlockContent = {
			_tree: [{ id: "a", type: "hero", children: [] }],
			_values: {},
		};

		const next = updateBlockValuesInContent(seeded, "a", { title: "Hi" });
		expect(next._values.a).toEqual({ title: "Hi" });
	});
});

describe("isBlockContent", () => {
	it("accepts the canonical empty constant", () => {
		expect(isBlockContent(EMPTY_BLOCK_CONTENT)).toBe(true);
	});

	it("accepts a populated tree + values pair", () => {
		expect(
			isBlockContent({
				_tree: [{ id: "a", type: "hero", children: [] }],
				_values: { a: { title: "x" } },
			}),
		).toBe(true);
	});

	it("rejects null and undefined", () => {
		expect(isBlockContent(null)).toBe(false);
		expect(isBlockContent(undefined)).toBe(false);
	});

	it("rejects primitives", () => {
		expect(isBlockContent("content")).toBe(false);
		expect(isBlockContent(0)).toBe(false);
		expect(isBlockContent(true)).toBe(false);
	});

	it("rejects empty objects (no _tree / _values)", () => {
		expect(isBlockContent({})).toBe(false);
	});

	it("rejects when _tree is not an array", () => {
		expect(isBlockContent({ _tree: "oops", _values: {} })).toBe(false);
	});

	it("rejects when _values is null or non-object", () => {
		expect(isBlockContent({ _tree: [], _values: null })).toBe(false);
		expect(isBlockContent({ _tree: [], _values: "oops" })).toBe(false);
	});
});
