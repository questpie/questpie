/**
 * VisualEditProvider — selection state machine tests.
 *
 * Covers the contract surface used by every workspace primitive:
 *
 *   - default + initial selection
 *   - `select(...)` / `clear()` flow
 *   - `focusedFieldPath` derivation
 *   - `onSelectionChange` invocation
 *   - `useVisualEdit()` throws outside the provider
 *   - `useVisualEditOptional()` returns null outside the provider
 *   - `useVisualEditController()` throws outside the host
 *   - `useVisualEditControllerOptional()` returns null outside the host
 */

import { describe, expect, it, mock } from "bun:test";
import * as React from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";

import {
	VisualEditProvider,
	useVisualEdit,
	useVisualEditOptional,
} from "#questpie/admin/client/components/visual-edit/visual-edit-context";
import {
	useVisualEditController,
	useVisualEditControllerOptional,
} from "#questpie/admin/client/components/visual-edit/visual-edit-form-host";
import type { VisualEditSelection } from "#questpie/admin/client/components/visual-edit/types";

function wrapWith(
	props?: React.ComponentProps<typeof VisualEditProvider>,
): React.FC<{ children: React.ReactNode }> {
	return function Wrapper({ children }) {
		return <VisualEditProvider {...props}>{children}</VisualEditProvider>;
	};
}

describe("VisualEditProvider — defaults", () => {
	it("starts at idle when no initialSelection is passed", () => {
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith(),
		});
		expect(result.current.selection).toEqual({ kind: "idle" });
		expect(result.current.focusedFieldPath).toBeNull();
		cleanup();
	});

	it("honours initialSelection", () => {
		const initial: VisualEditSelection = {
			kind: "field",
			fieldPath: "title",
		};
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith({ initialSelection: initial }),
		});
		expect(result.current.selection).toEqual(initial);
		expect(result.current.focusedFieldPath).toBe("title");
		cleanup();
	});
});

describe("VisualEditProvider — select / clear", () => {
	it("updates selection and derives focusedFieldPath", () => {
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith(),
		});

		act(() => {
			result.current.select({
				kind: "block-field",
				blocksPath: "content",
				blockId: "abc",
				fieldPath: "title",
			});
		});

		expect(result.current.selection).toEqual({
			kind: "block-field",
			blocksPath: "content",
			blockId: "abc",
			fieldPath: "title",
		});
		expect(result.current.focusedFieldPath).toBe(
			"content._values.abc.title",
		);
		cleanup();
	});

	it("clear() returns to idle", () => {
		const initial: VisualEditSelection = {
			kind: "field",
			fieldPath: "title",
		};
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith({ initialSelection: initial }),
		});

		act(() => {
			result.current.clear();
		});

		expect(result.current.selection).toEqual({ kind: "idle" });
		expect(result.current.focusedFieldPath).toBeNull();
		cleanup();
	});
});

describe("VisualEditProvider — onSelectionChange", () => {
	it("fires for select() with the next selection", () => {
		const onSelectionChange = mock(() => {});
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith({ onSelectionChange }),
		});

		const next: VisualEditSelection = {
			kind: "field",
			fieldPath: "slug",
		};
		act(() => {
			result.current.select(next);
		});

		expect(onSelectionChange).toHaveBeenCalledTimes(1);
		expect(onSelectionChange.mock.calls[0]![0]).toEqual(next);
		cleanup();
	});

	it("fires for clear() with the idle selection", () => {
		const onSelectionChange = mock(() => {});
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith({
				initialSelection: { kind: "field", fieldPath: "title" },
				onSelectionChange,
			}),
		});

		act(() => {
			result.current.clear();
		});

		expect(onSelectionChange).toHaveBeenCalledTimes(1);
		expect(onSelectionChange.mock.calls[0]![0]).toEqual({ kind: "idle" });
		cleanup();
	});

	it("fires for clear() even when already idle (no idempotency dedupe)", () => {
		// Useful for the Esc-to-deselect path: pressing Esc while
		// the workspace is already in Document mode should still
		// fire onSelectionChange so the bridge re-sends
		// SELECT_TARGET(null) — this keeps the iframe and the
		// inspector in sync if either side drifted. Lock in the
		// "clear always notifies" semantic so a future "skip when
		// already idle" optimisation doesn't break it.
		const onSelectionChange = mock(() => {});
		const { result } = renderHook(() => useVisualEdit(), {
			wrapper: wrapWith({
				// Already idle by default — no initialSelection.
				onSelectionChange,
			}),
		});

		act(() => {
			result.current.clear();
		});
		act(() => {
			result.current.clear();
		});

		// Two clears, two fires.
		expect(onSelectionChange).toHaveBeenCalledTimes(2);
		for (const call of onSelectionChange.mock.calls) {
			expect(call[0]).toEqual({ kind: "idle" });
		}
		cleanup();
	});

	it("uses the latest onSelectionChange via internal ref (callback identity changes don't lose updates)", () => {
		const first = mock(() => {});
		const second = mock(() => {});

		function Probe({
			onSelectionChange,
		}: {
			onSelectionChange: (s: VisualEditSelection) => void;
		}) {
			const ctx = useVisualEdit();
			return (
				<button
					type="button"
					data-testid="select"
					onClick={() => {
						ctx.select({ kind: "field", fieldPath: "x" });
					}}
				>
					select
					{onSelectionChange.toString().length === 0 ? "" : ""}
				</button>
			);
		}

		const { rerender, getByTestId } = render(
			<VisualEditProvider onSelectionChange={first}>
				<Probe onSelectionChange={first} />
			</VisualEditProvider>,
		);

		// Swap callback before triggering select.
		rerender(
			<VisualEditProvider onSelectionChange={second}>
				<Probe onSelectionChange={second} />
			</VisualEditProvider>,
		);

		act(() => {
			getByTestId("select").click();
		});

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
		cleanup();
	});
});

describe("useVisualEdit / useVisualEditOptional — outside provider", () => {
	it("useVisualEdit throws outside a provider", () => {
		// renderHook re-throws synchronously when the hook throws.
		const originalError = console.error;
		console.error = () => {};
		try {
			expect(() => renderHook(() => useVisualEdit())).toThrow(
				/must be used inside a <VisualEditProvider>/,
			);
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("useVisualEditOptional returns null outside a provider", () => {
		const { result } = renderHook(() => useVisualEditOptional());
		expect(result.current).toBeNull();
		cleanup();
	});
});

describe("useVisualEditController / Optional — outside host", () => {
	it("useVisualEditController throws outside <VisualEditFormHost>", () => {
		// Mirrors the loud-misuse semantics of `useVisualEdit`: the
		// strict variant throws rather than silently returning a
		// stub controller that would mask wiring bugs in user code.
		const originalError = console.error;
		console.error = () => {};
		try {
			expect(() => renderHook(() => useVisualEditController())).toThrow(
				/must be used inside <VisualEditFormHost>/,
			);
		} finally {
			console.error = originalError;
			cleanup();
		}
	});

	it("useVisualEditControllerOptional returns null outside <VisualEditFormHost>", () => {
		// The soft variant exists for primitives that opt into
		// workspace context but still render inside the legacy form
		// view — they need to render either way.
		const { result } = renderHook(() => useVisualEditControllerOptional());
		expect(result.current).toBeNull();
		cleanup();
	});
});
