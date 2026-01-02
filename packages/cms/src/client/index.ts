import type {
	FindManyOptions,
	FindFirstOptions,
	PaginatedResult,
	ApplyQuery,
	CreateInputBase,
	CreateInputWithRelations,
	UpdateParams,
	With,
} from "../server/collection/crud/types.js";
import type {
	AnyCollection,
	AnyCollectionOrBuilder,
	CollectionSelect,
	CollectionInsert,
	CollectionUpdate,
	GlobalSelect,
	GlobalUpdate,
	GetCollection,
	ResolveRelationsDeep,
	CollectionFunctions,
	GlobalFunctions,
} from "#questpie/cms/shared/type-utils.js";
import type {
	ExtractJsonFunctions,
	InferFunctionInput,
	InferFunctionOutput,
	JsonFunctionDefinition,
} from "#questpie/cms/server/functions/types.js";
import qs from "qs";
import type {
	AnyGlobal,
	GetFunctions,
	GetGlobal,
	QCMS,
} from "#questpie/cms/exports/server.js";

export class QCMSClientError extends Error {
	status: number;
	statusText: string;
	data?: unknown;
	url: string;

	constructor(options: {
		message: string;
		status: number;
		statusText: string;
		data?: unknown;
		url: string;
	}) {
		super(options.message);
		this.name = "QCMSClientError";
		this.status = options.status;
		this.statusText = options.statusText;
		this.data = options.data;
		this.url = options.url;
	}
}

/**
 * Client configuration
 */
export type QCMSClientConfig = {
	/**
	 * Base URL of the CMS API
	 * @example 'http://localhost:3000'
	 */
	baseURL: string;

	/**
	 * Custom fetch implementation
	 * @default globalThis.fetch
	 */
	fetch?: typeof fetch;

	/**
	 * Base path for API routes
	 * Use '/cms' for server-only apps or '/api/cms' for fullstack apps.
	 * @default '/cms'
	 */
	basePath?: string;

	/**
	 * Default headers to include in all requests
	 */
	headers?: Record<string, string>;
};

type JsonFunctionCaller<TDefinition extends JsonFunctionDefinition<any, any>> =
	(
		input: InferFunctionInput<TDefinition>,
	) => Promise<InferFunctionOutput<TDefinition>>;

type RootFunctionsAPI<T extends QCMS> =
	GetFunctions<T["config"]> extends Record<string, any>
		? {
				[K in keyof ExtractJsonFunctions<
					GetFunctions<T["config"]>
				>]: ExtractJsonFunctions<
					GetFunctions<T["config"]>
				>[K] extends JsonFunctionDefinition<any, any>
					? JsonFunctionCaller<
							ExtractJsonFunctions<GetFunctions<T["config"]>>[K]
						>
					: never;
			}
		: {};

type CollectionFunctionsAPI<TCollection> = {
	[K in keyof ExtractJsonFunctions<
		CollectionFunctions<TCollection>
	>]: ExtractJsonFunctions<
		CollectionFunctions<TCollection>
	>[K] extends JsonFunctionDefinition<any, any>
		? JsonFunctionCaller<
				ExtractJsonFunctions<CollectionFunctions<TCollection>>[K]
			>
		: never;
};

type GlobalFunctionsAPI<TGlobal> = {
	[K in keyof ExtractJsonFunctions<
		GlobalFunctions<TGlobal>
	>]: ExtractJsonFunctions<
		GlobalFunctions<TGlobal>
	>[K] extends JsonFunctionDefinition<any, any>
		? JsonFunctionCaller<ExtractJsonFunctions<GlobalFunctions<TGlobal>>[K]>
		: never;
};

/**
 * Type-safe collection API for a single collection
 */
type CollectionAPI<
	TCollection extends AnyCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = {
	/**
	 * Find many records (paginated)
	 */
	find: <
		TQuery extends FindManyOptions<
			CollectionSelect<TCollection>,
			ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<
		PaginatedResult<
			ApplyQuery<
				CollectionSelect<TCollection>,
				ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>,
				TQuery
			>
		>
	>;

	/**
	 * Find single record matching query
	 * Note: Client currently enforces 'id' in where clause for the specific endpoint
	 */
	findOne: <
		TQuery extends FindFirstOptions<
			CollectionSelect<TCollection>,
			ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>
		> & { where: { id: string } },
	>(
		options: TQuery,
	) => Promise<ApplyQuery<
		CollectionSelect<TCollection>,
		ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>,
		TQuery
	> | null>;

	/**
	 * Create a new record
	 */
	create: <
		TInput extends CreateInputBase<
			CollectionInsert<TCollection>,
			ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>
		>,
	>(
		data: CreateInputWithRelations<
			CollectionInsert<TCollection>,
			ResolveRelationsDeep<TCollection["state"]["relations"], TCollections>,
			TInput
		>,
	) => Promise<CollectionSelect<TCollection>>;
	/**
	 * Update a single record by ID
	 */
	update: (
		id: string,
		data: UpdateParams<CollectionUpdate<TCollection>>["data"],
	) => Promise<CollectionSelect<TCollection>>;

	/**
	 * Delete a single record by ID
	 */
	delete: (id: string) => Promise<{ success: boolean }>;

	/**
	 * Restore a soft-deleted record by ID
	 */
	restore: (id: string) => Promise<CollectionSelect<TCollection>>;
} & CollectionFunctionsAPI<TCollection>;

/**
 * Collections API proxy with type-safe collection methods
 */
type CollectionsAPI<T extends QCMS> = {
	[K in keyof T["config"]["collections"]]: CollectionAPI<
		GetCollection<T["config"]["collections"], K>,
		T["config"]["collections"]
	>;
};

/**
 * Type-safe global API for a single global
 */
type GlobalAPI<
	TGlobal extends AnyGlobal,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = {
	/**
	 * Get the global record (singleton)
	 * Supports partial selection and relation loading
	 */
	get: <
		TQuery extends {
			with?: With<
				ResolveRelationsDeep<TGlobal["state"]["relations"], TCollections>
			>;
			columns?: any;
		},
	>(
		options?: TQuery,
	) => Promise<
		ApplyQuery<
			GlobalSelect<TGlobal>,
			ResolveRelationsDeep<TGlobal["state"]["relations"], TCollections>,
			TQuery
		>
	>;

	/**
	 * Update the global record
	 * Supports loading relations in response
	 */
	update: <
		TQuery extends {
			with?: With<
				ResolveRelationsDeep<TGlobal["state"]["relations"], TCollections>
			>;
		},
	>(
		data: GlobalUpdate<TGlobal>,
		options?: TQuery,
	) => Promise<
		ApplyQuery<
			GlobalSelect<TGlobal>,
			ResolveRelationsDeep<TGlobal["state"]["relations"], TCollections>,
			TQuery
		>
	>;
} & GlobalFunctionsAPI<TGlobal>;

/**
 * Globals API proxy with type-safe global methods
 */
type GlobalsAPI<T extends QCMS> = {
	[K in keyof NonNullable<T["config"]["globals"]>]: GlobalAPI<
		GetGlobal<NonNullable<T["config"]["globals"]>, K>,
		T["config"]["collections"]
	>;
};

/**
 * QCMS Client
 */
export type QCMSClient<T extends QCMS> = {
	collections: CollectionsAPI<T>;
	globals: GlobalsAPI<T>;
	functions: RootFunctionsAPI<T>;
	setLocale?: (locale?: string) => void;
	getLocale?: () => string | undefined;
};

/**
 * Create type-safe QUESTPIE CMS client
 *
 * @example
 * ```ts
 * import { createQCMSClient } from '@questpie/cms/client'
 * import type { cms } from './server'
 *
 * const client = createQCMSClient<typeof cms>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Type-safe collections
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Type-safe functions
 * const result = await client.functions.addToCart({ productId: '123' })
 * ```
 */
export function createQCMSClient<T extends QCMS>(
	config: QCMSClientConfig,
): QCMSClient<T> {
	const fetcher = config.fetch || globalThis.fetch;
	const basePath = config.basePath ?? "/cms";
	const normalizedBasePath = basePath.startsWith("/")
		? basePath
		: `/${basePath}`;
	const trimmedBasePath = normalizedBasePath.replace(/\/$/, "");
	const cmsBasePath =
		trimmedBasePath.endsWith("/cms") || trimmedBasePath === "/cms"
			? trimmedBasePath
			: `${trimmedBasePath}/cms`;
	const defaultHeaders = config.headers || {};
	let currentLocale: string | undefined =
		defaultHeaders["accept-language"] ?? defaultHeaders["Accept-Language"];

	/**
	 * Make a request to the CMS API
	 */
	async function request(
		path: string,
		options: RequestInit = {},
	): Promise<any> {
		const url = `${config.baseURL}${path}`;
		const headers = {
			"Content-Type": "application/json",
			...defaultHeaders,
			...options.headers,
		};

		const response = await fetcher(url, {
			...options,
			headers,
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => undefined);
			const message =
				errorData &&
				typeof errorData === "object" &&
				"error" in errorData &&
				typeof (errorData as { error?: unknown }).error === "string"
					? (errorData as { error: string }).error
					: `Request failed: ${response.statusText}`;

			throw new QCMSClientError({
				message,
				status: response.status,
				statusText: response.statusText,
				data: errorData,
				url,
			});
		}

		return response.json();
	}

	/**
	 * Collections API
	 */
	const collections = new Proxy({} as CollectionsAPI<T>, {
		get(_, collectionName: string) {
			const base = {
				find: async (options: any = {}) => {
					// Use qs for cleaner query strings with nested objects
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});

					const path = `${cmsBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;

					return request(path);
				},

				findOne: async (options: any) => {
					const where = options.where;
					if (!where.id) {
						throw new Error("findOne requires where.id");
					}

					// Use qs for query string
					const queryString = qs.stringify(
						{
							with: options.with,
							includeDeleted: options.includeDeleted,
						},
						{
							skipNulls: true,
							arrayFormat: "brackets",
						},
					);

					const path = `${cmsBasePath}/${collectionName}/${where.id}${queryString ? `?${queryString}` : ""}`;

					return request(path);
				},

				create: async (data: any) => {
					return request(`${cmsBasePath}/${collectionName}`, {
						method: "POST",
						body: JSON.stringify(data),
					});
				},

				update: async (id: string, data: any) => {
					return request(`${cmsBasePath}/${collectionName}/${id}`, {
						method: "PATCH",
						body: JSON.stringify(data),
					});
				},

				delete: async (id: string) => {
					return request(`${cmsBasePath}/${collectionName}/${id}`, {
						method: "DELETE",
					});
				},

				restore: async (id: string) => {
					return request(`${cmsBasePath}/${collectionName}/${id}/restore`, {
						method: "POST",
					});
				},
			};

			return new Proxy(base as any, {
				get(target, prop) {
					if (prop in target) return target[prop];
					if (typeof prop !== "string") return undefined;
					return async (input: any) => {
						return request(
							`${cmsBasePath}/collections/${collectionName}/rpc/${prop}`,
							{
								method: "POST",
								body: JSON.stringify(input),
							},
						);
					};
				},
			});
		},
	});

	/**
	 * Globals API
	 */
	const globals = new Proxy({} as GlobalsAPI<T>, {
		get(_, globalName: string) {
			const base = {
				get: async (options: { with?: any; columns?: any } = {}) => {
					const queryString = qs.stringify(
						{
							with: options.with,
							columns: options.columns,
						},
						{ skipNulls: true, arrayFormat: "brackets" },
					);
					const path = `${cmsBasePath}/globals/${globalName}${queryString ? `?${queryString}` : ""}`;
					return request(path);
				},

				update: async (data: any, options: { with?: any } = {}) => {
					const queryString = qs.stringify(
						{ with: options.with },
						{ skipNulls: true, arrayFormat: "brackets" },
					);
					return request(
						`${cmsBasePath}/globals/${globalName}${queryString ? `?${queryString}` : ""}`,
						{
							method: "PATCH",
							body: JSON.stringify(data),
						},
					);
				},
			};

			return new Proxy(base as any, {
				get(target, prop) {
					if (prop in target) return target[prop];
					if (typeof prop !== "string") return undefined;
					return async (input: any) => {
						return request(`${cmsBasePath}/globals/${globalName}/rpc/${prop}`, {
							method: "POST",
							body: JSON.stringify(input),
						});
					};
				},
			});
		},
	});

	/**
	 * Root functions API
	 */
	const functions = new Proxy({} as RootFunctionsAPI<T>, {
		get(_, functionName: string) {
			return async (input: any) => {
				return request(`${cmsBasePath}/rpc/${functionName}`, {
					method: "POST",
					body: JSON.stringify(input),
				});
			};
		},
	});

	return {
		collections,
		globals,
		functions,
		setLocale: (locale?: string) => {
			currentLocale = locale;
			if (locale) {
				defaultHeaders["accept-language"] = locale;
				delete defaultHeaders["Accept-Language"];
			} else {
				delete defaultHeaders["accept-language"];
				delete defaultHeaders["Accept-Language"];
			}
		},
		getLocale: () => currentLocale,
	};
}
