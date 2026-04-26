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

import * as React from "react";
import { useFormContext } from "react-hook-form";

import type { CollectionSchema } from "questpie/client";

import type { FieldInstance } from "../../builder/field/field.js";
import type { PreviewPaneRef } from "../preview/preview-pane.js";
import { diffSnapshot } from "../../preview/diff.js";
import type { PreviewPatchOp } from "../../preview/types.js";
import { resolvePatchStrategy } from "./visual-edit-meta.js";

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
		// Cheap clone — keys we mutate are top-level only.
		snapshotRef.current = { ...baseline };
		seqRef.current = 0;
	}, [baseline]);

	// Resolve patch strategies once per field set. Strategies don't
	// depend on values so memoising here keeps the watch cheap.
	const strategyByField = React.useMemo<Record<string, string>>(() => {
		if (!fields) return {};
		const map: Record<string, string> = {};
		for (const [name, fieldDef] of Object.entries(fields)) {
			const fieldSchema = schema?.fields?.[name];
			map[name] = resolvePatchStrategy({
				fieldDef,
				fieldSchema: fieldSchema as any,
			});
		}
		return map;
	}, [fields, schema]);

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
			snapshotRef.current = current;

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
