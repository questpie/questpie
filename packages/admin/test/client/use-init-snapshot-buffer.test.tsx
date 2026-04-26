/**
 * useInitSnapshotBuffer — buffer + replay primitive tests
 *
 * The hook backs `PreviewPane`'s INIT_SNAPSHOT replay behaviour
 * (production hardening from earlier in the branch). Now that
 * the logic is extracted, we can verify it directly via
 * `renderHook` without spinning up the full PreviewPane.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";

import { useInitSnapshotBuffer } from "#questpie/admin/client/components/preview/use-init-snapshot-buffer";

afterEach(() => {
	cleanup();
});

describe("useInitSnapshotBuffer — when ready", () => {
	it("forwards setBuffered straight to send()", () => {
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: true, send }),
		);

		result.current.setBuffered({ a: 1 });

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]![0]).toEqual({ a: 1 });
	});

	it("replay() resends the most recent buffered payload", () => {
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: true, send }),
		);

		result.current.setBuffered({ a: 1 });
		result.current.setBuffered({ a: 2 });
		result.current.replay();

		// 2 setBuffered calls + 1 replay = 3 send invocations.
		expect(send).toHaveBeenCalledTimes(3);
		expect(send.mock.calls[2]![0]).toEqual({ a: 2 });
	});

	it("replay() with no buffered payload is a no-op", () => {
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: true, send }),
		);

		result.current.replay();

		expect(send).not.toHaveBeenCalled();
	});
});

describe("useInitSnapshotBuffer — when not ready", () => {
	it("setBuffered does NOT send", () => {
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: false, send }),
		);

		result.current.setBuffered({ a: 1 });

		expect(send).not.toHaveBeenCalled();
	});

	it("replay() sends the buffered payload (covers iframe-late-ready)", () => {
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: false, send }),
		);

		result.current.setBuffered({ a: 1 });
		expect(send).not.toHaveBeenCalled();

		result.current.replay();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]![0]).toEqual({ a: 1 });
	});
});

describe("useInitSnapshotBuffer — readiness transitions", () => {
	it("setBuffered after isReady flips true → sends", () => {
		const send = mock((_: unknown) => {});
		const { result, rerender } = renderHook(
			(props: { isReady: boolean }) =>
				useInitSnapshotBuffer<{ a: number }>({
					isReady: props.isReady,
					send,
				}),
			{ initialProps: { isReady: false } },
		);

		// Buffer one before ready — no send.
		result.current.setBuffered({ a: 1 });
		expect(send).not.toHaveBeenCalled();

		// Flip to ready.
		rerender({ isReady: true });

		// Next setBuffered should now send (no replay needed).
		result.current.setBuffered({ a: 2 });
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]![0]).toEqual({ a: 2 });
	});

	it("repeated PREVIEW_READY events — replay each time", () => {
		// Simulates an iframe that reloads multiple times.
		const send = mock((_: unknown) => {});
		const { result } = renderHook(() =>
			useInitSnapshotBuffer<{ a: number }>({ isReady: true, send }),
		);

		result.current.setBuffered({ a: 1 });
		expect(send).toHaveBeenCalledTimes(1);

		result.current.replay();
		result.current.replay();
		result.current.replay();

		expect(send).toHaveBeenCalledTimes(4);
		// All replays carry the latest payload.
		for (const call of send.mock.calls.slice(1)) {
			expect(call[0]).toEqual({ a: 1 });
		}
	});
});

describe("useInitSnapshotBuffer — ref mirroring", () => {
	it("uses the LATEST send callback even if its identity changes", () => {
		const first = mock((_: unknown) => {});
		const second = mock((_: unknown) => {});

		const { result, rerender } = renderHook(
			(props: { send: (p: { a: number }) => void }) =>
				useInitSnapshotBuffer<{ a: number }>({
					isReady: true,
					send: props.send,
				}),
			{ initialProps: { send: first } },
		);

		// Swap send before any setBuffered call.
		rerender({ send: second });

		result.current.setBuffered({ a: 1 });

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it("setBuffered + replay identities stay stable across rerenders", () => {
		const send = mock((_: unknown) => {});
		const { result, rerender } = renderHook(
			(props: { isReady: boolean }) =>
				useInitSnapshotBuffer<{ a: number }>({
					isReady: props.isReady,
					send,
				}),
			{ initialProps: { isReady: false } },
		);

		const initialSet = result.current.setBuffered;
		const initialReplay = result.current.replay;

		rerender({ isReady: true });
		rerender({ isReady: false });

		// Same callback identity preserved → consumers using these in
		// useImperativeHandle deps don't rebuild the imperative handle
		// on every isReady flip.
		expect(result.current.setBuffered).toBe(initialSet);
		expect(result.current.replay).toBe(initialReplay);
	});
});
