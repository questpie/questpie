import type { QCMS } from "../server/index.js";
import type {
	CollectionSelect,
	CollectionInsert,
	CollectionUpdate,
	Collection,
	CollectionBuilder,
} from "../server/collection/builder/collection.js";
import type {
	AnyCollectionState,
	RelationConfig,
} from "../server/collection/builder/types.js";
import type {
	FindManyOptions,
	FindFirstOptions,
	PaginatedResult,
	ApplyQuery,
	CreateInput,
	UpdateParams,
	DeleteParams,
} from "../server/collection/crud/types.js";
import qs from "qs";

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
	 * @default '/api'
	 */
	basePath?: string;

	/**
	 * Default headers to include in all requests
	 */
	headers?: Record<string, string>;
};

/**
 * Extract collection names from QCMS type
 */
type CollectionNames<T> = T extends QCMS<infer TCollections, any, any>
	? TCollections[number] extends
			| Collection<infer TState>
			| CollectionBuilder<infer TState>
		? TState extends AnyCollectionState
			? TState["name"]
			: never
		: never
	: never;

/**
 * Extract collection state by name
 */
type GetCollectionState<T, Name extends string> = T extends QCMS<
	infer TCollections,
	any,
	any
>
	? Extract<TCollections[number], { name: Name }> extends infer C
		? C extends Collection<infer TState>
			? TState
			: C extends CollectionBuilder<infer TState>
				? TState
				: never
		: never
	: never;

// Helper type to extract collection from builder or collection
type ExtractCollection<T> =
	T extends CollectionBuilder<infer TState> ? Collection<TState> : T;

// Helper type to find a collection by name in the tuple
type GetCollection<
	TCollections extends any[],
	Name extends string,
> = ExtractCollection<Extract<TCollections[number], { name: Name }>>;

/**
 * Resolve relations from config to actual types
 */
type ResolveRelations<
	TRelations extends Record<string, RelationConfig>,
	TCollections extends any[],
> = {
	[K in keyof TRelations]: TRelations[K] extends {
		type: "many" | "manyToMany";
		collection: infer C extends string;
	}
		? GetCollection<TCollections, C> extends never
			? never
			: GetCollection<TCollections, C>["$infer"]["select"][]
		: TRelations[K] extends {
					type: "one";
					collection: infer C extends string;
				}
			? GetCollection<TCollections, C> extends never
				? never
				: GetCollection<TCollections, C>["$infer"]["select"]
			: never;
};

/**
 * Type-safe collection API for a single collection
 */
type CollectionAPI<
	TState extends AnyCollectionState,
	TCollections extends any[],
> = {
	/**
	 * Find many records (paginated)
	 */
	find: <
		TQuery extends FindManyOptions<
			CollectionSelect<TState>,
			ResolveRelations<TState["relations"], TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<
		PaginatedResult<
			ApplyQuery<
				CollectionSelect<TState>,
				ResolveRelations<TState["relations"], TCollections>,
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
			CollectionSelect<TState>,
			ResolveRelations<TState["relations"], TCollections>
		> & { where: { id: string } },
	>(
		options: TQuery,
	) => Promise<
		ApplyQuery<
			CollectionSelect<TState>,
			ResolveRelations<TState["relations"], TCollections>,
			TQuery
		> | null
	>;

	/**
	 * Create a new record
	 */
	create: (
		data: CreateInput<
			CollectionInsert<TState>,
			ResolveRelations<TState["relations"], TCollections>
		>,
	) => Promise<CollectionSelect<TState>>;

	/**
	 * Update a single record by ID
	 */
	update: (
		id: string,
		data: UpdateParams<CollectionUpdate<TState>>["data"],
	) => Promise<CollectionSelect<TState>>;

	/**
	 * Delete a single record by ID
	 */
	delete: (id: string) => Promise<{ success: boolean }>;
};

/**
 * Collections API proxy with type-safe collection methods
 */
type CollectionsAPI<T> = T extends QCMS<infer TCollections, any, any>
	? {
			[K in CollectionNames<T>]: GetCollectionState<T, K> extends never
				? never
				: CollectionAPI<GetCollectionState<T, K>, TCollections>;
		}
	: never;

/**
 * QCMS Client
 */
export type QCMSClient<T = any> = {
	collections: CollectionsAPI<T>;
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
export function createQCMSClient<T = any>(config: QCMSClientConfig): QCMSClient<T> {
	const fetcher = config.fetch || globalThis.fetch;
	const basePath = config.basePath || "/api";
	const defaultHeaders = config.headers || {};

	/**
	 * Make a request to the CMS API
	 */
	async function request(path: string, options: RequestInit = {}): Promise<any> {
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
			const error = await response.json().catch(() => ({ error: response.statusText }));
			throw new Error(error.error || `Request failed: ${response.statusText}`);
		}

		return response.json();
	}

	/**
	 * Collections API
	 */
	const collections = new Proxy({} as CollectionsAPI<T>, {
		get(_, collectionName: string) {
			return {
				find: async (options = {}) => {
					// Use qs for cleaner query strings with nested objects
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});

					const path = `${basePath}/cms/${collectionName}${queryString ? `?${queryString}` : ""}`;

					return request(path);
				},

				findOne: async (options) => {
					const where = options.where;
					if (!where.id) {
						throw new Error("findOne requires where.id");
					}

					// Use qs for query string
					const queryString = qs.stringify(
						{ with: options.with },
						{
							skipNulls: true,
							arrayFormat: "brackets",
						},
					);

					const path = `${basePath}/cms/${collectionName}/${where.id}${queryString ? `?${queryString}` : ""}`;

					return request(path);
				},

				create: async (data) => {
					return request(`${basePath}/cms/${collectionName}`, {
						method: "POST",
						body: JSON.stringify(data),
					});
				},

				update: async (id, data) => {
					return request(`${basePath}/cms/${collectionName}/${id}`, {
						method: "PATCH",
						body: JSON.stringify(data),
					});
				},

				delete: async (id) => {
					return request(`${basePath}/cms/${collectionName}/${id}`, {
						method: "DELETE",
					});
				},
			};
		},
	});

	return {
		collections,
	};
}
