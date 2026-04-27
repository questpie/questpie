/**
 * VisualEditProvider
 *
 * Selection state machine for the Visual Edit Workspace. Sits in the
 * same role as `FocusContext` does for the legacy live preview, but:
 *
 * - The selection union covers more shapes (array, array-item,
 *   block, block-field, relation), so the inspector can render a
 *   precise editor for the chosen target.
 * - It exposes `select(...)` rather than per-kind setters so future
 *   selection kinds can be added without breaking the consumer.
 *
 * The provider establishes the contract — preview clicks land here
 * via `mapPreviewClickToSelection` and the workspace bridge mirrors
 * the active selection to the iframe through `SELECT_TARGET`.
 */

"use client";

import * as React from "react";

import type { VisualEditSelection } from "./types.js";
import { selectionFieldPath } from "./types.js";

// ============================================================================
// Context shape
// ============================================================================

export type VisualEditContextValue = {
	selection: VisualEditSelection;
	/** Replace the current selection. Pass `{ kind: "idle" }` to clear. */
	select: (next: VisualEditSelection) => void;
	/** Convenience: clear the current selection. */
	clear: () => void;
	/**
	 * The form-field path the inspector should focus for the current
	 * selection, or `null` when `kind === "idle"`.
	 */
	focusedFieldPath: string | null;
};

const VisualEditContext = React.createContext<VisualEditContextValue | null>(
	null,
);

// ============================================================================
// Provider
// ============================================================================

export type VisualEditProviderProps = {
	children: React.ReactNode;
	/** Called whenever the selection changes (after `select` or `clear`). */
	onSelectionChange?: (selection: VisualEditSelection) => void;
	/** Optional initial selection — defaults to `{ kind: "idle" }`. */
	initialSelection?: VisualEditSelection;
};

export function VisualEditProvider({
	children,
	onSelectionChange,
	initialSelection,
}: VisualEditProviderProps) {
	const [selection, setSelection] = React.useState<VisualEditSelection>(
		initialSelection ?? { kind: "idle" },
	);

	// Mirror onSelectionChange in a ref so `select` can stay stable
	// even if the consumer recreates the callback every render.
	const onSelectionChangeRef = React.useRef(onSelectionChange);
	React.useEffect(() => {
		onSelectionChangeRef.current = onSelectionChange;
	}, [onSelectionChange]);

	const select = React.useCallback((next: VisualEditSelection) => {
		setSelection(next);
		onSelectionChangeRef.current?.(next);
	}, []);

	const clear = React.useCallback(() => {
		const next: VisualEditSelection = { kind: "idle" };
		setSelection(next);
		onSelectionChangeRef.current?.(next);
	}, []);

	const focusedFieldPath = React.useMemo(
		() => selectionFieldPath(selection),
		[selection],
	);

	const value = React.useMemo<VisualEditContextValue>(
		() => ({ selection, select, clear, focusedFieldPath }),
		[selection, select, clear, focusedFieldPath],
	);

	return (
		<VisualEditContext.Provider value={value}>
			{children}
		</VisualEditContext.Provider>
	);
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Read the current Visual Edit selection. Throws when called outside
 * a `VisualEditProvider` so consumers fail loudly during development.
 */
export function useVisualEdit(): VisualEditContextValue {
	const ctx = React.useContext(VisualEditContext);
	if (!ctx) {
		throw new Error(
			"useVisualEdit must be used inside a <VisualEditProvider>",
		);
	}
	return ctx;
}

/**
 * Soft variant — returns `null` when no provider is mounted. Useful
 * for components that want to opt-in to workspace integration but
 * still render in the legacy form view.
 */
export function useVisualEditOptional(): VisualEditContextValue | null {
	return React.useContext(VisualEditContext);
}
