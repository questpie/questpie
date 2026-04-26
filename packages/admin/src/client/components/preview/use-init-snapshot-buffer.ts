/**
 * useInitSnapshotBuffer
 *
 * Generic buffer + replay primitive used by `PreviewPane` to keep
 * the most recent `INIT_SNAPSHOT`-shaped payload around for
 * replay on every iframe ready event.
 *
 * Two reliability properties:
 *
 * 1. **Late iframes don't lose the snapshot.** If the consumer
 *    calls `setBuffered(...)` before the iframe is ready, the
 *    payload is stashed in the ref. The next `replay()` (fired
 *    by the PREVIEW_READY handler) sends it.
 * 2. **Reloads recover automatically.** Each PREVIEW_READY a
 *    consumer receives can call `replay()` again — the buffered
 *    payload is stable until the next `setBuffered`.
 *
 * Pure React, no DOM, no timers — fully testable via
 * `renderHook`.
 */

"use client";

import * as React from "react";

// ============================================================================
// Hook
// ============================================================================

export type UseInitSnapshotBufferArgs<TPayload> = {
	/** `true` when the underlying transport is ready to receive */
	isReady: boolean;
	/** Send the payload through the transport */
	send: (payload: TPayload) => void;
};

export type UseInitSnapshotBufferResult<TPayload> = {
	/**
	 * Update the buffered payload. Sends through `send` immediately
	 * if `isReady` is true; otherwise the payload is stashed for
	 * `replay()` to surface later.
	 */
	setBuffered: (payload: TPayload) => void;
	/**
	 * Send the most recently-buffered payload (if any) through
	 * `send`. Safe to call when the buffer is empty — it's a
	 * no-op. Called by the consumer's PREVIEW_READY handler so a
	 * just-ready iframe gets the latest payload.
	 */
	replay: () => void;
};

export function useInitSnapshotBuffer<TPayload>({
	isReady,
	send,
}: UseInitSnapshotBufferArgs<TPayload>): UseInitSnapshotBufferResult<TPayload> {
	const bufferedRef = React.useRef<TPayload | null>(null);

	// Mirror the latest `send` callback so `setBuffered` and
	// `replay` can stay stable (otherwise consumers that put these
	// in `useImperativeHandle` deps would rebuild the imperative
	// handle on every `send` identity change).
	const sendRef = React.useRef(send);
	React.useEffect(() => {
		sendRef.current = send;
	}, [send]);

	// `isReady` flips between renders, but we want `setBuffered`
	// to read the LATEST value at call time without having
	// `isReady` in its deps (otherwise consumers using it in a
	// memoised `useImperativeHandle` would rebuild on every flip).
	const isReadyRef = React.useRef(isReady);
	React.useEffect(() => {
		isReadyRef.current = isReady;
	}, [isReady]);

	const setBuffered = React.useCallback((payload: TPayload) => {
		bufferedRef.current = payload;
		if (isReadyRef.current) sendRef.current(payload);
	}, []);

	const replay = React.useCallback(() => {
		if (bufferedRef.current === null) return;
		sendRef.current(bufferedRef.current);
	}, []);

	return { setBuffered, replay };
}
