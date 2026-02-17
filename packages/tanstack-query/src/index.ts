import {
	type DefaultError,
	mutationOptions,
	type QueryKey,
	queryOptions,
	experimental_streamedQuery as streamedQuery,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type { QueryKey, DefaultError, UseQueryOptions, UseMutationOptions };

// ============================================================================
// Re-export realtime utilities from core client
// ============================================================================

export {
	buildCollectionTopic,
	buildGlobalTopic,
	type RealtimeAPI,
	type TopicConfig,
} from "questpie/client";

import { buildCollectionTopic, buildGlobalTopic } from "questpie/client";

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
	Parameters<TFn> extends [infer TFirst, ...any[]] ? TFirst : never;
type HasArgs<TFn extends AnyAsyncFn> =
	Parameters<TFn> extends [] ? false : true;

type QueryBuilder<TFn extends AnyAsyncFn> =
	HasArgs<TFn> extends false
		? () => UseQueryOptions<QueryData<TFn>>
		: undefined extends FirstArg<TFn>
			? (options?: FirstArg<TFn>) => UseQueryOptions<QueryData<TFn>>
			: (options: FirstArg<TFn>) => UseQueryOptions<QueryData<TFn>>;

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
type CollectionKeys<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
> = Extract<keyof QuestpieClient<TApp, TRPC>["collections"], string>;

/** Extract global keys from QuestpieClient */
type GlobalKeys<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
> = Extract<keyof QuestpieClient<TApp, TRPC>["globals"], string>;

// Collection method type extractors
type CollectionFind<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["find"];
type CollectionCount<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["count"];
type CollectionFindOne<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["findOne"];
type CollectionCreate<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["create"];
type CollectionUpdate<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["update"];
type CollectionDelete<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["delete"];
type CollectionRestore<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["restore"];
type CollectionFindVersions<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["findVersions"];
type CollectionRevertToVersion<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["revertToVersion"];
type CollectionTransitionStage<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["collections"][K]["transitionStage"];

// Global method type extractors
type GlobalGet<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["globals"][K] extends { get: infer TGet }
	? TGet extends AnyAsyncFn
		? TGet
		: never
	: never;
type GlobalUpdate<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["globals"][K] extends { update: infer TUpdate }
	? TUpdate extends AnyAsyncFn
		? TUpdate
		: never
	: never;
type GlobalFindVersions<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["globals"][K] extends {
	findVersions: infer TFindVersions;
}
	? TFindVersions extends AnyAsyncFn
		? TFindVersions
		: never
	: never;
type GlobalRevertToVersion<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["globals"][K] extends {
	revertToVersion: infer TRevert;
}
	? TRevert extends AnyAsyncFn
		? TRevert
		: never
	: never;
type GlobalTransitionStage<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = QuestpieClient<TApp, TRPC>["globals"][K] extends {
	transitionStage: infer TTransition;
}
	? TTransition extends AnyAsyncFn
		? TTransition
		: never
	: never;

type RpcProcedureQueryOptionsAPI<TFn extends AnyAsyncFn> = {
	query: QueryBuilder<TFn>;
	mutation: MutationBuilder<MutationVariables<TFn>, QueryData<TFn>>;
	key: KeyBuilder<TFn>;
};

type RpcQueryOptionsAPI<TRpcNode> = TRpcNode extends AnyAsyncFn
	? RpcProcedureQueryOptionsAPI<TRpcNode>
	: TRpcNode extends Record<string, any>
		? {
				[K in keyof TRpcNode]: RpcQueryOptionsAPI<TRpcNode[K]>;
			}
		: never;

// ============================================================================
// API Types
// ============================================================================

type CollectionQueryOptionsAPI<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends CollectionKeys<TApp, TRPC>,
> = {
	find: QueryBuilder<CollectionFind<TApp, TRPC, K>>;
	count: QueryBuilder<CollectionCount<TApp, TRPC, K>>;
	findOne: QueryBuilder<CollectionFindOne<TApp, TRPC, K>>;
	create: MutationBuilder<
		FirstArg<CollectionCreate<TApp, TRPC, K>>,
		QueryData<CollectionCreate<TApp, TRPC, K>>
	>;
	update: MutationBuilder<
		FirstArg<CollectionUpdate<TApp, TRPC, K>>,
		QueryData<CollectionUpdate<TApp, TRPC, K>>
	>;
	delete: MutationBuilder<
		FirstArg<CollectionDelete<TApp, TRPC, K>>,
		QueryData<CollectionDelete<TApp, TRPC, K>>
	>;
	restore: MutationBuilder<
		FirstArg<CollectionRestore<TApp, TRPC, K>>,
		QueryData<CollectionRestore<TApp, TRPC, K>>
	>;
	findVersions: QueryBuilder<CollectionFindVersions<TApp, TRPC, K>>;
	revertToVersion: MutationBuilder<
		FirstArg<CollectionRevertToVersion<TApp, TRPC, K>>,
		QueryData<CollectionRevertToVersion<TApp, TRPC, K>>
	>;
	transitionStage: MutationBuilder<
		FirstArg<CollectionTransitionStage<TApp, TRPC, K>>,
		QueryData<CollectionTransitionStage<TApp, TRPC, K>>
	>;
	updateMany: MutationBuilder<
		{ where: any; data: any },
		QueryData<CollectionUpdate<TApp, TRPC, K>>
	>;
	deleteMany: MutationBuilder<
		{ where: any },
		{ success: boolean; count: number }
	>;
};

type GlobalQueryOptionsAPI<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any>,
	K extends GlobalKeys<TApp, TRPC>,
> = {
	get: QueryBuilder<GlobalGet<TApp, TRPC, K>>;
	update: MutationBuilder<
		{
			data: Parameters<GlobalUpdate<TApp, TRPC, K>>[0];
			options?: Parameters<GlobalUpdate<TApp, TRPC, K>>[1];
		},
		QueryData<GlobalUpdate<TApp, TRPC, K>>
	>;
	findVersions: QueryBuilder<GlobalFindVersions<TApp, TRPC, K>>;
	revertToVersion: MutationBuilder<
		{
			params: Parameters<GlobalRevertToVersion<TApp, TRPC, K>>[0];
			options?: Parameters<GlobalRevertToVersion<TApp, TRPC, K>>[1];
		},
		QueryData<GlobalRevertToVersion<TApp, TRPC, K>>
	>;
	transitionStage: MutationBuilder<
		{
			params: Parameters<GlobalTransitionStage<TApp, TRPC, K>>[0];
			options?: Parameters<GlobalTransitionStage<TApp, TRPC, K>>[1];
		},
		QueryData<GlobalTransitionStage<TApp, TRPC, K>>
	>;
};

export type QuestpieQueryOptionsProxy<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any> = Record<string, never>,
> = {
	collections: {
		[K in CollectionKeys<TApp, TRPC>]: CollectionQueryOptionsAPI<TApp, TRPC, K>;
	};
	globals: {
		[K in GlobalKeys<TApp, TRPC>]: GlobalQueryOptionsAPI<TApp, TRPC, K>;
	};
	rpc: RpcQueryOptionsAPI<QuestpieClient<TApp, TRPC>["rpc"]>;
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
 * import type { App, AppRpc } from "@/app"
 *
 * const client = createClient<App, AppRpc>({ baseURL: "http://localhost:3000" })
 * const cmsQueries = createQuestpieQueryOptions(client)
 *
 * // Use with useQuery
 * const { data } = useQuery(cmsQueries.collections.posts.find({ limit: 10 }))
 *
 * // Use with useMutation
 * const mutation = useMutation(cmsQueries.collections.posts.create())
 *
 * // Use with RPC
 * const stats = useQuery(cmsQueries.rpc.dashboard.getStats.query({ period: "week" }))
 * ```
 */
export function createQuestpieQueryOptions<
	TApp extends Questpie<any>,
	TRPC extends Record<string, any> = Record<string, never>,
>(
	client: QuestpieClient<TApp, TRPC>,
	config: QuestpieQueryOptionsConfig = {},
): QuestpieQueryOptionsProxy<TApp, TRPC> {
	const keyPrefix = config.keyPrefix ?? ["questpie"];
	const errorMap = config.errorMap ?? defaultErrorMap;
	const locale = config.locale;
	const stage = config.stage;

	const collections = new Proxy(
		{} as QuestpieQueryOptionsProxy<TApp, TRPC>["collections"],
		{
			get: (_target, collectionName) => {
				if (typeof collectionName !== "string") return undefined;
				const collection = client.collections[
					collectionName as CollectionKeys<TApp, TRPC>
				] as any;
				const baseKey: QueryKey = ["collections", collectionName];

				return {
					find: (options?: any, queryConfig?: { realtime?: boolean }) => {
						const qKey = buildKey(keyPrefix, [
							...baseKey,
							"find",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]);

						if (queryConfig?.realtime && client.realtime) {
							const topic = buildCollectionTopic(collectionName, options);
							return queryOptions({
								queryKey: qKey,
								queryFn: streamedQuery({
									streamFn: ({ signal }) =>
										client.realtime.stream(topic, signal),
									reducer: (_: any, chunk: any) => chunk,
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
					count: (options?: any, queryConfig?: { realtime?: boolean }) => {
						const qKey = buildKey(keyPrefix, [
							...baseKey,
							"count",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]);

						if (queryConfig?.realtime && client.realtime) {
							const topic = buildCollectionTopic(collectionName, options);
							// For count, we extract totalDocs from the snapshot
							return queryOptions({
								queryKey: qKey,
								queryFn: streamedQuery({
									streamFn: ({ signal }) =>
										client.realtime.stream(topic, signal),
									reducer: (_: any, chunk: any) =>
										typeof chunk?.totalDocs === "number"
											? chunk.totalDocs
											: chunk,
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

	const globals = new Proxy(
		{} as QuestpieQueryOptionsProxy<TApp, TRPC>["globals"],
		{
			get: (_target, globalName) => {
				if (typeof globalName !== "string") return undefined;
				const global = client.globals[
					globalName as GlobalKeys<TApp, TRPC>
				] as any;
				const baseKey: QueryKey = ["globals", globalName];

				return {
					get: (options?: any, queryConfig?: { realtime?: boolean }) => {
						const qKey = buildKey(keyPrefix, [
							...baseKey,
							"get",
							locale,
							stage,
							normalizeQueryKeyOptions(options),
						]);

						if (queryConfig?.realtime && client.realtime) {
							const topic = buildGlobalTopic(globalName as string, options);
							return queryOptions({
								queryKey: qKey,
								queryFn: streamedQuery({
									streamFn: ({ signal }) =>
										client.realtime.stream(topic, signal),
									reducer: (_: any, chunk: any) => chunk,
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
		},
	);

	const callRpcProcedure = async (segments: string[], input: unknown) => {
		let current: any = client.rpc as any;

		for (const segment of segments) {
			current = current?.[segment];
		}

		if (typeof current !== "function") {
			throw new Error(
				`RPC procedure not found at path: ${segments.join(".") || "<root>"}`,
			);
		}

		if (input === undefined) {
			return current();
		}

		return current(input);
	};

	const createRpcNodeProxy = (segments: string[]): any => {
		return new Proxy(
			{},
			{
				get: (_target, prop) => {
					if (prop === "query") {
						return (input?: any) =>
							queryOptions({
								queryKey: buildKey(keyPrefix, [
									"rpc",
									...segments,
									"query",
									locale,
									normalizeQueryKeyOptions(input),
								]),
								queryFn: wrapQueryFn(
									() => callRpcProcedure(segments, input),
									errorMap,
								),
							});
					}

					if (prop === "mutation") {
						return () =>
							mutationOptions({
								mutationKey: buildKey(keyPrefix, [
									"rpc",
									...segments,
									"mutation",
									locale,
								]),
								mutationFn: wrapMutationFn(
									(variables: any) => callRpcProcedure(segments, variables),
									errorMap,
								),
							});
					}

					if (prop === "key") {
						return (input?: any) =>
							buildKey(keyPrefix, [
								"rpc",
								...segments,
								"query",
								locale,
								normalizeQueryKeyOptions(input),
							]);
					}

					if (typeof prop !== "string") return undefined;
					return createRpcNodeProxy([...segments, prop]);
				},
			},
		);
	};

	const rpc = new Proxy({} as QuestpieQueryOptionsProxy<TApp, TRPC>["rpc"], {
		get: (_target, prop) => {
			if (typeof prop !== "string") return undefined;
			return createRpcNodeProxy([prop]);
		},
	});

	return {
		collections,
		globals,
		rpc,
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
