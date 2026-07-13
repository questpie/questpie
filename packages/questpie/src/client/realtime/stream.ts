/**
 * Realtime stream utilities
 *
 * Provides AsyncGenerator-based streaming and topic builders
 * for the realtime SSE multiplexer.
 */

import type { GetAuthHeaders } from "../auth.js";
import { RealtimeMultiplexer, type TopicConfig } from "./multiplexer.js";

// ============================================================================
// Types
// ============================================================================

export type RealtimeAPI = {
	/**
	 * Subscribe to a topic. Returns unsubscribe function.
	 *
	 * `TData` is the snapshot type pushed for the topic — prefer the typed
	 * `collections.<name>.live()` / `globals.<name>.live()` wrappers, which
	 * infer it from the query options.
	 */
	subscribe: <TData = unknown>(
		topic: TopicConfig,
		callback: (data: TData) => void,
		signal?: AbortSignal,
		customId?: string,
		onError?: (error: Error) => void,
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
	let pendingError: Error | null = null;

	// Track if the stream is closed
	let closed = false;

	// Error callback - rejects the waiting promise so the generator throws
	// instead of waiting forever (prevents infinite loading on server errors)
	const onError = (error: Error) => {
		pendingError = error;
		rejectNext?.(error);
	};
	const handleAbort = () => {
		closed = true;
		resolveNext?.();
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
	signal?.addEventListener("abort", handleAbort, { once: true });

	try {
		while (!closed && !signal?.aborted) {
			if (pendingError) throw pendingError;
			// Yield all queued items
			while (queue.length > 0) {
				yield queue.shift()!;
			}

			// Wait for more data or connection error
			if (!closed && !signal?.aborted) {
				await new Promise<void>((resolve, reject) => {
					resolveNext = resolve;
					rejectNext = reject;
				});
				resolveNext = null;
				rejectNext = null;
			}
		}
	} finally {
		closed = true;
		signal?.removeEventListener("abort", handleAbort);
		unsubscribe();
	}
}

// ============================================================================
// Topic Builders
// ============================================================================

/**
 * Build a topic config for a collection query.
 */
type CollectionFindTopicOptions = {
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
	locale?: string;
};

type CollectionCountTopicOptions = Pick<
	CollectionFindTopicOptions,
	"where" | "locale"
>;

type CollectionGetTopicOptions = Pick<
	CollectionFindTopicOptions,
	"with" | "locale"
> & { id: string };

export function buildCollectionTopic(
	collectionName: string,
	options?: CollectionFindTopicOptions,
	operation?: "find",
): Extract<TopicConfig, { resourceType: "collection"; operation?: "find" }>;
export function buildCollectionTopic(
	collectionName: string,
	options: CollectionCountTopicOptions | undefined,
	operation: "count",
): Extract<TopicConfig, { resourceType: "collection"; operation: "count" }>;
export function buildCollectionTopic(
	collectionName: string,
	options: CollectionGetTopicOptions,
	operation: "get",
): Extract<TopicConfig, { resourceType: "collection"; operation: "get" }>;
export function buildCollectionTopic(
	collectionName: string,
	options?:
		| CollectionFindTopicOptions
		| CollectionCountTopicOptions
		| CollectionGetTopicOptions,
	operation: "find" | "count" | "get" = "find",
): TopicConfig {
	if (operation === "get") {
		const getOptions = options as CollectionGetTopicOptions;
		return {
			resourceType: "collection",
			resource: collectionName,
			operation: "get",
			id: getOptions.id,
			...(getOptions.with && { with: getOptions.with }),
			...(getOptions.locale && { locale: getOptions.locale }),
		};
	}
	if (operation === "count") {
		const countOptions = options as CollectionCountTopicOptions | undefined;
		return {
			resourceType: "collection",
			resource: collectionName,
			operation: "count",
			...(countOptions?.where && { where: countOptions.where }),
			...(countOptions?.locale && { locale: countOptions.locale }),
		};
	}
	const findOptions = options as CollectionFindTopicOptions | undefined;
	return {
		resourceType: "collection",
		resource: collectionName,
		operation: "find",
		...(findOptions?.where && { where: findOptions.where }),
		...(findOptions?.with && { with: findOptions.with }),
		...(findOptions?.limit !== undefined && { limit: findOptions.limit }),
		...(findOptions?.offset !== undefined && { offset: findOptions.offset }),
		...(findOptions?.orderBy && { orderBy: findOptions.orderBy }),
		...(findOptions?.locale && { locale: findOptions.locale }),
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
		operation: "get",
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
	getAuthHeaders?: GetAuthHeaders;
}): RealtimeAPI {
	let multiplexer: RealtimeMultiplexer | null = null;

	const getOrCreate = () => {
		if (!multiplexer) {
			multiplexer = new RealtimeMultiplexer(
				opts.baseUrl,
				opts.withCredentials,
				opts.debounceMs,
				{},
				opts.getAuthHeaders,
			);
		}
		return multiplexer;
	};

	return {
		subscribe<TData = unknown>(
			topic: TopicConfig,
			callback: (data: TData) => void,
			signal?: AbortSignal,
			customId?: string,
			onError?: (error: Error) => void,
		) {
			return getOrCreate().subscribe(
				topic,
				callback as (data: unknown) => void,
				signal,
				customId,
				onError,
			);
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
