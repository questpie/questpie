/**
 * Visual Edit Workspace types
 *
 * Selection model is intentionally a single discriminated union so the
 * inspector panel can be a fast switch over `kind`.
 *
 * RFC: docs/RFC-VISUAL-EDIT-WORKSPACE.md
 */

import { blockValuePath, type BlockPathParts } from "../../preview/block-paths.js";

export type {
	BlockPathParts,
};

/**
 * The "where the user is editing right now" state. Idle = inspector
 * shows the Document panel (collection-level, SEO/meta, slug, status).
 */
export type VisualEditSelection =
	| { kind: "idle" }
	| {
			/** A non-block, non-relation field (`title`, `slug`, `meta.seo.title`, …) */
			kind: "field";
			fieldPath: string;
	  }
	| {
			/**
			 * The whole block: header expanded in the inspector. `fieldPath`
			 * is undefined to distinguish from `kind: "block-field"`.
			 */
			kind: "block";
			blocksPath: string;
			blockId: string;
	  }
	| {
			/** A specific field inside a block — relative to that block. */
			kind: "block-field";
			blocksPath: string;
			blockId: string;
			fieldPath: string;
	  }
	| {
			/**
			 * A relation field. The inspector opens the related-record
			 * editor (today via `ResourceSheet`).
			 */
			kind: "relation";
			fieldPath: string;
			targetCollection?: string;
	  }
	| {
			/** A whole array field (e.g. `f.array(...)` reorder pane). */
			kind: "array";
			fieldPath: string;
	  }
	| {
			/** One item inside an array field. */
			kind: "array-item";
			fieldPath: string;
			index: number;
	  };

/**
 * Helper: derive the canonical form-field path that react-hook-form
 * should focus when this selection changes.
 *
 * Returns `null` when the selection has no associated form field
 * (e.g. `kind: "idle"`).
 */
export function selectionFieldPath(
	selection: VisualEditSelection,
): string | null {
	switch (selection.kind) {
		case "idle":
			return null;
		case "field":
			return selection.fieldPath;
		case "block":
			return blockValuePath(selection.blocksPath, selection.blockId);
		case "block-field":
			return blockValuePath(
				selection.blocksPath,
				selection.blockId,
				selection.fieldPath,
			);
		case "relation":
			return selection.fieldPath;
		case "array":
			return selection.fieldPath;
		case "array-item":
			return `${selection.fieldPath}.${selection.index}`;
	}
}

/**
 * Re-exported for callers that want to pattern-match on the parsed
 * shape of a path coming from a preview click.
 */
export type ParsedBlockPath = BlockPathParts;
