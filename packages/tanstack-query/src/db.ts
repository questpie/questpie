import type { QCMSClient } from "@questpie/cms/client";
import type {
	Collection as CMSCollection,
	CollectionSelect,
	FindManyOptions,
	GetCollection,
	QCMS,
	ResolveRelationsDeep,
} from "@questpie/cms/server";
import type { Collection, CollectionConfig } from "@tanstack/db";
import { createCollection } from "@tanstack/db";
import type {
	LoadSubsetOptions,
	ParsedOrderBy,
	SimpleComparison,
} from "@tanstack/db";
import type { QueryClient } from "@tanstack/query-core";
import {
	parseLoadSubsetOptions,
	queryCollectionOptions,
	type QueryCollectionConfig,
	type QueryCollectionUtils,
} from "@tanstack/query-db-collection";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import qs from "qs";

import type { QCMSQueryOptionsConfig, QueryKey } from "./index";

type ResolvedCollections<T extends QCMS<any>> = T["config"]["collections"];
type AnyCollection = CMSCollection<any>;

type CollectionKeys<T extends QCMS<any>> = Extract<
	keyof QCMSClient<T>["collections"],
	string
>;

type CollectionDefinition<T extends QCMS<any>, K extends CollectionKeys<T>> =
	K extends keyof ResolvedCollections<T>
		? GetCollection<ResolvedCollections<T>, K>
		: AnyCollection;

type CollectionSelectType<T extends QCMS<any>, K extends CollectionKeys<T>> =
	CollectionSelect<CollectionDefinition<T, K>>;

type CollectionRelationsType<T extends QCMS<any>, K extends CollectionKeys<T>> =
	ResolveRelationsDeep<
		CollectionDefinition<T, K>["state"]["relations"],
		ResolvedCollections<T>
	>;

type PaginatedResult<T> = {
	docs: T[];
	totalDocs: number;
	limit: number;
	totalPages: number;
	page: number;
	pagingCounter: number;
	hasPrevPage: boolean;
	hasNextPage: boolean;
	prevPage: number | null;
	nextPage: number | null;
};

type CollectionItem<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = Partial<CollectionSelectType<T, K>>;

type FindOptions<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = FindManyOptions<CollectionSelectType<T, K>, CollectionRelationsType<T, K>>;

type CollectionFind<T extends QCMS<any>, K extends CollectionKeys<T>> = (
	options?: FindOptions<T, K>,
) => Promise<PaginatedResult<CollectionItem<T, K>>>;

type CollectionFindResult<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = PaginatedResult<CollectionItem<T, K>>;

type BaseQueryCollectionConfig<TItem extends object> = Omit<
	QueryCollectionConfig<TItem>,
	"queryKey" | "queryFn" | "queryClient" | "getKey" | "select"
>;

type InferSchemaOutput<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<T> extends object
		? StandardSchemaV1.InferOutput<T>
		: Record<string, unknown>
	: Record<string, unknown>;

type InferSchemaInput<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferInput<T> extends object
		? StandardSchemaV1.InferInput<T>
		: Record<string, unknown>
	: Record<string, unknown>;

export type QCMSFilterOperatorMap = Record<string, string>;

export const defaultFilterOperatorMap: QCMSFilterOperatorMap = {
	eq: "eq",
	gt: "gt",
	gte: "gte",
	lt: "lt",
	lte: "lte",
	in: "in",
	not_eq: "ne",
	not_in: "notIn",
	not_gt: "lte",
	not_gte: "lt",
	not_lt: "gte",
	not_lte: "gt",
	isNull: "isNull",
	not_isNull: "isNotNull",
	isUndefined: "isNull",
	not_isUndefined: "isNotNull",
};

export type QCMSLoadSubsetOptionsConfig = {
	filterOperatorMap?: QCMSFilterOperatorMap;
};

export type QCMSLoadSubsetMapper<TFindOptions> = (
	options: LoadSubsetOptions | undefined,
) => Partial<TFindOptions> | undefined;

export type QCMSRealtimeSnapshot<TData = unknown> = {
	seq?: number;
	data: TData;
};

export type QCMSRealtimeConfig<TFindOptions, TItem> = {
	enabled?: boolean;
	baseURL?: string;
	basePath?: string;
	query?: TFindOptions;
	eventSource?: (url: string) => EventSource;
	onSnapshot?: (payload: QCMSRealtimeSnapshot) => void;
	onError?: (event: Event) => void;
	onOpen?: (event: Event) => void;
	mapSnapshot?: (payload: QCMSRealtimeSnapshot) => TItem[];
};

export type QCMSRealtimeHandle = {
	close: () => void;
	source?: EventSource;
};

export function buildWhereFromFilters<TWhere = Record<string, unknown>>(
	filters: SimpleComparison[],
	operatorMap: QCMSFilterOperatorMap = defaultFilterOperatorMap,
): TWhere | undefined {
	if (!filters.length) return undefined;
	const where: Record<string, any> = {};

	for (const filter of filters) {
		const operator = operatorMap[filter.operator];
		if (!operator) continue;
		applyFilter(where, filter.field, operator, filter.value);
	}

	return Object.keys(where).length ? (where as TWhere) : undefined;
}

export function buildOrderByFromSorts<
	TOrderBy = Record<string, "asc" | "desc">,
>(
	sorts: ParsedOrderBy[],
): TOrderBy | undefined {
	if (!sorts.length) return undefined;
	const orderBy: Record<string, "asc" | "desc"> = {};

	for (const sort of sorts) {
		if (sort.field.length !== 1) continue;
		orderBy[String(sort.field[0])] = sort.direction;
	}

	return Object.keys(orderBy).length ? (orderBy as TOrderBy) : undefined;
}

export function mapLoadSubsetOptionsToFindOptions<
	TFindOptions extends {
		where?: unknown;
		orderBy?: unknown;
		limit?: number;
	},
>(
	options: LoadSubsetOptions | undefined,
	config: QCMSLoadSubsetOptionsConfig = {},
): Partial<TFindOptions> {
	const parsed = parseLoadSubsetOptions(options);
	return {
		where: buildWhereFromFilters<TFindOptions["where"]>(
			parsed.filters,
			config.filterOperatorMap ?? defaultFilterOperatorMap,
		),
		orderBy: buildOrderByFromSorts<TFindOptions["orderBy"]>(parsed.sorts),
		limit: parsed.limit,
	} as Partial<TFindOptions>;
}

const applyFilter = (
	target: Record<string, any>,
	fieldPath: Array<string | number>,
	operator: string,
	value: unknown,
) => {
	let cursor = target;

	for (let i = 0; i < fieldPath.length - 1; i += 1) {
		const key = String(fieldPath[i]);
		if (!cursor[key] || typeof cursor[key] !== "object") {
			cursor[key] = {};
		}
		cursor = cursor[key];
	}

	const leafKey = String(fieldPath[fieldPath.length - 1]);
	const existing = cursor[leafKey];
	const resolvedValue = value === undefined ? true : value;

	if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
		cursor[leafKey] = { [operator]: resolvedValue };
		return;
	}

	cursor[leafKey] = { ...existing, [operator]: resolvedValue };
};

const mergeWhere = (base: unknown, extra: unknown) => {
	if (!base) return extra;
	if (!extra) return base;
	return { AND: [base, extra] };
};

const mergeOrderBy = (base: unknown, extra: unknown) => {
	if (!base) return extra;
	if (!extra) return base;
	if (typeof base === "function" || typeof extra === "function") return extra;
	if (typeof base === "object" && typeof extra === "object") {
		return { ...base, ...extra };
	}
	return extra;
};

const mergeFindOptions = <TFindOptions extends { [key: string]: any }>(
	base: TFindOptions | undefined,
	extra: Partial<TFindOptions> | undefined,
) => {
	if (!base && !extra) return undefined;
	if (!base) return extra;
	if (!extra) return base;

	return {
		...base,
		...extra,
		where: mergeWhere(base.where, extra.where),
		orderBy: mergeOrderBy(base.orderBy, extra.orderBy),
		limit: extra.limit ?? base.limit,
		offset: (extra as { offset?: TFindOptions["offset"] }).offset ?? base.offset,
	};
};

export type QCMSDBCollectionConfig<
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
> = BaseQueryCollectionConfig<CollectionItem<T, K>> & {
	queryClient: QueryClient;
	getKey: (item: CollectionItem<T, K>) => string | number;
	queryKey?: QueryKey;
	baseFindOptions?: FindOptions<T, K>;
	select?: (data: CollectionFindResult<T, K>) => CollectionItem<T, K>[];
	mapLoadSubsetOptions?: QCMSLoadSubsetMapper<FindOptions<T, K>>;
	loadSubsetOptionsConfig?: QCMSLoadSubsetOptionsConfig;
	realtime?: boolean | QCMSRealtimeConfig<FindOptions<T, K>, CollectionItem<T, K>>;
};

type QCMSDBCollectionKey<TConfig> =
	TConfig extends { getKey: (item: any) => infer TKey } ? TKey : string | number;

type QCMSDBCollectionResult<TItem extends object, TConfig> =
	TConfig extends { schema: infer TSchema extends StandardSchemaV1 }
		? Collection<
				InferSchemaOutput<TSchema>,
				QCMSDBCollectionKey<TConfig>,
				TSchema,
				QueryCollectionUtils<
					InferSchemaOutput<TSchema>,
					QCMSDBCollectionKey<TConfig>,
					InferSchemaInput<TSchema>,
					unknown
				>
			> & { realtime?: QCMSRealtimeHandle }
		: Collection<
				TItem,
				QCMSDBCollectionKey<TConfig>,
				never,
				QueryCollectionUtils<
					TItem,
					QCMSDBCollectionKey<TConfig>,
					TItem,
					unknown
				>
			> & { realtime?: QCMSRealtimeHandle };

type QCMSDBCollectionOptionsResult<TItem extends object, TConfig> =
	TConfig extends { schema: infer TSchema extends StandardSchemaV1 }
		? CollectionConfig<
				InferSchemaOutput<TSchema>,
				QCMSDBCollectionKey<TConfig>,
				TSchema,
				QueryCollectionUtils<
					InferSchemaOutput<TSchema>,
					QCMSDBCollectionKey<TConfig>,
					InferSchemaInput<TSchema>,
					unknown
				>
			> & {
				schema: TSchema;
				utils: QueryCollectionUtils<
					InferSchemaOutput<TSchema>,
					QCMSDBCollectionKey<TConfig>,
					InferSchemaInput<TSchema>,
					unknown
					>;
			}
		: CollectionConfig<
				TItem,
				QCMSDBCollectionKey<TConfig>,
				never,
				QueryCollectionUtils<
					TItem,
					QCMSDBCollectionKey<TConfig>,
					TItem,
					unknown
				>
			> & {
				schema?: never;
				utils: QueryCollectionUtils<
					TItem,
					QCMSDBCollectionKey<TConfig>,
					TItem,
					unknown
				>;
			};

export type QCMSDBHelpers<T extends QCMS<any>> = {
	collections: {
		[K in CollectionKeys<T>]: {
			queryCollectionOptions: <TConfig extends QCMSDBCollectionConfig<T, K>>(
				config: TConfig,
			) => QCMSDBCollectionOptionsResult<CollectionItem<T, K>, TConfig>;
			createCollection: <TConfig extends QCMSDBCollectionConfig<T, K>>(
				config: TConfig,
			) => QCMSDBCollectionResult<CollectionItem<T, K>, TConfig>;
		};
	};
};

export function createQCMSDBHelpers<T extends QCMS<any>>(
	client: QCMSClient<T>,
	config: Pick<QCMSQueryOptionsConfig, "keyPrefix"> = {},
): QCMSDBHelpers<T> {
	const keyPrefix = config.keyPrefix ?? ["qcms"];

	const collections = new Proxy({} as QCMSDBHelpers<T>["collections"], {
		get: (_target, collectionName) => {
			if (typeof collectionName !== "string") return undefined;
			const collectionKey = collectionName as CollectionKeys<T>;
			const collection =
				client.collections[collectionKey] as QCMSClient<T>["collections"][typeof collectionKey];
			const typedCollection = collection as unknown as {
				find: CollectionFind<T, typeof collectionKey>;
			};

			return {
				queryCollectionOptions: <TConfig extends QCMSDBCollectionConfig<T, typeof collectionKey>>(
					options: TConfig,
				) =>
					createQCMSQueryCollectionOptions(
						collectionKey,
						typedCollection,
						options,
						{
							keyPrefix,
						},
					),
				createCollection: <TConfig extends QCMSDBCollectionConfig<T, typeof collectionKey>>(
					options: TConfig,
				) =>
					createQCMSCollectionWithRealtime(
						collectionKey,
						typedCollection,
						options,
						{ keyPrefix },
					),
			};
		},
	});

	return { collections };
}

const createQCMSQueryCollectionOptions = <
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
	TConfig extends QCMSDBCollectionConfig<T, K>,
>(
	collectionName: K,
	collection: {
		find: CollectionFind<T, K>;
	},
	options: TConfig,
	config: { keyPrefix: QueryKey },
) => {
	const {
		queryClient,
		getKey,
		queryKey,
		baseFindOptions,
		select,
		mapLoadSubsetOptions,
		loadSubsetOptionsConfig,
		realtime,
		...collectionConfig
	} = options;

	const queryFn = async (ctx: { meta?: { loadSubsetOptions?: LoadSubsetOptions } }) => {
		const subsetOptions = mapLoadSubsetOptions
			? mapLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
			: mapLoadSubsetOptionsToFindOptions<FindOptions<T, K>>(
					ctx.meta?.loadSubsetOptions,
					loadSubsetOptionsConfig,
				);

		const mergedOptions = mergeFindOptions(baseFindOptions, subsetOptions);
		const result = mergedOptions
			? await collection.find(mergedOptions)
			: await collection.find();
		return select ? select(result) : result.docs ?? [];
	};

	const resolvedQueryKey =
		queryKey ??
		(config.keyPrefix.length
			? [
					...config.keyPrefix,
					"collections",
					collectionName,
					"find",
					baseFindOptions ?? {},
				]
			: ["collections", collectionName, "find", baseFindOptions ?? {}]);

	return queryCollectionOptions({
		...collectionConfig,
		queryKey: resolvedQueryKey,
		queryFn,
		queryClient,
		getKey,
	});
};

const createQCMSCollectionWithRealtime = <
	T extends QCMS<any>,
	K extends CollectionKeys<T>,
	TConfig extends QCMSDBCollectionConfig<T, K>,
>(
	collectionName: K,
	collection: {
		find: CollectionFind<T, K>;
	},
	options: TConfig,
	config: { keyPrefix: QueryKey },
): QCMSDBCollectionResult<CollectionItem<T, K>, TConfig> => {
	const resolvedOptions = createQCMSQueryCollectionOptions(
		collectionName,
		collection,
		options,
		config,
	);
	const collectionInstance = createCollection(
		resolvedOptions as QCMSDBCollectionOptionsResult<
			CollectionItem<T, K>,
			TConfig
		>,
	) as QCMSDBCollectionResult<CollectionItem<T, K>, TConfig>;

	const realtimeConfig = resolveRealtimeConfig(options.realtime);
	const resolvedRealtimeConfig = realtimeConfig
		? {
				...realtimeConfig,
				query: realtimeConfig.query ?? options.baseFindOptions,
			}
		: undefined;
	if (resolvedRealtimeConfig && resolvedRealtimeConfig.enabled !== false) {
		const handle = startCollectionRealtime(
			collectionName,
			collectionInstance,
			resolvedRealtimeConfig,
		);
		if (handle) {
			collectionInstance.realtime = handle;
		}
	}

	return collectionInstance;
};

const resolveRealtimeConfig = <TFindOptions, TItem>(
	config?: boolean | QCMSRealtimeConfig<TFindOptions, TItem>,
): QCMSRealtimeConfig<TFindOptions, TItem> | undefined => {
	if (!config) return undefined;
	if (config === true) return {};
	return config;
};

const startCollectionRealtime = <TItem>(
	collectionName: string,
	collection: { replaceAll: (items: TItem[]) => void },
	config: QCMSRealtimeConfig<any, TItem>,
): QCMSRealtimeHandle | undefined => {
	const createEventSource =
		config.eventSource ??
		(typeof EventSource === "undefined"
			? undefined
			: (url: string) => new EventSource(url));
	if (!createEventSource) return undefined;

	const url = buildRealtimeUrl(collectionName, config);
	const source = createEventSource(url);

	const handleSnapshot = (event: MessageEvent) => {
		const payload = JSON.parse(event.data) as QCMSRealtimeSnapshot;
		if (config.onSnapshot) {
			config.onSnapshot(payload);
		}
		const items = config.mapSnapshot
			? config.mapSnapshot(payload)
			: extractItemsFromSnapshot<TItem>(payload);
		if (items) {
			collection.replaceAll(items);
		}
	};

	source.addEventListener("snapshot", handleSnapshot);

	if (config.onError) {
		source.addEventListener("error", config.onError);
	}

	if (config.onOpen) {
		source.addEventListener("open", config.onOpen);
	}

	return {
		source,
		close: () => source.close(),
	};
};

const buildRealtimeUrl = <TFindOptions>(
	collectionName: string,
	config: QCMSRealtimeConfig<TFindOptions, any>,
) => {
	const basePath = normalizeBasePath(config.basePath ?? "/cms");
	const path = `${basePath}/realtime/${collectionName}`;
	const queryString =
		config.query && typeof config.query === "object"
			? qs.stringify(sanitizeRealtimeQuery(config.query), {
					skipNulls: true,
					arrayFormat: "brackets",
				})
			: "";
	const baseURL = config.baseURL ? config.baseURL.replace(/\/$/, "") : "";
	const suffix = queryString ? `?${queryString}` : "";
	return `${baseURL}${path}${suffix}`;
};

const sanitizeRealtimeQuery = (value: unknown): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === "function") return undefined;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeRealtimeQuery(item));
	}
	if (typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (typeof entry === "function") continue;
			const nextValue = sanitizeRealtimeQuery(entry);
			if (nextValue !== undefined) {
				sanitized[key] = nextValue;
			}
		}
		return sanitized;
	}
	return value;
};

const normalizeBasePath = (basePath: string) => {
	const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
	return normalized.replace(/\/$/, "");
};

const extractItemsFromSnapshot = <TItem>(
	payload: QCMSRealtimeSnapshot,
): TItem[] | undefined => {
	if (!payload || !payload.data) return undefined;
	const data = payload.data as { docs?: TItem[] } | TItem[];
	if (Array.isArray(data)) return data as TItem[];
	if (Array.isArray(data.docs)) return data.docs as TItem[];
	return undefined;
};
