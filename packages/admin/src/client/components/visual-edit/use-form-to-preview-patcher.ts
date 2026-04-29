/**
 * useFormToPreviewPatcher
 *
 * Bridges react-hook-form value changes to the preview iframe via
 * `PATCH_BATCH`. Watches the form, debounces, computes a recursive
 * diff against the last-sent snapshot via `diffSnapshot`, splits
 * the changed paths into "patch" vs "refresh" buckets according
 * to the top-level field's resolved `visualEdit.patchStrategy`,
 * and dispatches accordingly.
 *
 * Recursive diffing means a change to `meta.seo.title` becomes a
 * single `set meta.seo.title = "X"` op rather than replacing the
 * whole `meta` subtree. Arrays remain atomic — the helper sends a
 * full `set` for any array change, so `applyPatchBatch` on the
 * preview side just slots the new array in.
 */

"use client";

import type { CollectionSchema } from "questpie/client";
import * as React from "react";
import { useFormContext } from "react-hook-form";

import type { FieldInstance } from "../../builder/field/field.js";
import { diffSnapshot } from "../../preview/diff.js";
import type { PreviewPatchOp } from "../../preview/types.js";
import type { PreviewPaneRef } from "../preview/preview-pane.js";
import { buildStrategyMap } from "./visual-edit-meta.js";

// ============================================================================
// Args
// ============================================================================

export type UseFormToPreviewPatcherArgs = {
	/** Ref to the `PreviewPane` mounted in the workspace canvas. */
	previewRef: React.RefObject<PreviewPaneRef | null>;
	/**
	 * Field instances for the active collection — used to resolve
	 * each field's `visualEdit.patchStrategy`.
	 */
	fields: Record<string, FieldInstance>;
	/**
	 * Server introspection schema, if available. Server-side
	 * `visualEdit` metadata wins over client-side `~options`.
	 */
	schema: CollectionSchema | undefined;
	/**
	 * The canonical, just-loaded record. Patcher uses it as the
	 * baseline for the first diff and resets the baseline whenever
	 * the record is replaced (e.g. after `COMMIT` or `FULL_RESYNC`).
	 */
	baseline: Record<string, unknown> | undefined;
	/**
	 * Debounce window for emitting batches, in milliseconds.
	 * @default 200
	 */
	debounceMs?: number;
	/**
	 * Disable the patcher entirely. Useful for create-mode forms
	 * where there's no canonical record to diff against.
	 */
	disabled?: boolean;
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Watch a `react-hook-form` instance for value changes and emit
 * `PATCH_BATCH` messages to a `PreviewPane` so the iframe's
 * local draft stays in sync with the form without round-tripping
 * through the database.
 *
 * Each flush:
 *
 * 1. computes `diffSnapshot(snapshot, current)` — recursive over
 *    plain objects, atomic over arrays
 * 2. buckets the resulting ops by the top-level field's resolved
 *    `visualEdit.patchStrategy`:
 *    - `"patch"` → queued in the next `PATCH_BATCH`
 *    - `"refresh"` → triggers a single `PREVIEW_REFRESH` for the
 *      batch (relations, uploads, blocks, server compute)
 *    - `"deferred"` → dropped until commit
 * 3. ships the batch with a monotonic `seq` and updates the
 *    snapshot reference.
 *
 * Mounted automatically by `VisualEditFormHost`. Reach for it
 * directly only when hosting the workspace in a custom layout.
 *
 * Must run inside a `<FormProvider>` (it uses `useFormContext`).
 */
export function useFormToPreviewPatcher({
	previewRef,
	fields,
	schema,
	baseline,
	debounceMs = 200,
	disabled,
}: UseFormToPreviewPatcherArgs): void {
	const form = useFormContext();

	// Last-sent snapshot — patcher diffs against this and updates
	// it after each batch. Reset whenever the baseline changes
	// (commit / resync / record load).
	const snapshotRef = React.useRef<Record<string, unknown> | null>(null);
	const seqRef = React.useRef(0);

	React.useEffect(() => {
		if (!baseline) {
			snapshotRef.current = null;
			seqRef.current = 0;
			return;
		}
		snapshotRef.current = cloneSnapshot(baseline);
		seqRef.current = 0;
	}, [baseline]);

	// Resolve patch strategies once per field set. Strategies don't
	// depend on values so memoising here keeps the watch cheap.
	const strategyByField = React.useMemo(
		() => buildStrategyMap({ fields, schema }),
		[fields, schema],
	);

	React.useEffect(() => {
		if (disabled) return;

		let timer: ReturnType<typeof setTimeout> | null = null;

		const flush = () => {
			timer = null;
			const ref = previewRef.current;
			const snapshot = snapshotRef.current;
			if (!ref || !snapshot) return;

			const current = form.getValues() as Record<string, unknown>;
			// Compute a full recursive diff once, then bucket each op by
			// the top-level field's resolved patch strategy. Top-level
			// is the right granularity for strategy because `visualEdit`
			// metadata lives on the field root — nested ops inherit the
			// root's strategy.
			const diff = diffSnapshot(snapshot, current);
			if (diff.length === 0) return;

			const patchOps: PreviewPatchOp[] = [];
			const refreshFields = new Set<string>();

			for (const op of diff) {
				const root = topLevelKey(op.path);
				if (root.startsWith("_")) continue; // hidden form internals
				const strategy = strategyByField[root] ?? "patch";
				if (strategy === "deferred") continue;
				if (strategy === "refresh") {
					refreshFields.add(root);
					continue;
				}
				patchOps.push(op);
			}

			// Mirror the diff into the snapshot regardless of strategy
			// so the next flush diffs against current state, not a
			// stale baseline. Refresh-strategy fields still need to
			// land in the snapshot — they just travel via a different
			// channel (PREVIEW_REFRESH).
			snapshotRef.current = cloneSnapshot(current);

			if (patchOps.length > 0) {
				seqRef.current += 1;
				ref.sendPatchBatch(seqRef.current, patchOps);
			}

			if (refreshFields.size > 0) {
				if (process.env.NODE_ENV !== "production") {
					console.debug(
						"[VisualEdit] field changed with refresh strategy — triggering preview refresh:",
						Array.from(refreshFields),
					);
				}
				ref.triggerRefresh();
			}
		};

		const subscription = form.watch(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, debounceMs);
		});

		return () => {
			if (timer) clearTimeout(timer);
			subscription.unsubscribe();
		};
	}, [debounceMs, disabled, form, previewRef, strategyByField]);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the top-level form-field name from a patch path. This is
 * the granularity at which `visualEdit.patchStrategy` is resolved
 * — nested ops inherit the root's strategy.
 */
function topLevelKey(path: string): string {
	const dot = path.indexOf(".");
	return dot < 0 ? path : path.slice(0, dot);
}

function cloneSnapshot(
	snapshot: Record<string, unknown>,
): Record<string, unknown> {
	return structuredClone(snapshot);
}
