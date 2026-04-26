/**
 * Block Path Utilities
 *
 * Shared helpers for resolving form-field paths inside block content.
 *
 * `BlockContent` is structured as:
 *
 * ```
 * {
 *   _tree:   [{ id, type, children: [...] }, ...]   // hierarchy lives here
 *   _values: { [blockId]: { [fieldName]: value } }  // values are FLAT by block id
 * }
 * ```
 *
 * Nested blocks must NOT compose their parent ids into the value path.
 * `${blocksPath}._values.${blockId}.${fieldName}` is always the correct
 * lookup, regardless of how deep the block sits in the tree.
 */

const DEFAULT_BLOCKS_PATH = "content";

export const BLOCKS_VALUES_SEGMENT = "_values";
export const BLOCKS_TREE_SEGMENT = "_tree";

export type BlockPathParts = {
	blocksPath: string;
	blockId: string;
	fieldPath?: string;
};

/**
 * Build the full form-field path for a value inside a block.
 *
 * @example
 * blockValuePath("content", "abc123") // "content._values.abc123"
 * blockValuePath("content", "abc123", "title") // "content._values.abc123.title"
 * blockValuePath("page.body", "abc123", "media.alt") // "page.body._values.abc123.media.alt"
 */
export function blockValuePath(
	blocksPath: string,
	blockId: string,
	fieldPath?: string,
): string {
	const base = `${blocksPath}.${BLOCKS_VALUES_SEGMENT}.${blockId}`;
	return fieldPath ? `${base}.${fieldPath}` : base;
}

/**
 * Build the path to the block tree array on a blocks field.
 */
export function blockTreePath(blocksPath: string): string {
	return `${blocksPath}.${BLOCKS_TREE_SEGMENT}`;
}

/**
 * Parse a fully scoped block field path back to its parts.
 *
 * Returns `null` when the input is not recognisable as a block path.
 *
 * @example
 * parseBlockValuePath("content._values.abc123.title")
 * // => { blocksPath: "content", blockId: "abc123", fieldPath: "title" }
 *
 * parseBlockValuePath("page.body._values.abc.nested.field")
 * // => { blocksPath: "page.body", blockId: "abc", fieldPath: "nested.field" }
 */
export function parseBlockValuePath(path: string): BlockPathParts | null {
	const marker = `.${BLOCKS_VALUES_SEGMENT}.`;
	const markerIndex = path.indexOf(marker);
	if (markerIndex < 0) return null;

	const blocksPath = path.slice(0, markerIndex);
	if (!blocksPath) return null;

	const rest = path.slice(markerIndex + marker.length);
	if (!rest) return null;

	const dotIndex = rest.indexOf(".");
	if (dotIndex < 0) {
		return { blocksPath, blockId: rest };
	}

	const blockId = rest.slice(0, dotIndex);
	const fieldPath = rest.slice(dotIndex + 1);
	if (!blockId) return null;

	return fieldPath ? { blocksPath, blockId, fieldPath } : { blocksPath, blockId };
}

/**
 * Convenience helper used by preview wrappers that historically scoped
 * to `content._values`. Keeps the default behaviour explicit so future
 * callers can pass a different blocks-field path without breaking.
 */
export function defaultBlocksPath(): string {
	return DEFAULT_BLOCKS_PATH;
}
