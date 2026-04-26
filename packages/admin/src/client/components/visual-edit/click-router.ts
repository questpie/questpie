/**
 * Preview click router
 *
 * Pure mapping from a `PreviewPane` click event (the legacy
 * `(fieldPath, { blockId?, fieldType? })` shape) to a structured
 * `VisualEditSelection`. Lives outside the workspace component so
 * it's trivially unit-testable and reusable.
 */

import {
	defaultBlocksPath as defaultBlocksPathFn,
	parseBlockValuePath,
} from "../../preview/block-paths.js";
import type { VisualEditSelection } from "./types.js";

export type PreviewClickContext = {
	blockId?: string;
	fieldType?: "regular" | "block" | "relation";
	targetCollection?: string;
};

export type MapPreviewClickArgs = {
	/** The form-field path emitted by the preview click handler */
	fieldPath: string;
	/** Optional context hints attached to the click (block scope, field type) */
	context?: PreviewClickContext;
	/**
	 * Fallback blocks-field path when the preview click comes from a
	 * block scope but the path itself isn't fully scoped. Defaults to
	 * `defaultBlocksPath()` for parity with the legacy preview wiring.
	 */
	fallbackBlocksPath?: string;
};

/**
 * Translate a `PreviewPane.onFieldClick` payload into a
 * `VisualEditSelection`. The order of checks matches what the
 * legacy `parsePreviewFieldPath` did:
 *
 * 1. `fieldType === "relation"` short-circuits to a relation target.
 * 2. Fully-scoped block paths (`<blocksPath>._values.<id>[.field]`)
 *    become `block` or `block-field` selections.
 * 3. A `blockId` hint pairs the bare path with the fallback
 *    blocks-field path.
 * 4. Otherwise the path is treated as a regular field.
 */
export function mapPreviewClickToSelection({
	fieldPath,
	context,
	fallbackBlocksPath,
}: MapPreviewClickArgs): VisualEditSelection {
	if (context?.fieldType === "relation") {
		return {
			kind: "relation",
			fieldPath,
			targetCollection: context.targetCollection,
		};
	}

	const parsed = parseBlockValuePath(fieldPath);
	if (parsed) {
		if (parsed.fieldPath) {
			return {
				kind: "block-field",
				blocksPath: parsed.blocksPath,
				blockId: parsed.blockId,
				fieldPath: parsed.fieldPath,
			};
		}
		return {
			kind: "block",
			blocksPath: parsed.blocksPath,
			blockId: parsed.blockId,
		};
	}

	if (context?.blockId) {
		const blocksPath = fallbackBlocksPath ?? defaultBlocksPathFn();
		return {
			kind: "block-field",
			blocksPath,
			blockId: context.blockId,
			fieldPath,
		};
	}

	return { kind: "field", fieldPath };
}

/**
 * Translate a block click (e.g. `PreviewPane.onBlockClick`) into a
 * whole-block selection. Uses `fallbackBlocksPath` (or
 * `defaultBlocksPath()`) since `onBlockClick` only carries the id.
 */
export function mapPreviewBlockClickToSelection({
	blockId,
	fallbackBlocksPath,
}: {
	blockId: string;
	fallbackBlocksPath?: string;
}): VisualEditSelection {
	return {
		kind: "block",
		blocksPath: fallbackBlocksPath ?? defaultBlocksPathFn(),
		blockId,
	};
}
