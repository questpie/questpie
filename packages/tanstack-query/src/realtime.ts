/**
 * Realtime utilities for TanStack Query integration
 *
 * Provides SSE streaming for use with experimental_streamedQuery.
 */

// ============================================================================
// Types
// ============================================================================

export type SSESnapshotOptions = {
	/** SSE endpoint URL */
	url: string;
	/** Include credentials (cookies) - defaults to true */
	withCredentials?: boolean;
	/** Abort signal for cleanup */
	signal?: AbortSignal;
};

export type RealtimeQueryConfig = {
	/** Base URL for realtime endpoints */
	baseUrl: string;
	/** Whether realtime is enabled */
	enabled?: boolean;
	/** Include credentials */
	withCredentials?: boolean;
};

// ============================================================================
// SSE Snapshot Stream
// ============================================================================

/**
 * Create an AsyncGenerator that yields snapshot data from SSE.
 *
 * The server sends `snapshot` events with format: `{ seq: number, data: TData }`
 * This function extracts and yields the `data` field directly.
 *
 * Use with TanStack Query's experimental `streamedQuery`:
 *
 * @example
 * ```ts
 * import { experimental_streamedQuery as streamedQuery } from '@tanstack/react-query'
 *
 * const { data } = useQuery({
 *   queryKey: ['posts'],
 *   queryFn: streamedQuery({
 *     streamFn: ({ signal }) => sseSnapshotStream({
 *       url: '/api/cms/realtime/posts',
 *       signal,
 *     }),
 *     reducer: (_, chunk) => chunk, // Replace with latest snapshot
 *     initialValue: undefined,
 *   }),
 * })
 * ```
 */
export async function* sseSnapshotStream<TData>(
	options: SSESnapshotOptions,
): AsyncGenerator<TData, void, unknown> {
	const { url, withCredentials = true, signal } = options;

	// Queue for events waiting to be consumed
	const queue: TData[] = [];

	// Promise resolver for when new events arrive
	let resolveNext: (() => void) | null = null;

	// Track if the stream is closed
	let closed = false;
	let closeError: Error | null = null;

	// Create EventSource
	const eventSource = new EventSource(url, { withCredentials });

	// Cleanup function
	const cleanup = () => {
		closed = true;
		eventSource.close();
		resolveNext?.();
	};

	// Handle abort signal
	if (signal) {
		if (signal.aborted) {
			cleanup();
			return;
		}
		signal.addEventListener("abort", cleanup);
	}

	// Handle connection errors
	eventSource.onerror = () => {
		closeError = new Error("SSE connection error");
		cleanup();
	};

	// Handle snapshot events
	const onSnapshot = (event: MessageEvent) => {
		try {
			const parsed = JSON.parse(event.data) as { seq?: number; data?: TData };
			if (parsed.data !== undefined) {
				queue.push(parsed.data);
				resolveNext?.();
			}
		} catch {
			// Ignore parse errors
		}
	};

	eventSource.addEventListener("snapshot", onSnapshot);

	try {
		while (!closed) {
			// If queue has items, yield them
			while (queue.length > 0) {
				yield queue.shift()!;
			}

			// Wait for more events
			if (!closed) {
				await new Promise<void>((resolve) => {
					resolveNext = resolve;
				});
				resolveNext = null;
			}
		}

		// If closed with error, throw
		if (closeError) {
			throw closeError;
		}
	} finally {
		cleanup();
		if (signal) {
			signal.removeEventListener("abort", cleanup);
		}
	}
}

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Build realtime URL for a collection
 */
export function buildCollectionRealtimeUrl(
	config: RealtimeQueryConfig,
	collectionName: string,
	options?: Record<string, unknown>,
): string {
	const base = `${config.baseUrl}/realtime/${encodeURIComponent(collectionName)}`;
	if (!options) return base;

	const params = new URLSearchParams();
	appendQueryParams(params, options);
	const query = params.toString();
	return query ? `${base}?${query}` : base;
}

/**
 * Build realtime URL for a global
 */
export function buildGlobalRealtimeUrl(
	config: RealtimeQueryConfig,
	globalName: string,
	options?: Record<string, unknown>,
): string {
	const base = `${config.baseUrl}/realtime/globals/${encodeURIComponent(globalName)}`;
	if (!options) return base;

	const params = new URLSearchParams();
	appendQueryParams(params, options);
	const query = params.toString();
	return query ? `${base}?${query}` : base;
}

function appendQueryParams(
	params: URLSearchParams,
	obj: Record<string, unknown>,
	prefix = "",
): void {
	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}[${key}]` : key;

		if (value === undefined || value === null) continue;

		if (Array.isArray(value)) {
			for (const item of value) {
				params.append(`${fullKey}[]`, String(item));
			}
		} else if (typeof value === "object") {
			appendQueryParams(params, value as Record<string, unknown>, fullKey);
		} else {
			params.append(fullKey, String(value));
		}
	}
}
