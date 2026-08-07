/**
 * Realtime stream utilities
 *
 * Provides AsyncGenerator-based streaming and topic builders
 * for the realtime SSE multiplexer.
 */

import type { GetAuthHeaders } from "../auth.js";
import type { TopicConfig } from "./multiplexer.js";
import type { PusherConnectionManager } from "./pusher-connection.js";
import {
	createRealtimeClientSession,
	type RealtimeClientSession,
} from "./session.js";
import type { SseConnectionManager } from "./sse-connection.js";
import type { RealtimeClientTransport } from "./transport.js";
import { RealtimeTxidTracker } from "./txid.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Why a keyed row left a topic's result. A store renders the two differently:
 * a `deleted` row is gone, a row that only `left_predicate` still exists and
 * may come back, or may already be held by another topic.
 *
 * - `deleted` — the row itself is gone: a hard delete, a soft delete, or a purge.
 * - `left_predicate` — the row survives but no longer satisfies the topic's
 *   `where` or the subscriber's access filter.
 */
export type RealtimeDeltaDeleteReason = "deleted" | "left_predicate";

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
			/**
			 * Native delta frames always carry this. It is absent only when the
			 * frame was diffed out of two snapshots ({@link deriveFindDeltas}),
			 * which sees a row disappear and cannot tell the two apart.
			 */
			reason?: RealtimeDeltaDeleteReason;
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

/**
 * The page window a find topic subscribed with.
 *
 * `limit` and `offset` are part of the topic, so the window is fixed for the
 * subscription's lifetime and only the bootstrap frame can report it.
 */
export type RealtimeFindWindow = { limit?: number; page?: number };

/** Read the window a previous frame established, ignoring absent fields. */
function findWindow(
	envelope: RealtimeFindEnvelope<unknown>,
): RealtimeFindWindow {
	const { limit, page } = envelope;
	return {
		limit: typeof limit === "number" ? limit : undefined,
		page: typeof page === "number" ? page : undefined,
	};
}

/**
 * Rebuild find envelope metadata for a window.
 *
 * This mirrors the server paginator in `crud-generator.ts` field for field, so
 * a live envelope and a re-fetched one agree. Only `totalDocs` moves between
 * frames; `limit` and `page` are carried from the bootstrap frame because a
 * later frame cannot know them.
 *
 * `limit` is widened to the row count when it would otherwise claim a page
 * smaller than the rows on it: an unwindowed find reports `limit === totalDocs`,
 * and that sentinel has to grow with the result.
 */
export function envelopeMeta<TRow>(
	docs: readonly TRow[],
	totalDocs = docs.length,
	window?: RealtimeFindWindow,
) {
	const limit = Math.max(window?.limit ?? docs.length, docs.length);
	const page = window?.page ?? 1;
	const totalPages = limit > 0 ? Math.ceil(totalDocs / limit) : 1;
	const hasPrevPage = page > 1;
	const hasNextPage = page < totalPages;
	return {
		totalDocs,
		limit,
		totalPages,
		page,
		pagingCounter: (page - 1) * limit + 1,
		hasPrevPage,
		hasNextPage,
		prevPage: hasPrevPage ? page - 1 : null,
		nextPage: hasNextPage ? page + 1 : null,
	};
}

/** Apply one snapshot or keyed row event to a find result, windowed or not. */
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

	const window = findWindow(current);

	if (event.type === "up-to-date") {
		// A heartbeat carries no meta. Falling back to the row count would shrink
		// a windowed list's total to one page's worth of rows.
		return {
			...current,
			...envelopeMeta(
				current.docs,
				event.meta?.totalDocs ?? current.totalDocs ?? current.docs.length,
				window,
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

	// A keyed event moves rows, not the window. It shifts the total by however
	// many rows it actually added or removed; the `up-to-date` frame that closes
	// the batch then replaces that estimate with the server's own count.
	const totalDocs =
		(current.totalDocs ?? current.docs.length) +
		docs.length -
		current.docs.length;
	return {
		...current,
		docs,
		...envelopeMeta(docs, totalDocs, window),
	} as TData;
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

	/** Resolve when an exact delta txid or a strictly newer visibility watermark arrives. */
	awaitTxId: (txid: string, signal?: AbortSignal) => Promise<void>;
	/** Extract a mutation result's txid and await its realtime reconciliation. */
	awaitMutation: (result: unknown, signal?: AbortSignal) => Promise<void>;

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

	const maximumQueuedEvents = 512;
	const maximumQueuedBytes = 1024 * 1024;
	const encoder = new TextEncoder();
	const queue: Array<{
		event: RealtimeStreamEvent<TData>;
		bytes: number;
	}> = [];
	let queueHead = 0;
	let queuedBytes = 0;

	// Promise resolver/rejecter for when new data arrives or connection fails
	let resolveNext: (() => void) | null = null;
	let rejectNext: ((error: Error) => void) | null = null;
	let pendingError: Error | null = null;

	// Track if the stream is closed
	let closed = false;
	let rawUnsubscribe: (() => void) | undefined;
	let unsubscribeRequested = false;
	const unsubscribe = () => {
		if (unsubscribeRequested) return;
		unsubscribeRequested = true;
		rawUnsubscribe?.();
	};

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
	rawUnsubscribe = multiplexer.subscribe(
		topic,
		(event) => {
			if (closed) return;
			const typedEvent = event as RealtimeStreamEvent<TData>;
			const bytes = encoder.encode(JSON.stringify(typedEvent)).byteLength;
			if (
				queue.length - queueHead >= maximumQueuedEvents ||
				queuedBytes + bytes > maximumQueuedBytes
			) {
				pendingError = new Error(
					`Realtime client event buffer exceeds ${maximumQueuedEvents} events or ${maximumQueuedBytes} bytes`,
				);
				closed = true;
				unsubscribe();
				rejectNext?.(pendingError);
				return;
			}
			queue.push({ event: typedEvent, bytes });
			queuedBytes += bytes;
			resolveNext?.();
		},
		signal,
		customId,
		onError,
	);
	if (unsubscribeRequested) rawUnsubscribe();
	signal?.addEventListener("abort", handleAbort, { once: true });

	try {
		for (;;) {
			if (signal?.aborted) break;
			if (pendingError) throw pendingError;
			// Yield all queued items
			while (queueHead < queue.length) {
				if (pendingError) throw pendingError;
				const queued = queue[queueHead++]!;
				queuedBytes -= queued.bytes;
				yield queued.event;
			}
			queue.length = 0;
			queueHead = 0;
			if (closed) break;

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
	pusherConnection?: PusherConnectionManager;
	sseConnection?: SseConnectionManager;
	/** @internal Shared owner used by createClient; not a public extension lane. */
	realtimeSession?: RealtimeClientSession;
}): RealtimeAPI {
	const txids = new RealtimeTxidTracker();
	const ownsSession = opts.realtimeSession === undefined;
	const realtimeSession =
		opts.realtimeSession ??
		createRealtimeClientSession({
			baseUrl: opts.baseUrl,
			withCredentials: opts.withCredentials,
			debounceMs: opts.debounceMs,
			getAuthHeaders: opts.getAuthHeaders,
			fetcher: opts.fetcher,
			refetchTopic: opts.refetchTopic,
			pusherConnection: opts.pusherConnection,
			sseConnection: opts.sseConnection,
		});
	const subscriptions = new Set<() => void>();

	const subscribeEvents = (
		topic: TopicConfig,
		callback: (event: RealtimeStreamEvent) => void,
		signal?: AbortSignal,
		customId?: string,
		onError?: (error: Error) => void,
	) => {
		const txidTopic = txids.registerTopic();
		let stopped = false;
		const stopInner = realtimeSession.subscribe(
			topic,
			(event) => {
				txids.observe(event, txidTopic);
				callback(event);
			},
			signal,
			customId,
			onError,
		);
		const stop = () => {
			if (stopped) return;
			stopped = true;
			subscriptions.delete(stop);
			txids.unregisterTopic(txidTopic);
			stopInner();
		};
		subscriptions.add(stop);
		return stop;
	};

	const eventFacade: RealtimeClientTransport = {
		subscribe: subscribeEvents,
		destroy: () => {
			for (const stop of subscriptions) stop();
			if (ownsSession) realtimeSession.destroy();
			txids.clear();
		},
		get topicCount() {
			return realtimeSession.topicCount;
		},
		get subscriberCount() {
			return realtimeSession.subscriberCount;
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
		awaitTxId: (txid, signal) => txids.awaitTxId(txid, signal),
		awaitMutation: (result, signal) => txids.awaitMutation(result, signal),
		destroy: eventFacade.destroy,
		get topicCount() {
			return realtimeSession.topicCount;
		},
		get subscriberCount() {
			return realtimeSession.subscriberCount;
		},
	};
}
