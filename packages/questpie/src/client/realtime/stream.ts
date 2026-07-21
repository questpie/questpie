/**
 * Realtime stream utilities
 *
 * Provides AsyncGenerator-based streaming and topic builders
 * for the realtime SSE multiplexer.
 */

import type { GetAuthHeaders } from "../auth.js";
import { RealtimeMultiplexer, type TopicConfig } from "./multiplexer.js";
import {
	PusherRealtimeTransport,
	type PusherRealtimeConfig,
} from "./pusher.js";
import type { RealtimeClientTransport } from "./transport.js";

// ============================================================================
// Types
// ============================================================================

export type RealtimeStreamEvent<TData = unknown> =
	| {
			type: "snapshot";
			topicId: string;
			seq: number;
			data: TData;
			reset?: boolean;
			upToDate?: string;
	  }
	| {
			type: "insert" | "update";
			topicId: string;
			seq: number;
			txid?: string;
			key: string;
			row: unknown;
			index?: number;
	  }
	| {
			type: "delete";
			topicId: string;
			seq: number;
			txid?: string;
			key: string;
	  }
	| {
			type: "up-to-date";
			topicId: string;
			seq: number;
			txid?: string;
			upToDate?: string;
			meta?: { totalDocs?: number };
	  };

type RealtimeFindData<TRow> = {
	docs: TRow[];
	totalDocs?: number;
	[key: string]: unknown;
};

/** Convert full find snapshots into the same keyed event union as native deltas. */
export async function* deriveFindDeltas<
	TRow,
	TData extends RealtimeFindData<TRow>,
>(
	source: AsyncIterable<RealtimeStreamEvent<TData>>,
	keyOf: (row: TRow) => string = (row) => String((row as { id?: unknown }).id),
): AsyncGenerator<RealtimeStreamEvent<TData>, void, unknown> {
	let previous: TData | undefined;

	for await (const event of source) {
		if (event.type !== "snapshot") {
			yield event;
			continue;
		}
		if (!previous || event.reset) {
			previous = event.data;
			yield event;
			continue;
		}

		const previousByKey = new Map(
			previous.docs.map((row, index) => [
				keyOf(row),
				{ row, index, serialized: JSON.stringify(row) },
			]),
		);
		const nextKeys = new Set(event.data.docs.map(keyOf));
		for (const row of previous.docs) {
			const key = keyOf(row);
			if (!nextKeys.has(key)) {
				yield {
					type: "delete",
					topicId: event.topicId,
					seq: event.seq,
					key,
				};
			}
		}

		const materializedDocs: TRow[] = [];
		for (const [index, row] of event.data.docs.entries()) {
			const key = keyOf(row);
			const old = previousByKey.get(key);
			if (!old) {
				materializedDocs.push(row);
				yield {
					type: "insert",
					topicId: event.topicId,
					seq: event.seq,
					key,
					row,
					index,
				};
				continue;
			}
			const unchanged = old.serialized === JSON.stringify(row);
			materializedDocs.push(unchanged ? old.row : row);
			if (unchanged && old.index === index) continue;
			yield {
				type: "update",
				topicId: event.topicId,
				seq: event.seq,
				key,
				row: unchanged ? old.row : row,
				index,
			};
		}

		previous = { ...event.data, docs: materializedDocs };
		yield {
			type: "up-to-date",
			topicId: event.topicId,
			seq: event.seq,
			...(event.upToDate === undefined ? {} : { upToDate: event.upToDate }),
			meta: { totalDocs: event.data.totalDocs ?? event.data.docs.length },
		};
	}
}

type RealtimeFindEnvelope<TRow> = RealtimeFindData<TRow>;

/** Metadata for an unwindowed realtime find result. */
export function envelopeMeta<TRow>(
	docs: readonly TRow[],
	totalDocs = docs.length,
) {
	return {
		totalDocs,
		totalPages: 1,
		page: 1,
		hasNextPage: false,
		hasPrevPage: false,
		nextPage: null,
		prevPage: null,
	};
}

/** Apply one snapshot or keyed row event to an unwindowed find result. */
export function applyRealtimeFindEvent<
	TRow,
	TData extends RealtimeFindEnvelope<TRow>,
>(
	current: TData | undefined,
	event: RealtimeStreamEvent<TData>,
	keyOf: (row: TRow) => string = (row) => String((row as { id?: unknown }).id),
): TData {
	if (event.type === "snapshot") return event.data;
	if (!current) {
		throw new Error("Realtime find deltas require an initial snapshot");
	}

	if (event.type === "up-to-date") {
		return {
			...current,
			...envelopeMeta(
				current.docs,
				event.meta?.totalDocs ?? current.docs.length,
			),
		} as TData;
	}

	const index = current.docs.findIndex((row) => keyOf(row) === event.key);
	let docs: TRow[];
	if (event.type === "delete") {
		if (index < 0) return current;
		docs = [...current.docs.slice(0, index), ...current.docs.slice(index + 1)];
	} else {
		const row = event.row as TRow;
		if (index >= 0) {
			const targetIndex =
				event.index === undefined
					? index
					: Math.max(0, Math.min(event.index, current.docs.length - 1));
			docs = current.docs.slice();
			docs.splice(index, 1);
			docs.splice(targetIndex, 0, row);
		} else {
			const insertionIndex =
				event.index === undefined
					? current.docs.length
					: Math.max(0, Math.min(event.index, current.docs.length));
			docs = [
				...current.docs.slice(0, insertionIndex),
				row,
				...current.docs.slice(insertionIndex),
			];
		}
	}

	return { ...current, docs, ...envelopeMeta(docs) } as TData;
}

/** Apply snapshot/count metadata frames to a scalar realtime result. */
export function applyRealtimeScalarEvent<TData>(
	current: TData | undefined,
	event: RealtimeStreamEvent<TData>,
): TData | undefined {
	if (event.type === "snapshot") return event.data;
	if (event.type === "up-to-date" && event.meta?.totalDocs !== undefined) {
		return event.meta.totalDocs as TData;
	}
	return current;
}

/** Apply snapshot or keyed row frames to a single-row realtime result. */
export function applyRealtimeSingleEvent<TData>(
	current: TData | null | undefined,
	event: RealtimeStreamEvent<TData | null>,
): TData | null | undefined {
	if (event.type === "snapshot") return event.data;
	if (event.type === "delete") return null;
	if (event.type === "insert" || event.type === "update") {
		return event.row as TData;
	}
	return current;
}

function isFindTopic(topic: TopicConfig): boolean {
	return (
		topic.resourceType === "collection" &&
		(topic.operation ?? "find") === "find"
	);
}

function applyRealtimeTopicEvent<TData>(
	topic: TopicConfig,
	current: TData | null | undefined,
	event: RealtimeStreamEvent<TData>,
): TData | null | undefined {
	if (isFindTopic(topic)) {
		return applyRealtimeFindEvent(current as any, event as any) as TData;
	}
	if (topic.resourceType === "collection" && topic.operation === "count") {
		return applyRealtimeScalarEvent(current as TData | undefined, event);
	}
	return applyRealtimeSingleEvent(
		current,
		event as RealtimeStreamEvent<TData | null>,
	);
}

function emitsMaterializedValue(event: RealtimeStreamEvent): boolean {
	return event.type === "snapshot" || event.type === "up-to-date";
}

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

	/** Create an AsyncGenerator over the shared snapshot/delta wire union. */
	streamEvents: <TData>(
		topic: TopicConfig,
		signal?: AbortSignal,
		customId?: string,
	) => AsyncGenerator<RealtimeStreamEvent<TData>, void, unknown>;

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
export async function* sseEventStream<TData>(options: {
	multiplexer: RealtimeClientTransport;
	topic: TopicConfig;
	signal?: AbortSignal;
	customId?: string;
}): AsyncGenerator<RealtimeStreamEvent<TData>, void, unknown> {
	const { multiplexer, topic, signal, customId } = options;

	const queue: RealtimeStreamEvent<TData>[] = [];

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
		(event) => {
			if (!closed) {
				queue.push(event as RealtimeStreamEvent<TData>);
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

async function* materializeRealtimeStream<TData>(
	topic: TopicConfig,
	source: AsyncIterable<RealtimeStreamEvent<TData>>,
): AsyncGenerator<TData, void, unknown> {
	let current: TData | null | undefined;
	for await (const event of source) {
		current = applyRealtimeTopicEvent(topic, current, event);
		if (emitsMaterializedValue(event) && current !== undefined) {
			yield current as TData;
		}
	}
}

export function sseSnapshotStream<TData>(options: {
	multiplexer: RealtimeClientTransport;
	topic: TopicConfig;
	signal?: AbortSignal;
	customId?: string;
}): AsyncGenerator<TData, void, unknown> {
	const raw = sseEventStream<TData>(options);
	const events = isFindTopic(options.topic)
		? (deriveFindDeltas(raw as any) as AsyncGenerator<
				RealtimeStreamEvent<TData>,
				void,
				unknown
			>)
		: raw;
	return materializeRealtimeStream(options.topic, events);
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
	fetcher?: typeof fetch;
	refetchTopic?: (topic: TopicConfig) => Promise<unknown>;
}): RealtimeAPI {
	let transport: RealtimeClientTransport | null = null;
	let transportPromise: Promise<RealtimeClientTransport> | null = null;
	let generation = 0;
	const pending = new Set<object>();
	const fetcher = opts.fetcher ?? globalThis.fetch;

	const createSse = () =>
		new RealtimeMultiplexer(
			opts.baseUrl,
			opts.withCredentials,
			opts.debounceMs,
			{},
			opts.getAuthHeaders,
			fetcher,
		);

	const getOrCreate = async (): Promise<RealtimeClientTransport> => {
		if (transport) return transport;
		if (!transportPromise) {
			const selectedGeneration = generation;
			transportPromise = (async () => {
				try {
					const authHeaders = await opts.getAuthHeaders?.();
					const response = await fetcher(`${opts.baseUrl}/realtime/config`, {
						headers: authHeaders,
						credentials: opts.withCredentials ? "include" : "omit",
					});
					if (
						response.ok &&
						response.headers.get("content-type")?.includes("application/json")
					) {
						const selected = (await response.json()) as
							| { transport: "sse" }
							| { transport: "shared-provider"; config: PusherRealtimeConfig };
						if (
							selected.transport === "shared-provider" &&
							selected.config?.provider === "pusher" &&
							typeof selected.config.key === "string" &&
							opts.refetchTopic
						) {
							return new PusherRealtimeTransport({
								baseUrl: opts.baseUrl,
								fetcher,
								getAuthHeaders: opts.getAuthHeaders,
								config: selected.config,
								refetchTopic: opts.refetchTopic,
							});
						}
					}
				} catch {
					// Backward compatibility with servers predating realtime/config.
				}
				return createSse();
			})().then((selected) => {
				if (selectedGeneration !== generation) selected.destroy();
				else transport = selected;
				return selected;
			});
		}
		return transportPromise;
	};

	const subscribeEvents = (
		topic: TopicConfig,
		callback: (event: RealtimeStreamEvent) => void,
		signal?: AbortSignal,
		customId?: string,
		onError?: (error: Error) => void,
	) => {
		const subscriptionGeneration = generation;
		const marker = {};
		pending.add(marker);
		let stopped = false;
		let stopInner: (() => void) | undefined;
		void getOrCreate()
			.then((selected) => {
				pending.delete(marker);
				if (stopped || subscriptionGeneration !== generation) return;
				stopInner = selected.subscribe(
					topic,
					callback,
					signal,
					customId,
					onError,
				);
			})
			.catch((error) => {
				pending.delete(marker);
				onError?.(error instanceof Error ? error : new Error(String(error)));
			});
		return () => {
			stopped = true;
			pending.delete(marker);
			stopInner?.();
		};
	};

	const eventFacade: RealtimeClientTransport = {
		subscribe: subscribeEvents,
		destroy: () => {
			generation += 1;
			pending.clear();
			transport?.destroy();
			transport = null;
			transportPromise = null;
		},
		get topicCount() {
			return transport?.topicCount ?? pending.size;
		},
		get subscriberCount() {
			return transport?.subscriberCount ?? pending.size;
		},
	};

	const streamEvents = <TData>(
		topic: TopicConfig,
		signal?: AbortSignal,
		customId?: string,
	): AsyncGenerator<RealtimeStreamEvent<TData>, void, unknown> => {
		const raw = sseEventStream<TData>({
			multiplexer: eventFacade,
			topic,
			signal,
			customId,
		});
		return isFindTopic(topic)
			? (deriveFindDeltas(raw as any) as AsyncGenerator<
					RealtimeStreamEvent<TData>,
					void,
					unknown
				>)
			: raw;
	};

	return {
		subscribe<TData = unknown>(
			topic: TopicConfig,
			callback: (data: TData) => void,
			signal?: AbortSignal,
			customId?: string,
			onError?: (error: Error) => void,
		) {
			let current: TData | null | undefined;
			return subscribeEvents(
				topic,
				(event) => {
					current = applyRealtimeTopicEvent(
						topic,
						current,
						event as RealtimeStreamEvent<TData>,
					);
					if (emitsMaterializedValue(event) && current !== undefined) {
						callback(current as TData);
					}
				},
				signal,
				customId,
				onError,
			);
		},
		stream<TData>(topic: TopicConfig, signal?: AbortSignal, customId?: string) {
			return materializeRealtimeStream(
				topic,
				streamEvents<TData>(topic, signal, customId),
			);
		},
		streamEvents,
		destroy: eventFacade.destroy,
		get topicCount() {
			return transport?.topicCount ?? pending.size;
		},
		get subscriberCount() {
			return transport?.subscriberCount ?? pending.size;
		},
	};
}
