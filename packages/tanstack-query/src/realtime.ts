/**
 * Realtime utilities for TanStack Query integration
 *
 * Provides SSE to AsyncIterable conversion for use with streamedQuery.
 */

// ============================================================================
// Types
// ============================================================================

export type RealtimeEvent<TData = unknown> = {
	type: "snapshot" | "change" | "error";
	data?: TData;
	error?: string;
	seq?: number;
};

export type SSEOptions = {
	/** SSE endpoint URL */
	url: string;
	/** Include credentials (cookies) */
	withCredentials?: boolean;
	/** Event types to listen for */
	eventTypes?: string[];
	/** Abort signal for cleanup */
	signal?: AbortSignal;
};

// ============================================================================
// SSE to AsyncIterable
// ============================================================================

/**
 * Convert Server-Sent Events stream to AsyncIterable.
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
 *     queryFn: () => fetchPosts(),
 *     streamFn: () => sseToAsyncIterable({
 *       url: '/api/cms/realtime/posts',
 *     }),
 *   }),
 * })
 * ```
 */
export async function* sseToAsyncIterable<TData = unknown>(
	options: SSEOptions,
): AsyncGenerator<RealtimeEvent<TData>, void, unknown> {
	const {
		url,
		withCredentials = true,
		eventTypes = ["snapshot", "change", "message"],
		signal,
	} = options;

	// Queue for events waiting to be consumed
	const queue: RealtimeEvent<TData>[] = [];

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
		signal.addEventListener("abort", cleanup);
	}

	// Handle errors
	eventSource.onerror = () => {
		closeError = new Error("SSE connection error");
		cleanup();
	};

	// Parse and queue events
	const handleEvent = (event: MessageEvent) => {
		try {
			const parsed = JSON.parse(event.data) as RealtimeEvent<TData>;
			queue.push(parsed);
			resolveNext?.();
		} catch {
			// Ignore parse errors
		}
	};

	// Listen to specified event types
	for (const eventType of eventTypes) {
		eventSource.addEventListener(eventType, handleEvent);
	}

	// Also handle generic message events
	eventSource.onmessage = handleEvent;

	try {
		while (!closed) {
			// If queue has items, yield them
			while (queue.length > 0) {
				const event = queue.shift()!;

				// Check for error events
				if (event.type === "error") {
					throw new Error(event.error ?? "Unknown realtime error");
				}

				yield event;
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
// Realtime Query Helpers
// ============================================================================

export type RealtimeQueryConfig = {
	/** Base URL for realtime endpoints */
	baseUrl: string;
	/** Whether realtime is enabled */
	enabled?: boolean;
	/** Include credentials */
	withCredentials?: boolean;
};

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

// ============================================================================
// Stream Merger for Initial Data + Updates
// ============================================================================

/**
 * Create a streaming query function that combines initial fetch with SSE updates.
 *
 * The first yield is the initial data from queryFn.
 * Subsequent yields are updates from the SSE stream.
 *
 * @example
 * ```ts
 * const { data } = useQuery({
 *   queryKey: ['posts'],
 *   queryFn: streamedQuery({
 *     queryFn: async () => {
 *       const posts = await fetchPosts();
 *       return posts; // Initial data
 *     },
 *     streamFn: (context) => createRealtimeStream({
 *       initialData: context.data, // Data from queryFn
 *       realtimeUrl: '/api/cms/realtime/posts',
 *       onEvent: (event, currentData) => {
 *         // Merge event into current data
 *         return [...currentData, event.data];
 *       },
 *     }),
 *   }),
 * })
 * ```
 */
export async function* createRealtimeStream<TData>(config: {
	/** Initial data to start with */
	initialData: TData;
	/** SSE endpoint URL */
	realtimeUrl: string;
	/** Merge function: receives event and current data, returns new data */
	onEvent: (event: RealtimeEvent, currentData: TData) => TData;
	/** SSE options */
	sseOptions?: Partial<SSEOptions>;
	/** Abort signal */
	signal?: AbortSignal;
}): AsyncGenerator<TData, void, unknown> {
	const { initialData, realtimeUrl, onEvent, sseOptions, signal } = config;

	let currentData = initialData;

	// Yield initial data first
	yield currentData;

	// Then stream updates
	const stream = sseToAsyncIterable({
		url: realtimeUrl,
		signal,
		...sseOptions,
	});

	for await (const event of stream) {
		if (event.type === "snapshot" && event.data !== undefined) {
			// Full snapshot replaces data
			currentData = event.data as TData;
		} else if (event.type === "change") {
			// Incremental change - use merge function
			currentData = onEvent(event, currentData);
		}

		yield currentData;
	}
}
