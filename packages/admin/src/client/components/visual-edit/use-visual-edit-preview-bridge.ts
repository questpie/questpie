/**
 * useVisualEditPreviewBridge
 *
 * Glues `useResourceFormController` to a `PreviewPane` so the
 * Visual Edit Workspace can drive the V2 patch protocol without
 * any wiring inside the controller itself:
 *
 * 1. When the form mounts and an item snapshot is available,
 *    seed the preview with `INIT_SNAPSHOT`.
 * 2. After update/create succeeds, send `COMMIT` so the preview
 *    swaps its local draft for the canonical record.
 * 3. After delete/restore/revert/transition succeeds, send
 *    `FULL_RESYNC` so the preview re-fetches.
 * 4. When the active selection changes, forward
 *    `SELECT_TARGET` so the preview can mirror the inspector's
 *    outline.
 *
 * The hook is a no-op until the preview becomes ready and the
 * caller passes a `previewRef`.
 */

"use client";

import * as React from "react";

import type { PreviewPaneRef } from "../preview/preview-pane.js";
import type { ResourceFormController } from "../../views/collection/use-resource-form-controller.js";
import type { VisualEditSelection } from "./types.js";
import { selectionFieldPath } from "./types.js";
import { useVisualEdit } from "./visual-edit-context.js";

// ============================================================================
// Args
// ============================================================================

export type UseVisualEditPreviewBridgeArgs = {
	/** The active form controller — usually from `useResourceFormController` */
	controller: ResourceFormController;
	/** Ref to the `PreviewPane` rendered inside the workspace */
	previewRef: React.RefObject<PreviewPaneRef | null>;
	/**
	 * Locale to send with `INIT_SNAPSHOT`. Defaults to whatever the
	 * controller exposed; pass explicitly to override.
	 */
	locale?: string;
};

// ============================================================================
// Hook
// ============================================================================

export function useVisualEditPreviewBridge({
	controller,
	previewRef,
	locale,
}: UseVisualEditPreviewBridgeArgs): void {
	const { selection } = useVisualEdit();

	// 1) Seed the preview's local draft once an item snapshot is
	//    available. The transformedItem already has M:N relations
	//    flattened to id arrays so the preview gets exactly what the
	//    form sees.
	const seededIdRef = React.useRef<unknown>(undefined);
	React.useEffect(() => {
		const ref = previewRef.current;
		if (!ref) return;
		if (!controller.transformedItem) return;
		// Re-seed when the loaded record changes (different id, a
		// revert, a locale switch). Fall through cheaply otherwise.
		const itemId = (controller.transformedItem as { id?: unknown })?.id;
		if (itemId !== undefined && seededIdRef.current === itemId) return;
		seededIdRef.current = itemId;
		ref.sendInitSnapshot(
			controller.transformedItem as Record<string, unknown>,
			{ locale },
		);
	}, [controller.transformedItem, locale, previewRef]);

	// 2) Wire mutation success → COMMIT / FULL_RESYNC. Each mutation
	//    keeps its own watcher so we can pick the right protocol
	//    message per action.
	useCommitOnSuccess(
		controller.mutations.update.isSuccess,
		controller.mutations.update.data,
		previewRef,
	);
	useCommitOnSuccess(
		controller.mutations.create.isSuccess,
		controller.mutations.create.data,
		previewRef,
	);
	useResyncOnSuccess(
		controller.mutations.remove.isSuccess,
		previewRef,
		"manual",
	);
	useResyncOnSuccess(
		controller.mutations.restore.isSuccess,
		previewRef,
		"revert",
	);
	useResyncOnSuccess(
		controller.mutations.revertVersion.isSuccess,
		previewRef,
		"revert",
	);
	useResyncOnSuccess(
		controller.mutations.transition.isSuccess,
		previewRef,
		"stage-switch",
	);

	// 3) Forward selection changes to the preview so the canvas can
	//    mirror the inspector's outline. We re-derive the path here
	//    instead of caching it on the selection so the preview
	//    receives a stable path even if the helper changes.
	React.useEffect(() => {
		const ref = previewRef.current;
		if (!ref) return;
		const path = selectionFieldPath(selection);
		ref.sendSelectTarget(path, extrasFromSelection(selection));
	}, [previewRef, selection]);
}

// ============================================================================
// Helpers
// ============================================================================

function useCommitOnSuccess(
	isSuccess: boolean,
	data: unknown,
	previewRef: React.RefObject<PreviewPaneRef | null>,
) {
	const lastSeenRef = React.useRef<unknown>(undefined);
	React.useEffect(() => {
		if (!isSuccess) return;
		// React Query keeps `data` stable across re-renders once a
		// mutation settles, so we use it as the dedupe key. Only
		// fire COMMIT when the data reference changes.
		if (lastSeenRef.current === data) return;
		lastSeenRef.current = data;

		const ref = previewRef.current;
		if (!ref) return;
		ref.sendCommit(data as Record<string, unknown> | undefined);
	}, [isSuccess, data, previewRef]);
}

function useResyncOnSuccess(
	isSuccess: boolean,
	previewRef: React.RefObject<PreviewPaneRef | null>,
	reason: Parameters<PreviewPaneRef["sendFullResync"]>[0],
) {
	const seenRef = React.useRef(false);
	React.useEffect(() => {
		if (!isSuccess) {
			seenRef.current = false;
			return;
		}
		if (seenRef.current) return;
		seenRef.current = true;
		previewRef.current?.sendFullResync(reason);
	}, [isSuccess, previewRef, reason]);
}

function extrasFromSelection(
	selection: VisualEditSelection,
): { kind?: string; blockId?: string } {
	switch (selection.kind) {
		case "block":
		case "block-field":
			return { kind: selection.kind, blockId: selection.blockId };
		case "idle":
			return { kind: "idle" };
		default:
			return { kind: selection.kind };
	}
}
