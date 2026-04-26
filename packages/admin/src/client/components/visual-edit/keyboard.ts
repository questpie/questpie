/**
 * Visual Edit keyboard helpers
 *
 * Pure utilities + a thin React hook for the workspace's
 * keyboard affordances. Kept in their own file so the predicate
 * is unit-testable without React/DOM mocking.
 */

import * as React from "react";

// ============================================================================
// Editable-element predicate
// ============================================================================

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// Inputs that are "editable" only superficially — checkboxes, radios,
// buttons should NOT block deselect.
const NON_TEXT_INPUT_TYPES = new Set([
	"checkbox",
	"radio",
	"button",
	"submit",
	"reset",
	"image",
	"file",
]);

/**
 * `true` when an element is currently accepting text input — and
 * therefore should swallow Esc-to-deselect rather than triggering it.
 *
 * Considers:
 *   - `<textarea>` and `<select>` (always editable surfaces)
 *   - `<input>` of a type that accepts text
 *   - any element with `contenteditable=true`
 */
export function isEditableElement(
	element: Element | null | undefined,
): boolean {
	if (!element) return false;

	const tag = (element as HTMLElement).tagName;
	if (!tag) return false;

	if (tag === "TEXTAREA" || tag === "SELECT") return true;

	if (tag === "INPUT") {
		const type = (
			(element as HTMLInputElement).type ?? "text"
		).toLowerCase();
		return !NON_TEXT_INPUT_TYPES.has(type);
	}

	const contentEditable = (
		element as HTMLElement
	).getAttribute?.("contenteditable");
	if (
		contentEditable === "true" ||
		contentEditable === "" ||
		contentEditable === "plaintext-only"
	) {
		return true;
	}

	// Check `EDITABLE_TAGS` last so callers can extend it without
	// rewriting the explicit checks above.
	return EDITABLE_TAGS.has(tag);
}

// ============================================================================
// Hook: deselect on Escape
// ============================================================================

export type UseDeselectOnEscapeOptions = {
	/**
	 * Called when the user presses Escape outside of an editable
	 * element. The hook is a no-op until the workspace is mounted,
	 * so the callback is guaranteed to fire only while the
	 * workspace is alive.
	 */
	onDeselect: () => void;
	/** When true, the hook becomes a no-op. Useful for tests. */
	disabled?: boolean;
};

/**
 * Bind a `keydown` listener that fires `onDeselect` on Escape,
 * but only when focus is not inside an editable element so it
 * doesn't fight with native input behaviours (e.g. clearing a
 * select dropdown).
 */
export function useDeselectOnEscape({
	onDeselect,
	disabled,
}: UseDeselectOnEscapeOptions): void {
	const onDeselectRef = React.useRef(onDeselect);
	React.useEffect(() => {
		onDeselectRef.current = onDeselect;
	}, [onDeselect]);

	React.useEffect(() => {
		if (disabled) return;
		if (typeof document === "undefined") return;

		const handler = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented) return;
			if (isEditableElement(document.activeElement)) return;
			onDeselectRef.current();
		};

		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [disabled]);
}
