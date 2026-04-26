/**
 * useFormToPreviewPatcher
 *
 * Bridges react-hook-form value changes to the preview iframe via
 * `PATCH_BATCH`. Watches the form, debounces, computes a shallow
 * diff at the top level against the last-sent snapshot, splits the
 * changed paths into "patch" vs "refresh" buckets according to
 * each field's resolved `visualEdit.patchStrategy`, and dispatches
 * accordingly.
 *
 * Top-level shallow diff is intentional for the V1 patcher: it
 * keeps the implementation small, covers ~95% of real fields
 * (title, slug, body strings, booleans, arrays of ids), and stays
 * compatible with `applyPatchBatch` on the preview side. A future
 * V2 can add recursive diffing for deep object/meta fields without
 * breaking the wire format.
 */

"use client";

import * as React from "react";
import { useFormContext } from "react-hook-form";

import type { CollectionSchema } from "questpie/client";

import type { FieldInstance } from "../../builder/field/field.js";
import type { PreviewPaneRef } from "../preview/preview-pane.js";
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
			const ops: PreviewPatchOp[] = [];
			let needsRefresh = false;
			const refreshFields: string[] = [];

			// Snapshot keys + current keys (current may have brand-new fields
			// when the user types into a previously-empty path).
			const keys = new Set<string>([
				...Object.keys(snapshot),
				...Object.keys(current),
			]);

			for (const key of keys) {
				if (key.startsWith("_")) continue; // skip hidden form internals
				const before = snapshot[key];
				const after = current[key];
				if (Object.is(before, after)) continue;
				if (shallowEqual(before, after)) continue;

				const strategy = strategyByField[key] ?? "patch";
				if (strategy === "deferred") continue;

				if (strategy === "refresh") {
					needsRefresh = true;
					refreshFields.push(key);
				} else {
					ops.push({ op: "set", path: key, value: after });
				}

				snapshot[key] = after;
			}

			if (ops.length > 0) {
				seqRef.current += 1;
				ref.sendPatchBatch(seqRef.current, ops);
			}

			if (needsRefresh) {
				if (process.env.NODE_ENV !== "production") {
					console.debug(
						"[VisualEdit] field changed with refresh strategy — triggering preview refresh:",
						refreshFields,
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
 * Shallow equal for diff filtering. Returns `true` when the two
 * values are observably equivalent at the top level — same
 * primitive, same array contents (by `Object.is`), or same object
 * keys with `Object.is` values. Anything deeper falls through and
 * reports a diff so we don't drop legitimate changes.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			if (!Object.is(a[i], b[i])) return false;
		}
		return true;
	}
	const ka = Object.keys(a as Record<string, unknown>);
	const kb = Object.keys(b as Record<string, unknown>);
	if (ka.length !== kb.length) return false;
	for (const key of ka) {
		if (
			!Object.is(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			)
		) {
			return false;
		}
	}
	return true;
}
