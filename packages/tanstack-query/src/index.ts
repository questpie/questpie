import {
	type DefaultError,
	mutationOptions,
	type QueryKey,
	queryOptions,
	experimental_streamedQuery as streamedQuery,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query";
import type {
	AnyChannelDefinition,
	ChannelParamsOf,
	ChannelPresenceOf,
} from "questpie/channels";
import type {
	ApplyQuery,
	CollectionRelations,
	CollectionSelect,
	FindManyOptions,
	FindOneOptionsBase,
	FindResult,
	GetCollection,
	GetGlobal,
	GlobalRelations,
	GlobalSelect,
	QuestpieApp,
	QuestpieClient,
	RealtimeAPI,
	RealtimeStreamEvent,
	ResolveRelationsDeep,
	TopicConfig,
	With,
} from "questpie/client";

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type { QueryKey, DefaultError, UseQueryOptions, UseMutationOptions };

// ============================================================================
// Re-export realtime utilities from core client
// ============================================================================

export {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	buildCollectionTopic,
	buildGlobalTopic,
	type RealtimeAPI,
	type TopicConfig,
} from "questpie/client";

import {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	buildCollectionTopic,
	buildGlobalTopic,
} from "questpie/client";

// ============================================================================
// Core Types
// ============================================================================

export type QuestpieQueryErrorMap = (error: unknown) => unknown;

export type QuestpieQueryOptionsConfig = {
	keyPrefix?: QueryKey;
	errorMap?: QuestpieQueryErrorMap;
	locale?: string;
	stage?: string;
};

// ============================================================================
// Type Helpers - derived from QuestpieClient
// ============================================================================

type AnyAsyncFn = (...args: any[]) => Promise<any>;
type QueryData<TFn extends AnyAsyncFn> = Awaited<ReturnType<TFn>>;
type FirstArg<TFn extends AnyAsyncFn> =
	Parameters<TFn> extends [infer TFirst, ...any[]]
		? TFirst
		: // Optional first parameter — `[options?: X]` does not match the
			// required-element pattern above, so match it as optional.
			Parameters<TFn> extends [(infer TFirst)?, ...any[]]
			? TFirst | undefined
			: never;
type HasArgs<TFn extends AnyAsyncFn> =
	Parameters<TFn> extends [] ? false : true;

type QueryBuilder<TFn extends AnyAsyncFn> =
	HasArgs<TFn> extends false
		? () => UseQueryOptions<QueryData<TFn>>
		: undefined extends FirstArg<TFn>
			? (options?: FirstArg<TFn>) => UseQueryOptions<QueryData<TFn>>
			: (options: FirstArg<TFn>) => UseQueryOptions<QueryData<TFn>>;

/**
 * Per-query realtime flag — the second argument to `find` / `count` / `get`.
 */
export type RealtimeQueryConfig<TData = unknown> = Omit<
	UseQueryOptions<TData>,
	"queryFn" | "queryKey"
> & {
	/**
	 * Subscribe the query to the multiplexed realtime stream. The initial value
	 * and later keyed changes share one stream, so realtime mode performs no
	 * separate REST fetch.
	 */
	realtime?: boolean;
};

/**
 * Builder for reads that also have a live form — same as `QueryBuilder`
 * plus the optional `{ realtime }` second argument.
 */
type LiveQueryBuilder<TFn extends AnyAsyncFn> =
	undefined extends FirstArg<TFn>
		? (
				options?: FirstArg<TFn>,
				queryConfig?: RealtimeQueryConfig<QueryData<TFn>>,
			) => UseQueryOptions<QueryData<TFn>>
		: (
				options: FirstArg<TFn>,
				queryConfig?: RealtimeQueryConfig<QueryData<TFn>>,
			) => UseQueryOptions<QueryData<TFn>>;

type KeyBuilder<TFn extends AnyAsyncFn> =
	HasArgs<TFn> extends false
		? () => QueryKey
		: undefined extends FirstArg<TFn>
			? (options?: FirstArg<TFn>) => QueryKey
			: (options: FirstArg<TFn>) => QueryKey;

type MutationVariables<TFn extends AnyAsyncFn> =
	HasArgs<TFn> extends false
		? void
		: undefined extends FirstArg<TFn>
			? FirstArg<TFn> | void
			: FirstArg<TFn>;

type MutationBuilder<TVariables, TData> = () => UseMutationOptions<
	TData,
	DefaultError,
	TVariables
>;

/** Extract collection keys from QuestpieClient */
type CollectionKeys<TApp extends QuestpieApp> = Extract<
	keyof QuestpieClient<TApp>["collections"],
	string
>;

/** Extract global keys from QuestpieClient */
type GlobalKeys<TApp extends QuestpieApp> = Extract<
	keyof QuestpieClient<TApp>["globals"],
	string
>;

/** Extract generated channel registry keys without client control properties. */
type ChannelKeys<TApp extends QuestpieApp> = Extract<
	keyof NonNullable<TApp["channels"]>,
	string
>;

type ChannelIter<
	TApp extends QuestpieApp,
	K extends ChannelKeys<TApp>,
> = QuestpieClient<TApp>["channels"][K] extends { iter: infer TIter }
	? TIter extends (
			...args: infer _TArgs
		) => AsyncGenerator<unknown, void, unknown>
		? TIter
		: never
	: never;

type ChannelIterMessage<TIter> = TIter extends (
	...args: infer _TArgs
) => AsyncGenerator<infer TMessage, void, unknown>
	? TMessage
	: never;

type ChannelDefinition<
	TApp extends QuestpieApp,
	K extends ChannelKeys<TApp>,
> = NonNullable<TApp["channels"]>[K] extends AnyChannelDefinition
	? NonNullable<TApp["channels"]>[K]
	: never;

type ChannelPresenceOptionsAPI<
	TApp extends QuestpieApp,
	K extends ChannelKeys<TApp>,
> = [ChannelPresenceOf<ChannelDefinition<TApp, K>>] extends [never]
	? {}
	: keyof ChannelParamsOf<ChannelDefinition<TApp, K>> extends never
		? {
				presence: () => UseQueryOptions<
					readonly ChannelPresenceOf<ChannelDefinition<TApp, K>>[]
				>;
			}
		: {
				presence: (
					params: ChannelParamsOf<ChannelDefinition<TApp, K>>,
				) => UseQueryOptions<
					readonly ChannelPresenceOf<ChannelDefinition<TApp, K>>[]
				>;
			};

type ChannelSubscriptionOptionsAPI<
	TApp extends QuestpieApp,
	K extends ChannelKeys<TApp>,
> = (keyof ChannelParamsOf<ChannelDefinition<TApp, K>> extends never
	? {
			subscription: () => UseQueryOptions<
				readonly ChannelIterMessage<ChannelIter<TApp, K>>[]
			>;
		}
	: {
			subscription: (
				params: ChannelParamsOf<ChannelDefinition<TApp, K>>,
			) => UseQueryOptions<readonly ChannelIterMessage<ChannelIter<TApp, K>>[]>;
		}) &
	ChannelPresenceOptionsAPI<TApp, K>;

// Per-collection select/relations — the same derivation the client's own
// method signatures use, so per-call generics below produce results identical
// to direct `client.collections.<k>.find(...)` calls.
type CollectionSelectOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = CollectionSelect<GetCollection<TApp["collections"], K>>;
type CollectionRelationsOf<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = ResolveRelationsDeep<
	CollectionRelations<GetCollection<TApp["collections"], K>>,
	TApp["collections"]
>;
type GlobalSelectOf<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = GlobalSelect<GetGlobal<NonNullable<TApp["globals"]>, K>>;
type GlobalRelationsOf<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = ResolveRelationsDeep<
	GlobalRelations<GetGlobal<NonNullable<TApp["globals"]>, K>>,
	TApp["collections"]
>;

// Collection method type extractors
type CollectionCount<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["count"];
type CollectionCreate<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["create"];
type CollectionUpdate<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["update"];
type CollectionDelete<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["delete"];
type CollectionRestore<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["restore"];
type CollectionFindVersions<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["findVersions"];
type CollectionRevertToVersion<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["revertToVersion"];
type CollectionTransitionStage<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = QuestpieClient<TApp>["collections"][K]["transitionStage"];

// Global method type extractors
type GlobalUpdate<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = QuestpieClient<TApp>["globals"][K] extends { update: infer TUpdate }
	? TUpdate extends AnyAsyncFn
		? TUpdate
		: never
	: never;
type GlobalFindVersions<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = QuestpieClient<TApp>["globals"][K] extends {
	findVersions: infer TFindVersions;
}
	? TFindVersions extends AnyAsyncFn
		? TFindVersions
		: never
	: never;
type GlobalRevertToVersion<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = QuestpieClient<TApp>["globals"][K] extends {
	revertToVersion: infer TRevert;
}
	? TRevert extends AnyAsyncFn
		? TRevert
		: never
	: never;
type GlobalTransitionStage<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = QuestpieClient<TApp>["globals"][K] extends {
	transitionStage: infer TTransition;
}
	? TTransition extends AnyAsyncFn
		? TTransition
		: never
	: never;

type RouteLeafQueryOptionsAPI<TFn extends AnyAsyncFn> = {
	query: QueryBuilder<TFn>;
	mutation: MutationBuilder<MutationVariables<TFn>, QueryData<TFn>>;
	key: KeyBuilder<TFn>;
};

type RoutesQueryOptionsAPI<TNode> = TNode extends AnyAsyncFn
	? RouteLeafQueryOptionsAPI<TNode>
	: TNode extends Record<string, any>
		? {
				[K in keyof TNode]: RoutesQueryOptionsAPI<TNode[K]>;
			}
		: never;

// ============================================================================
// API Types
// ============================================================================

type CollectionQueryOptionsAPI<
	TApp extends QuestpieApp,
	K extends CollectionKeys<TApp>,
> = {
	/**
	 * Generic per call — `TQuery` narrows the result exactly like the direct
	 * client's `find()` (a `ReturnType`-based extraction would instantiate the
	 * client generic at its constraint and collapse docs to `{}`).
	 */
	find: <
		TQuery extends
			| FindManyOptions<
					CollectionSelectOf<TApp, K>,
					CollectionRelationsOf<TApp, K>
			  >
			| undefined = undefined,
	>(
		options?: TQuery,
		queryConfig?: RealtimeQueryConfig<
			FindResult<
				CollectionSelectOf<TApp, K>,
				CollectionRelationsOf<TApp, K>,
				TQuery
			>
		>,
	) => UseQueryOptions<
		FindResult<
			CollectionSelectOf<TApp, K>,
			CollectionRelationsOf<TApp, K>,
			TQuery
		>
	>;
	count: LiveQueryBuilder<CollectionCount<TApp, K>>;
	findOne: <
		TQuery extends
			| FindOneOptionsBase<
					CollectionSelectOf<TApp, K>,
					CollectionRelationsOf<TApp, K>
			  >
			| undefined = undefined,
	>(
		options?: TQuery,
	) => UseQueryOptions<ApplyQuery<
		CollectionSelectOf<TApp, K>,
		CollectionRelationsOf<TApp, K>,
		TQuery
	> | null>;
	create: MutationBuilder<
		FirstArg<CollectionCreate<TApp, K>>,
		QueryData<CollectionCreate<TApp, K>>
	>;
	update: MutationBuilder<
		FirstArg<CollectionUpdate<TApp, K>>,
		QueryData<CollectionUpdate<TApp, K>>
	>;
	delete: MutationBuilder<
		FirstArg<CollectionDelete<TApp, K>>,
		QueryData<CollectionDelete<TApp, K>>
	>;
	restore: MutationBuilder<
		FirstArg<CollectionRestore<TApp, K>>,
		QueryData<CollectionRestore<TApp, K>>
	>;
	findVersions: QueryBuilder<CollectionFindVersions<TApp, K>>;
	revertToVersion: MutationBuilder<
		FirstArg<CollectionRevertToVersion<TApp, K>>,
		QueryData<CollectionRevertToVersion<TApp, K>>
	>;
	transitionStage: MutationBuilder<
		FirstArg<CollectionTransitionStage<TApp, K>>,
		QueryData<CollectionTransitionStage<TApp, K>>
	>;
	updateMany: MutationBuilder<
		{ where: any; data: any },
		QueryData<CollectionUpdate<TApp, K>>
	>;
	deleteMany: MutationBuilder<
		{ where: any },
		{ success: boolean; count: number }
	>;
};

type GlobalQueryOptionsAPI<
	TApp extends QuestpieApp,
	K extends GlobalKeys<TApp>,
> = {
	/** Generic per call — mirrors the direct client's `get()` narrowing. */
	get: <
		TQuery extends
			| {
					with?: With<GlobalRelationsOf<TApp, K>>;
					columns?: Record<string, boolean>;
					locale?: string;
					localeFallback?: boolean;
					stage?: string;
			  }
			| undefined = undefined,
	>(
		options?: TQuery,
		queryConfig?: RealtimeQueryConfig,
	) => UseQueryOptions<
		ApplyQuery<GlobalSelectOf<TApp, K>, GlobalRelationsOf<TApp, K>, TQuery>
	>;
	update: MutationBuilder<
		{
			data: Parameters<GlobalUpdate<TApp, K>>[0];
			options?: Parameters<GlobalUpdate<TApp, K>>[1];
		},
		QueryData<GlobalUpdate<TApp, K>>
	>;
	findVersions: QueryBuilder<GlobalFindVersions<TApp, K>>;
	revertToVersion: MutationBuilder<
		{
			params: Parameters<GlobalRevertToVersion<TApp, K>>[0];
			options?: Parameters<GlobalRevertToVersion<TApp, K>>[1];
		},
		QueryData<GlobalRevertToVersion<TApp, K>>
	>;
	transitionStage: MutationBuilder<
		{
			params: Parameters<GlobalTransitionStage<TApp, K>>[0];
			options?: Parameters<GlobalTransitionStage<TApp, K>>[1];
		},
		QueryData<GlobalTransitionStage<TApp, K>>
	>;
};

export type QuestpieQueryOptionsProxy<TApp extends QuestpieApp = QuestpieApp> =
	{
		collections: {
			[K in CollectionKeys<TApp>]: CollectionQueryOptionsAPI<TApp, K>;
		};
		globals: {
			[K in GlobalKeys<TApp>]: GlobalQueryOptionsAPI<TApp, K>;
		};
		channels: {
			[K in ChannelKeys<TApp>]: ChannelSubscriptionOptionsAPI<TApp, K>;
		};
		routes: RoutesQueryOptionsAPI<QuestpieClient<TApp>["routes"]>;
		custom: {
			query: <TData>(config: {
				key: QueryKey;
				queryFn: () => Promise<TData>;
			}) => UseQueryOptions<TData>;
			mutation: <TVariables, TData>(config: {
				key: QueryKey;
				mutationFn: (variables: TVariables) => Promise<TData>;
			}) => UseMutationOptions<TData, DefaultError, TVariables>;
		};
		key: (parts: QueryKey) => QueryKey;
	};

// ============================================================================
// Internal Helpers
// ============================================================================

const defaultErrorMap: QuestpieQueryErrorMap = (error) =>
	error instanceof Error
		? error
		: new Error(typeof error === "string" ? error : "Unknown error");

const isNonRetryableError = (error: unknown): boolean =>
	Boolean(
		error &&
		typeof error === "object" &&
		"retryable" in error &&
		error.retryable === false,
	);

const mapRealtimeError = (
	error: unknown,
	errorMap: QuestpieQueryErrorMap,
): unknown => {
	const mapped = errorMap(error);
	if (
		isNonRetryableError(error) &&
		(!mapped || typeof mapped !== "object" || !("retryable" in mapped))
	) {
		if (mapped && typeof mapped === "object" && Object.isExtensible(mapped)) {
			Object.defineProperty(mapped, "retryable", {
				value: false,
				enumerable: true,
			});
			return mapped;
		}
		return Object.assign(new Error("Non-retryable realtime query failed"), {
			cause: mapped,
			retryable: false as const,
		});
	}
	return mapped;
};

const realtimeRetry = (failureCount: number, error: unknown): boolean =>
	!isNonRetryableError(error) && failureCount < 3;

const buildKey = (prefix: QueryKey, parts: QueryKey): QueryKey =>
	prefix.length ? [...prefix, ...parts] : parts;

const sanitizeKeyPart = (value: unknown): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === "function") return undefined;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeKeyPart(item));
	}
	if (typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (typeof entry === "function") continue;
			const nextValue = sanitizeKeyPart(entry);
			if (nextValue !== undefined) {
				sanitized[key] = nextValue;
			}
		}
		return sanitized;
	}
	return value;
};

const normalizeQueryKeyOptions = (options: unknown) =>
	sanitizeKeyPart(options ?? {});

const wrapQueryFn = <TData>(
	queryFn: () => Promise<TData>,
	errorMap: QuestpieQueryErrorMap,
) => {
	return async () => {
		try {
			return await queryFn();
		} catch (error) {
			throw errorMap(error);
		}
	};
};

const wrapMutationFn = <TVariables, TData>(
	mutationFn: (variables: TVariables) => Promise<TData>,
	errorMap: QuestpieQueryErrorMap,
) => {
	return async (variables: TVariables) => {
		try {
			return await mutationFn(variables);
		} catch (error) {
			throw errorMap(error);
		}
	};
};

async function* streamRealtimeQuery<TInitialData>(options: {
	realtime: RealtimeAPI;
	topic: TopicConfig;
	signal?: AbortSignal;
	errorMap: QuestpieQueryErrorMap;
}): AsyncGenerator<RealtimeStreamEvent<TInitialData>, void, unknown> {
	const { realtime, topic, signal, errorMap } = options;
	try {
		for await (const event of realtime.streamEvents<TInitialData>(
			topic,
			signal,
		)) {
			yield event;
		}
	} catch (error) {
		throw mapRealtimeError(error, errorMap);
	}
}

// ============================================================================
// Main Factory
// ============================================================================

/**
 * Create type-safe query options proxy for TanStack Query
 *
 * @example
 * ```ts
 * import { createQuestpieQueryOptions } from "@questpie/tanstack-query"
 * import { createClient } from "questpie/client"
 * import type { AppConfig } from "@/questpie/server/.generated"
 *
 * const client = createClient<AppConfig>({ baseURL: "http://localhost:3000" })
 * const cmsQueries = createQuestpieQueryOptions(client)
 *
 * // Use with useQuery
 * const { data } = useQuery(cmsQueries.collections.posts.find({ limit: 10 }))
 *
 * // Use with useMutation
 * const mutation = useMutation(cmsQueries.collections.posts.create())
 *
 * // Use with routes
 * const stats = useQuery(cmsQueries.routes.dashboard.getStats.query({ period: "week" }))
 * ```
 */
export function createQuestpieQueryOptions<
	TApp extends QuestpieApp = QuestpieApp,
>(
	client: QuestpieClient<TApp>,
	config: QuestpieQueryOptionsConfig = {},
): QuestpieQueryOptionsProxy<TApp> {
	const keyPrefix = config.keyPrefix ?? ["questpie"];
	const errorMap = config.errorMap ?? defaultErrorMap;
	const locale = config.locale;
	const stage = config.stage;

	const collections = new Proxy(
		{} as QuestpieQueryOptionsProxy<TApp>["collections"],
		{
			get: (_target, collectionName) => {
				if (typeof collectionName !== "string") return undefined;
				const collection = client.collections[
					collectionName as CollectionKeys<TApp>
				] as any;
				const baseKey: QueryKey = ["collections", collectionName];

				return {
					find: (options?: any, queryConfig?: RealtimeQueryConfig) => {
						const qKey = buildKey(keyPrefix, [
							...baseKey,
							"find",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]);

						if (queryConfig?.realtime && client.realtime) {
							const { realtime: _realtime, ...overrides } = queryConfig;
							const topic = buildCollectionTopic(collectionName, options);
							return queryOptions({
								queryKey: qKey,
								retry: realtimeRetry,
								staleTime: 0,
								refetchOnMount: "always",
								...overrides,
								queryFn: streamedQuery({
									streamFn: ({ signal }) =>
										streamRealtimeQuery<any>({
											realtime: client.realtime,
											topic,
											signal,
											errorMap,
										}),
									reducer: applyRealtimeFindEvent,
									initialValue: undefined,
									refetchMode: "append",
								}),
							});
						}

						return queryOptions({
							queryKey: qKey,
							queryFn: wrapQueryFn(() => collection.find(options), errorMap),
						});
					},
					count: (options?: any, queryConfig?: RealtimeQueryConfig) => {
						const qKey = buildKey(keyPrefix, [
							...baseKey,
							"count",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]);

						if (queryConfig?.realtime && client.realtime) {
							const { realtime: _realtime, ...overrides } = queryConfig;
							const topic = buildCollectionTopic(
								collectionName,
								options,
								"count",
							);
							return queryOptions({
								queryKey: qKey,
								retry: realtimeRetry,
								staleTime: 0,
								refetchOnMount: "always",
								...overrides,
								queryFn: streamedQuery({
									streamFn: ({ signal }) =>
										streamRealtimeQuery<number>({
											realtime: client.realtime,
											topic,
											signal,
											errorMap,
										}),
									reducer: (current: any, event: any) =>
										applyRealtimeScalarEvent(current, event),
									initialValue: undefined,
									refetchMode: "append",
								}),
							});
						}

						return queryOptions({
							queryKey: qKey,
							queryFn: wrapQueryFn(() => collection.count(options), errorMap),
						});
					},
					findOne: (options: any) =>
						queryOptions({
							queryKey: buildKey(keyPrefix, [
								...baseKey,
								"findOne",
								locale,
								stage,
								normalizeQueryKeyOptions(options),
							]),
							queryFn: wrapQueryFn(() => collection.findOne(options), errorMap),
						}),
					create: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"create",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(data: any) =>
									collection.create(
										data,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					update: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"update",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { id: string; data: any }) =>
									collection.update(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					delete: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"delete",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { id: string }) =>
									collection.delete(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					restore: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"restore",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { id: string }) =>
									collection.restore(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					findVersions: (params: {
						id: string;
						limit?: number;
						offset?: number;
					}) =>
						queryOptions({
							queryKey: buildKey(keyPrefix, [
								...baseKey,
								"findVersions",
								locale,
								stage,
								normalizeQueryKeyOptions(params),
							]),
							queryFn: wrapQueryFn(
								() =>
									collection.findVersions(
										params,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					revertToVersion: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"revertToVersion",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: {
									id: string;
									version?: number;
									versionId?: string;
								}) =>
									collection.revertToVersion(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					transitionStage: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"transitionStage",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { id: string; stage: string }) =>
									collection.transitionStage(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					updateMany: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"updateMany",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { where: any; data: any }) =>
									collection.updateMany(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
					deleteMany: () =>
						mutationOptions({
							mutationKey: buildKey(keyPrefix, [
								...baseKey,
								"deleteMany",
								locale,
								stage,
							]),
							mutationFn: wrapMutationFn(
								(variables: { where: any }) =>
									collection.deleteMany(
										variables,
										locale || stage
											? {
													...(locale ? { locale } : {}),
													...(stage ? { stage } : {}),
												}
											: undefined,
									),
								errorMap,
							),
						}),
				};
			},
		},
	);

	const globals = new Proxy({} as QuestpieQueryOptionsProxy<TApp>["globals"], {
		get: (_target, globalName) => {
			if (typeof globalName !== "string") return undefined;
			const global = client.globals[globalName as GlobalKeys<TApp>] as any;
			const baseKey: QueryKey = ["globals", globalName];

			return {
				get: (options?: any, queryConfig?: RealtimeQueryConfig) => {
					const qKey = buildKey(keyPrefix, [
						...baseKey,
						"get",
						locale,
						stage,
						normalizeQueryKeyOptions(options),
					]);

					if (queryConfig?.realtime && client.realtime) {
						const { realtime: _realtime, ...overrides } = queryConfig;
						const topic = buildGlobalTopic(globalName as string, options);
						return queryOptions({
							queryKey: qKey,
							retry: realtimeRetry,
							staleTime: 0,
							refetchOnMount: "always",
							...overrides,
							queryFn: streamedQuery({
								streamFn: ({ signal }) =>
									streamRealtimeQuery({
										realtime: client.realtime,
										topic,
										signal,
										errorMap,
									}),
								reducer: (current: any, event: any) =>
									applyRealtimeSingleEvent(current, event),
								initialValue: undefined,
								refetchMode: "append",
							}),
						});
					}

					return queryOptions({
						queryKey: qKey,
						queryFn: wrapQueryFn(() => global.get(options), errorMap),
					});
				},
				update: () =>
					mutationOptions({
						mutationKey: buildKey(keyPrefix, [
							...baseKey,
							"update",
							locale,
							stage,
						]),
						mutationFn: wrapMutationFn(
							(variables: { data: any; options?: any }) =>
								global.update(variables.data, {
									...variables.options,
									...(locale ? { locale } : undefined),
									...(stage ? { stage } : undefined),
								}),
							errorMap,
						),
					}),
				findVersions: (options?: {
					id?: string;
					limit?: number;
					offset?: number;
					locale?: string;
					localeFallback?: boolean;
				}) =>
					queryOptions({
						queryKey: buildKey(keyPrefix, [
							...baseKey,
							"findVersions",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]),
						queryFn: wrapQueryFn(
							() =>
								global.findVersions({
									...options,
									...(locale ? { locale } : undefined),
									...(stage ? { stage } : undefined),
								}),
							errorMap,
						),
					}),
				revertToVersion: () =>
					mutationOptions({
						mutationKey: buildKey(keyPrefix, [
							...baseKey,
							"revertToVersion",
							locale,
							stage,
						]),
						mutationFn: wrapMutationFn(
							(variables: { params: any; options?: any }) =>
								global.revertToVersion(variables.params, {
									...variables.options,
									...(locale ? { locale } : undefined),
									...(stage ? { stage } : undefined),
								}),
							errorMap,
						),
					}),
				transitionStage: () =>
					mutationOptions({
						mutationKey: buildKey(keyPrefix, [
							...baseKey,
							"transitionStage",
							locale,
							stage,
						]),
						mutationFn: wrapMutationFn(
							(variables: { params: any; options?: any }) =>
								global.transitionStage(variables.params, {
									...variables.options,
									...(locale ? { locale } : undefined),
								}),
							errorMap,
						),
					}),
			};
		},
	});

	const channels = new Proxy(
		{} as QuestpieQueryOptionsProxy<TApp>["channels"],
		{
			get: (_target, channelName) => {
				if (typeof channelName !== "string") return undefined;
				const channel = Reflect.get(client.channels, channelName) as {
					iter: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>;
					presenceIter: (
						...args: unknown[]
					) => AsyncGenerator<readonly unknown[], void, unknown>;
				};
				return {
					subscription: (...args: unknown[]) => {
						const queryKey = buildKey(keyPrefix, [
							"channels",
							channelName,
							"subscription",
							normalizeQueryKeyOptions(args),
						]);
						return queryOptions({
							queryKey,
							queryFn: streamedQuery({
								streamFn: ({ signal }) => channel.iter(...args, { signal }),
								reducer: (messages: readonly unknown[], message: unknown) => [
									...messages,
									message,
								],
								initialValue: [] as readonly unknown[],
								refetchMode: "reset",
							}),
						});
					},
					presence: (...args: unknown[]) => {
						const queryKey = buildKey(keyPrefix, [
							"channels",
							channelName,
							"presence",
							normalizeQueryKeyOptions(args),
						]);
						return queryOptions({
							queryKey,
							queryFn: streamedQuery({
								streamFn: ({ signal }) =>
									channel.presenceIter(...args, { signal }),
								reducer: (
									_roster: readonly unknown[],
									snapshot: readonly unknown[],
								) => snapshot,
								initialValue: [] as readonly unknown[],
								refetchMode: "reset",
							}),
						});
					},
				};
			},
		},
	);

	/**
	 * Resolve a nested route caller from the client by traversing dot segments.
	 */
	const callRoute = async (segments: string[], input: unknown) => {
		let current: any = client.routes as any;

		for (const segment of segments) {
			current = current?.[segment];
		}

		if (typeof current !== "function") {
			throw new Error(
				`Route not found at path: ${segments.join(".") || "<root>"}`,
			);
		}

		if (input === undefined) {
			return current();
		}

		return current(input);
	};

	const createRouteNodeProxy = (segments: string[]): any => {
		return new Proxy(
			{},
			{
				get: (_target, prop) => {
					if (prop === "query") {
						return (input?: any) =>
							queryOptions({
								queryKey: buildKey(keyPrefix, [
									"routes",
									...segments,
									"query",
									locale,
									normalizeQueryKeyOptions(input),
								]),
								queryFn: wrapQueryFn(
									() => callRoute(segments, input),
									errorMap,
								),
							});
					}

					if (prop === "mutation") {
						return () =>
							mutationOptions({
								mutationKey: buildKey(keyPrefix, [
									"routes",
									...segments,
									"mutation",
									locale,
								]),
								mutationFn: wrapMutationFn(
									(variables: any) => callRoute(segments, variables),
									errorMap,
								),
							});
					}

					if (prop === "key") {
						return (input?: any) =>
							buildKey(keyPrefix, [
								"routes",
								...segments,
								"query",
								locale,
								normalizeQueryKeyOptions(input),
							]);
					}

					if (typeof prop !== "string") return undefined;
					return createRouteNodeProxy([...segments, prop]);
				},
			},
		);
	};

	const routesProxy = new Proxy(
		{} as QuestpieQueryOptionsProxy<TApp>["routes"],
		{
			get: (_target, prop) => {
				if (typeof prop !== "string") return undefined;
				return createRouteNodeProxy([prop]);
			},
		},
	);

	return {
		collections,
		globals,
		channels,
		routes: routesProxy,
		custom: {
			query: (customConfig) =>
				queryOptions({
					queryKey: buildKey(keyPrefix, customConfig.key),
					queryFn: wrapQueryFn(customConfig.queryFn, errorMap),
				}),
			mutation: (customConfig) =>
				mutationOptions({
					mutationKey: buildKey(keyPrefix, customConfig.key),
					mutationFn: wrapMutationFn(customConfig.mutationFn, errorMap),
				}),
		},
		key: (parts) => buildKey(keyPrefix, parts),
	};
}
