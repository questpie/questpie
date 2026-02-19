/**
 * Realtime stream utilities
 *
 * Provides AsyncGenerator-based streaming and topic builders
 * for the realtime SSE multiplexer.
 */

import { RealtimeMultiplexer, type TopicConfig } from "./multiplexer.js";

// ============================================================================
// Types
// ============================================================================

export type RealtimeAPI = {
	/** Subscribe to a topic. Returns unsubscribe function. */
	subscribe: (
		topic: TopicConfig,
		callback: (data: unknown) => void,
		signal?: AbortSignal,
		customId?: string,
	) => () => void;

	/** Create an AsyncGenerator stream for a topic */
	stream: <TData>(
		topic: TopicConfig,
		signal?: AbortSignal,
		customId?: string,
	) => AsyncGenerator<TData, void, unknown>;

	/** Destroy the multiplexer and clean up all resources */
	destroy: () => void;

	/** Current topic count */
	readonly topicCount: number;
	/** Current subscriber count */
	readonly subscriberCount: number;
};

// ============================================================================
// SSE Snapshot Stream
// ============================================================================

/**
 * Create an AsyncGenerator that yields snapshot data via the SSE multiplexer.
 *
 * @example
 * ```ts
 * const stream = sseSnapshotStream<MyData>({
 *   multiplexer,
 *   topic: { resourceType: 'collection', resource: 'posts' },
 *   signal: abortController.signal,
 * });
 *
 * for await (const snapshot of stream) {
 *   console.log(snapshot);
 * }
 * ```
 */
export async function* sseSnapshotStream<TData>(options: {
	multiplexer: RealtimeMultiplexer;
	topic: TopicConfig;
	signal?: AbortSignal;
	customId?: string;
}): AsyncGenerator<TData, void, unknown> {
	const { multiplexer, topic, signal, customId } = options;

	// Queue for data waiting to be consumed
	const queue: TData[] = [];

	// Promise resolver/rejecter for when new data arrives or connection fails
	let resolveNext: (() => void) | null = null;
	let rejectNext: ((error: Error) => void) | null = null;

	// Track if the stream is closed
	let closed = false;

	// Error callback - rejects the waiting promise so the generator throws
	// instead of waiting forever (prevents infinite loading on server errors)
	const onError = (error: Error) => {
		rejectNext?.(error);
	};

	// Subscribe to the topic via multiplexer
	const unsubscribe = multiplexer.subscribe(
		topic,
		(data) => {
			if (!closed) {
				queue.push(data as TData);
				resolveNext?.();
			}
		},
		signal,
		customId,
		onError,
	);

	try {
		while (!closed && !signal?.aborted) {
			// Yield all queued items
			while (queue.length > 0) {
				yield queue.shift()!;
			}

			// Wait for more data or connection error
			if (!closed && !signal?.aborted) {
				await new Promise<void>((resolve, reject) => {
					resolveNext = resolve;
					rejectNext = reject;
					signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				resolveNext = null;
				rejectNext = null;
			}
		}
	} finally {
		closed = true;
		unsubscribe();
	}
}

// ============================================================================
// Topic Builders
// ============================================================================

/**
 * Build a topic config for a collection query.
 */
export function buildCollectionTopic(
	collectionName: string,
	options?: {
		where?: Record<string, unknown>;
		with?: Record<string, unknown>;
		limit?: number;
		offset?: number;
		orderBy?: Record<string, "asc" | "desc">;
		locale?: string;
	},
): TopicConfig {
	return {
		resourceType: "collection",
		resource: collectionName,
		...(options?.where && { where: options.where }),
		...(options?.with && { with: options.with }),
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
		...(options?.orderBy && { orderBy: options.orderBy }),
		...(options?.locale && { locale: options.locale }),
	};
}

/**
 * Build a topic config for a global query.
 */
export function buildGlobalTopic(
	globalName: string,
	options?: {
		where?: Record<string, unknown>;
		with?: Record<string, unknown>;
		locale?: string;
	},
): TopicConfig {
	return {
		resourceType: "global",
		resource: globalName,
		...(options?.where && { where: options.where }),
		...(options?.with && { with: options.with }),
		...(options?.locale && { locale: options.locale }),
	};
}

// ============================================================================
// Realtime API Factory
// ============================================================================

/**
 * Create a RealtimeAPI instance with a lazily-initialized multiplexer.
 */
export function createRealtimeAPI(opts: {
	baseUrl: string;
	withCredentials: boolean;
	debounceMs: number;
}): RealtimeAPI {
	let multiplexer: RealtimeMultiplexer | null = null;

	const getOrCreate = () => {
		if (!multiplexer) {
			multiplexer = new RealtimeMultiplexer(
				opts.baseUrl,
				opts.withCredentials,
				opts.debounceMs,
			);
		}
		return multiplexer;
	};

	return {
		subscribe(topic, callback, signal?, customId?) {
			return getOrCreate().subscribe(topic, callback, signal, customId);
		},
		stream<TData>(topic: TopicConfig, signal?: AbortSignal, customId?: string) {
			return sseSnapshotStream<TData>({
				multiplexer: getOrCreate(),
				topic,
				signal,
				customId,
			});
		},
		destroy() {
			multiplexer?.destroy();
			multiplexer = null;
		},
		get topicCount() {
			return multiplexer?.topicCount ?? 0;
		},
		get subscriberCount() {
			return multiplexer?.subscriberCount ?? 0;
		},
	};
}
