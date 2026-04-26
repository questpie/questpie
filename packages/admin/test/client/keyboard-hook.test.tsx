/**
 * `useDeselectOnEscape` — integration tests
 *
 * Verifies the hook attaches a document-level keydown listener
 * that fires `onDeselect` on Escape, but only when focus is
 * outside an editable element. Pairs with `keyboard.test.ts`,
 * which covers the `isEditableElement` predicate in isolation.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";

import { useDeselectOnEscape } from "#questpie/admin/client/components/visual-edit/keyboard";

// Helper to fire a real KeyboardEvent on document — happy-dom
// supports the standard KeyboardEvent constructor.
function pressKey(key: string) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	document.dispatchEvent(event);
	return event;
}

afterEach(() => {
	// Each test focuses different elements; reset to body so the
	// next test starts with the default activeElement.
	if (document.body) document.body.focus();
	cleanup();
});

describe("useDeselectOnEscape — happy path", () => {
	it("fires onDeselect when Escape is pressed outside an editable element", () => {
		const onDeselect = mock(() => {});
		renderHook(() => useDeselectOnEscape({ onDeselect }));

		pressKey("Escape");

		expect(onDeselect).toHaveBeenCalledTimes(1);
	});

	it("does not fire for non-Escape keys", () => {
		const onDeselect = mock(() => {});
		renderHook(() => useDeselectOnEscape({ onDeselect }));

		pressKey("Enter");
		pressKey("a");
		pressKey("Tab");

		expect(onDeselect).not.toHaveBeenCalled();
	});
});

describe("useDeselectOnEscape — editable focus guard", () => {
	it("does NOT fire when focus is in an input", () => {
		const onDeselect = mock(() => {});
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		input.focus();

		renderHook(() => useDeselectOnEscape({ onDeselect }));
		pressKey("Escape");

		expect(onDeselect).not.toHaveBeenCalled();
		input.remove();
	});

	it("does NOT fire when focus is in a textarea", () => {
		const onDeselect = mock(() => {});
		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		textarea.focus();

		renderHook(() => useDeselectOnEscape({ onDeselect }));
		pressKey("Escape");

		expect(onDeselect).not.toHaveBeenCalled();
		textarea.remove();
	});

	it("DOES fire when focus is on a non-text input (button)", () => {
		const onDeselect = mock(() => {});
		const button = document.createElement("button");
		document.body.appendChild(button);
		button.focus();

		renderHook(() => useDeselectOnEscape({ onDeselect }));
		pressKey("Escape");

		expect(onDeselect).toHaveBeenCalledTimes(1);
		button.remove();
	});

	it("does NOT fire when focus is in a contenteditable element", () => {
		const onDeselect = mock(() => {});
		const div = document.createElement("div");
		div.setAttribute("contenteditable", "true");
		div.tabIndex = 0;
		document.body.appendChild(div);
		div.focus();

		renderHook(() => useDeselectOnEscape({ onDeselect }));
		pressKey("Escape");

		expect(onDeselect).not.toHaveBeenCalled();
		div.remove();
	});
});

describe("useDeselectOnEscape — disabled flag", () => {
	it("becomes a no-op when disabled is true", () => {
		const onDeselect = mock(() => {});
		renderHook(() =>
			useDeselectOnEscape({ onDeselect, disabled: true }),
		);
		pressKey("Escape");
		expect(onDeselect).not.toHaveBeenCalled();
	});

	it("starts firing again after disabled flips back to false", () => {
		const onDeselect = mock(() => {});
		const { rerender } = renderHook(
			(props: { disabled: boolean }) =>
				useDeselectOnEscape({ onDeselect, disabled: props.disabled }),
			{ initialProps: { disabled: true } },
		);

		pressKey("Escape");
		expect(onDeselect).not.toHaveBeenCalled();

		rerender({ disabled: false });
		pressKey("Escape");
		expect(onDeselect).toHaveBeenCalledTimes(1);
	});
});

describe("useDeselectOnEscape — cleanup + ref mirroring", () => {
	it("removes the listener on unmount", () => {
		const onDeselect = mock(() => {});
		const { unmount } = renderHook(() =>
			useDeselectOnEscape({ onDeselect }),
		);
		unmount();

		pressKey("Escape");
		expect(onDeselect).not.toHaveBeenCalled();
	});

	it("uses the latest onDeselect callback (no stale closure)", () => {
		const first = mock(() => {});
		const second = mock(() => {});
		const { rerender } = renderHook(
			(props: { cb: () => void }) =>
				useDeselectOnEscape({ onDeselect: props.cb }),
			{ initialProps: { cb: first } },
		);

		rerender({ cb: second });
		pressKey("Escape");

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("respects defaultPrevented — does not fire if the event was already handled", () => {
		const onDeselect = mock(() => {});
		renderHook(() => useDeselectOnEscape({ onDeselect }));

		// Pre-handler that calls preventDefault before our hook sees it.
		const preHandler = (event: KeyboardEvent) => {
			if (event.key === "Escape") event.preventDefault();
		};
		document.addEventListener("keydown", preHandler, { capture: true });

		pressKey("Escape");

		expect(onDeselect).not.toHaveBeenCalled();
		document.removeEventListener("keydown", preHandler, { capture: true });
	});
});
