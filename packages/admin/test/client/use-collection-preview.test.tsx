/**
 * useCollectionPreview — iframe-side handler tests
 *
 * The hook installs a `message` listener on the window and
 * processes admin-side protocol messages (INIT_SNAPSHOT,
 * PATCH_BATCH, COMMIT, FULL_RESYNC, SELECT_TARGET,
 * NAVIGATE_PREVIEW). These tests dispatch synthetic
 * MessageEvents and verify the hook's returned state +
 * `onRefresh` invocations.
 *
 * Two production checks block the listener: `isPreviewMode`
 * (computed from `window.self !== window.top`) and the resolved
 * admin origin (read from `document.referrer`). We override both
 * via `Object.defineProperty` per-test so the hook believes it's
 * running inside an iframe with a known parent origin, then
 * restore on cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useCollectionPreview } from "#questpie/admin/client/preview/use-collection-preview";

const ADMIN_ORIGIN = "http://admin.example.com";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

let originalTopDescriptor: PropertyDescriptor | undefined;
let originalReferrerDescriptor: PropertyDescriptor | undefined;
let originalLocationReplace: typeof window.location.replace;
let originalParentPostMessage: typeof window.parent.postMessage;
let originalConsoleError: typeof console.error;

beforeEach(() => {
	// Force `window.self !== window.top` so the hook treats the
	// page as a preview iframe and installs its message listener.
	originalTopDescriptor = Object.getOwnPropertyDescriptor(window, "top");
	Object.defineProperty(window, "top", {
		configurable: true,
		get: () => ({}) as Window,
	});

	// Pin the admin origin so postMessage event-origin checks match.
	originalReferrerDescriptor = Object.getOwnPropertyDescriptor(
		document,
		"referrer",
	);
	Object.defineProperty(document, "referrer", {
		configurable: true,
		get: () => `${ADMIN_ORIGIN}/`,
	});

	// `window.parent.postMessage(msg, adminOrigin)` throws a
	// SecurityError in happy-dom because window.parent === window
	// (no real iframe) and the origins don't match. Stub it so the
	// hook's `sendToAdmin` is a no-op for these tests; the
	// receiving side is what we care about.
	originalParentPostMessage = window.parent.postMessage.bind(window.parent);
	(window.parent as { postMessage: (...args: unknown[]) => void }).postMessage =
		mock(() => {});

	// NAVIGATE_PREVIEW calls `window.location.replace` — stub it so
	// the test runner doesn't actually navigate happy-dom.
	originalLocationReplace = window.location.replace.bind(window.location);
	(window.location as { replace: (url: string) => void }).replace = mock(
		() => {},
	);

	// The production code dev-warns on origin mismatch + dev-error
	// on serialization issues. Silence both — the tests assert
	// behaviour, not console output.
	originalConsoleError = console.error;
	console.error = () => {};
});

afterEach(() => {
	if (originalTopDescriptor) {
		Object.defineProperty(window, "top", originalTopDescriptor);
	}
	if (originalReferrerDescriptor) {
		Object.defineProperty(document, "referrer", originalReferrerDescriptor);
	}
	(window.parent as { postMessage: typeof originalParentPostMessage }).postMessage =
		originalParentPostMessage;
	(window.location as { replace: (url: string) => void }).replace =
		originalLocationReplace;
	console.error = originalConsoleError;
	cleanup();
});

function dispatchAdminMessage(
	data: unknown,
	origin: string = ADMIN_ORIGIN,
): MessageEvent {
	const event = new MessageEvent("message", {
		data,
		origin,
	});
	window.dispatchEvent(event);
	return event;
}

async function flushAsync(): Promise<void> {
	// PREVIEW_REFRESH / COMMIT / FULL_RESYNC await `onRefresh()`;
	// give the microtask queue a chance to drain so the assertions
	// see the post-await state changes.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCollectionPreview — INIT_SNAPSHOT", () => {
	it("seeds the local draft and exposes it via `data`", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		expect(result.current.data).toEqual({ title: "Initial" });
		expect(result.current.isDraftActive).toBe(false);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "From snapshot" },
			});
		});

		expect(result.current.data).toEqual({ title: "From snapshot" });
		expect(result.current.isDraftActive).toBe(true);
	});

	it("ignores messages from a wrong origin", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage(
				{ type: "INIT_SNAPSHOT", snapshot: { title: "Bad" } },
				"http://attacker.example.com",
			);
		});

		expect(result.current.data).toEqual({ title: "Initial" });
		expect(result.current.isDraftActive).toBe(false);
	});
});

describe("useCollectionPreview — PATCH_BATCH", () => {
	it("applies set ops on top of the snapshot", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "Snap", description: "D" },
			});
		});

		act(() => {
			dispatchAdminMessage({
				type: "PATCH_BATCH",
				seq: 1,
				ops: [{ op: "set", path: "title", value: "Patched" }],
			});
		});

		expect(result.current.data).toEqual({
			title: "Patched",
			description: "D",
		});
	});

	it("applies remove ops", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "T", description: "D" },
			});
		});

		act(() => {
			dispatchAdminMessage({
				type: "PATCH_BATCH",
				seq: 1,
				ops: [{ op: "remove", path: "description" }],
			});
		});

		expect(result.current.data).toEqual({ title: "T" });
	});

	it("ignores stale-seq batches", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "T" },
			});
		});

		act(() => {
			dispatchAdminMessage({
				type: "PATCH_BATCH",
				seq: 5,
				ops: [{ op: "set", path: "title", value: "From seq=5" }],
			});
		});

		// seq=3 < lastSeq=5 → ignored.
		act(() => {
			dispatchAdminMessage({
				type: "PATCH_BATCH",
				seq: 3,
				ops: [{ op: "set", path: "title", value: "Stale" }],
			});
		});

		expect(result.current.data).toEqual({ title: "From seq=5" });
	});
});

describe("useCollectionPreview — COMMIT", () => {
	it("swaps the local draft for the new snapshot when commit carries one", async () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "Snap" },
			});
		});

		await act(async () => {
			dispatchAdminMessage({
				type: "COMMIT",
				timestamp: Date.now(),
				snapshot: { title: "Saved" },
			});
			await flushAsync();
		});

		expect(result.current.data).toEqual({ title: "Saved" });
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("drops the draft + calls onRefresh when commit has no snapshot", async () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "Snap" },
			});
		});
		expect(result.current.isDraftActive).toBe(true);

		await act(async () => {
			dispatchAdminMessage({
				type: "COMMIT",
				timestamp: Date.now(),
			});
			await flushAsync();
		});

		expect(result.current.isDraftActive).toBe(false);
		expect(result.current.data).toEqual({ title: "Initial" });
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});
});

describe("useCollectionPreview — FULL_RESYNC", () => {
	it("drops the draft and re-runs onRefresh", async () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: { title: "Initial" },
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "INIT_SNAPSHOT",
				snapshot: { title: "Snap" },
			});
		});
		expect(result.current.isDraftActive).toBe(true);

		await act(async () => {
			dispatchAdminMessage({
				type: "FULL_RESYNC",
				reason: "revert",
			});
			await flushAsync();
		});

		expect(result.current.isDraftActive).toBe(false);
		expect(result.current.data).toEqual({ title: "Initial" });
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});
});

describe("useCollectionPreview — SELECT_TARGET / FOCUS_FIELD", () => {
	it("updates focusedField on FOCUS_FIELD", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "FOCUS_FIELD",
				fieldPath: "title",
			});
		});

		expect(result.current.focusedField).toBe("title");
	});

	it("updates focusedField + selectedBlockId on SELECT_TARGET with block context", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "SELECT_TARGET",
				fieldPath: "content._values.abc.title",
				kind: "block-field",
				blockId: "abc",
			});
		});

		expect(result.current.focusedField).toBe(
			"content._values.abc.title",
		);
		expect(result.current.selectedBlockId).toBe("abc");
	});

	it("updates selectedBlockId on SELECT_BLOCK", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "SELECT_BLOCK",
				blockId: "abc",
			});
		});

		expect(result.current.selectedBlockId).toBe("abc");
	});

	it("clears focusedField on SELECT_TARGET with null path (idle)", () => {
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({ initialData: {}, onRefresh }),
		);

		// Seed a focus first.
		act(() => {
			dispatchAdminMessage({ type: "FOCUS_FIELD", fieldPath: "title" });
		});
		expect(result.current.focusedField).toBe("title");

		// Idle SELECT_TARGET should clear it.
		act(() => {
			dispatchAdminMessage({
				type: "SELECT_TARGET",
				fieldPath: null,
				kind: "idle",
			});
		});

		expect(result.current.focusedField).toBeNull();
	});

	it("preserves selectedBlockId when SELECT_TARGET arrives without a blockId", () => {
		// Lock in the design choice: selecting a non-block field after
		// a block has been highlighted does NOT clear the block. The
		// canvas can show both a focused field AND a block outline at
		// the same time. This matches V1's FOCUS_FIELD behaviour.
		const onRefresh = mock(() => Promise.resolve());
		const { result } = renderHook(() =>
			useCollectionPreview({ initialData: {}, onRefresh }),
		);

		act(() => {
			dispatchAdminMessage({ type: "SELECT_BLOCK", blockId: "abc" });
		});
		expect(result.current.selectedBlockId).toBe("abc");

		// Move focus to a regular field; bridge sends SELECT_TARGET
		// without a `blockId` extra.
		act(() => {
			dispatchAdminMessage({
				type: "SELECT_TARGET",
				fieldPath: "title",
				kind: "field",
			});
		});

		expect(result.current.focusedField).toBe("title");
		// Block selection persists by design.
		expect(result.current.selectedBlockId).toBe("abc");
	});
});

describe("useCollectionPreview — NAVIGATE_PREVIEW", () => {
	it("ignores cross-origin navigation requests", () => {
		const onRefresh = mock(() => Promise.resolve());
		renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "NAVIGATE_PREVIEW",
				url: "http://attacker.example.com/evil",
			});
		});

		expect(window.location.replace).not.toHaveBeenCalled();
	});

	it("calls location.replace for same-origin URLs", () => {
		const onRefresh = mock(() => Promise.resolve());
		renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		act(() => {
			dispatchAdminMessage({
				type: "NAVIGATE_PREVIEW",
				url: "/some/path",
			});
		});

		expect(window.location.replace).toHaveBeenCalledTimes(1);
	});
});

describe("useCollectionPreview — PREVIEW_REFRESH (V1 fallback)", () => {
	it("calls onRefresh for legacy refresh messages", async () => {
		const onRefresh = mock(() => Promise.resolve());
		renderHook(() =>
			useCollectionPreview({
				initialData: {},
				onRefresh,
			}),
		);

		await act(async () => {
			dispatchAdminMessage({ type: "PREVIEW_REFRESH" });
			await flushAsync();
		});

		expect(onRefresh).toHaveBeenCalledTimes(1);
	});
});
