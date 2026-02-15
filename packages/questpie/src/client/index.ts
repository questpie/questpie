import qs from "qs";
import superjson from "superjson";
import { createRealtimeAPI, type RealtimeAPI } from "./realtime/index.js";
import type {
	ExtractJsonFunctions,
	InferFunctionInput,
	InferFunctionOutput,
	JsonFunctionDefinition,
} from "#questpie/server/functions/types.js";
import type { GlobalSchema } from "#questpie/server/global/introspection.js";
import type {
	AnyCollection,
	AnyCollectionOrBuilder,
	CollectionFunctions,
	CollectionInsert,
	CollectionRelations,
	CollectionSelect,
	CollectionUpdate,
	GetCollection,
	GlobalFunctions,
	GlobalRelations,
	GlobalSelect,
	GlobalUpdate,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";
import type {
	ApplyQuery,
	CreateInputBase,
	CreateInputWithRelations,
	FindManyOptions,
	FindOneOptionsBase,
	PaginatedResult,
	UpdateInput,
	Where,
	With,
} from "../server/collection/crud/types.js";
import type { GlobalUpdateInput } from "../server/global/crud/types.js";

// ============================================================================
// Upload Types
// ============================================================================

/**
 * Options for file upload with progress tracking
 */
export interface UploadOptions {
	/**
	 * Progress callback (0-100)
	 */
	onProgress?: (progress: number) => void;

	/**
	 * Abort signal for cancellation
	 */
	signal?: AbortSignal;
}

/**
 * Options for uploading multiple files
 */
export interface UploadManyOptions extends UploadOptions {
	/**
	 * Progress callback receives overall progress (0-100)
	 * and optionally individual file index
	 */
	onProgress?: (progress: number, fileIndex?: number) => void;
}

type LocaleOptions = {
	locale?: string;
	localeFallback?: boolean;
};

/**
 * Upload error with additional context
 */
export class UploadError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly response?: unknown,
	) {
		super(message);
		this.name = "UploadError";
	}
}

import type {
	AnyGlobal,
	GetGlobal,
	Questpie,
} from "#questpie/exports/index.js";
import type { CollectionSchema } from "#questpie/server/collection/introspection.js";
import type { CollectionMeta } from "#questpie/shared/collection-meta.js";
import type { ApiErrorShape } from "#questpie/shared/error-types.js";
import type { GlobalMeta } from "#questpie/shared/global-meta.js";

/**
 * Type-safe client error with support for ApiErrorShape
 */
export class QuestpieClientError extends Error {
	public readonly status: number;
	public readonly statusText: string;
	public readonly url: string;

	// Type-safe error data from server
	public readonly code?: ApiErrorShape["code"];
	public readonly fieldErrors?: ApiErrorShape["fieldErrors"];
	public readonly context?: ApiErrorShape["context"];
	public readonly serverData?: unknown; // Raw server response

	constructor(options: {
		message: string;
		status: number;
		statusText: string;
		data?: unknown;
		url: string;
	}) {
		super(options.message);
		this.name = "QuestpieClientError";
		this.status = options.status;
		this.statusText = options.statusText;
		this.url = options.url;
		this.serverData = options.data;

		// Extract typed error data if present
		if (this.isApiError(options.data)) {
			this.code = options.data.code;
			this.fieldErrors = options.data.fieldErrors;
			this.context = options.data.context;
		}
	}

	private isApiError(data: unknown): data is ApiErrorShape {
		return (
			typeof data === "object" &&
			data !== null &&
			"code" in data &&
			"message" in data
		);
	}

	/**
	 * Check if this is a specific error code
	 * @example
	 * if (error.isCode('FORBIDDEN')) { ... }
	 */
	isCode(code: ApiErrorShape["code"]): boolean {
		return this.code === code;
	}

	/**
	 * Get field error for specific path
	 * @example
	 * const emailError = error.getFieldError('email');
	 */
	getFieldError(path: string) {
		return this.fieldErrors?.find((err) => err.path === path);
	}

	/**
	 * Get all field errors as object
	 * @example
	 * const errors = error.getFieldErrorsMap();
	 * // { email: ['Invalid format'], password: ['Too short'] }
	 */
	getFieldErrorsMap(): Record<string, string[]> {
		if (!this.fieldErrors) return {};

		const map: Record<string, string[]> = {};
		for (const err of this.fieldErrors) {
			if (!map[err.path]) map[err.path] = [];
			map[err.path].push(err.message);
		}
		return map;
	}
}

/**
 * Client configuration
 */
export type QuestpieClientConfig = {
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

	/**
	 * Enable SuperJSON serialization for enhanced type support (Date, Map, Set, BigInt)
	 * When enabled, adds X-SuperJSON header and uses SuperJSON for request/response serialization
	 * @default true
	 */
	useSuperJSON?: boolean;
};

type JsonFunctionCaller<TDefinition extends JsonFunctionDefinition<any, any>> =
	(
		input: InferFunctionInput<TDefinition>,
	) => Promise<InferFunctionOutput<TDefinition>>;

type RpcClientAPI<TRouter> =
	TRouter extends Record<string, any>
		? {
				[K in keyof TRouter]: TRouter[K] extends JsonFunctionDefinition<
					any,
					any
				>
					? JsonFunctionCaller<TRouter[K]>
					: TRouter[K] extends Record<string, any>
						? RpcClientAPI<TRouter[K]>
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
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<
		PaginatedResult<
			ApplyQuery<
				CollectionSelect<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
				TQuery
			>
		>
	>;

	/**
	 * Count records matching query
	 */
	count: (options?: {
		where?: FindManyOptions<
			CollectionSelect<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>["where"];
		includeDeleted?: boolean;
	}) => Promise<number>;

	/**
	 * Find single record matching query
	 * Accepts any where clause - optimizes to /:id endpoint when only id is provided
	 */
	findOne: <
		TQuery extends FindOneOptionsBase<
			CollectionSelect<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<ApplyQuery<
		CollectionSelect<TCollection>,
		ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
		TQuery
	> | null>;

	/**
	 * Create a new record
	 */
	create: <
		TInput extends CreateInputBase<
			CollectionInsert<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		data: CreateInputWithRelations<
			CollectionInsert<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			TInput
		>,
		options?: LocaleOptions,
	) => Promise<CollectionSelect<TCollection>>;
	/**
	 * Update a single record by ID
	 */
	update: (
		params: {
			id: string;
			data: UpdateInput<
				CollectionUpdate<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			>;
		},
		options?: LocaleOptions,
	) => Promise<CollectionSelect<TCollection>>;

	/**
	 * Delete a single record by ID
	 */
	delete: (
		params: { id: string },
		options?: LocaleOptions,
	) => Promise<{ success: boolean }>;

	/**
	 * Restore a soft-deleted record by ID
	 */
	restore: (
		params: { id: string },
		options?: LocaleOptions,
	) => Promise<CollectionSelect<TCollection>>;

	/**
	 * Update multiple records matching a where clause
	 */
	updateMany: (
		params: {
			where: Where<
				CollectionSelect<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			>;
			data: UpdateInput<
				CollectionUpdate<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			>;
		},
		options?: LocaleOptions,
	) => Promise<CollectionSelect<TCollection>[]>;

	/**
	 * Delete multiple records matching a where clause
	 */
	deleteMany: (
		params: {
			where: Where<
				CollectionSelect<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			>;
		},
		options?: LocaleOptions,
	) => Promise<{ success: boolean; count: number }>;

	/**
	 * Upload a file to this collection (requires .upload() enabled on collection)
	 * Uses XMLHttpRequest for progress tracking
	 */
	upload: (file: File, options?: UploadOptions) => Promise<any>;

	/**
	 * Upload multiple files to this collection
	 * Files are uploaded sequentially with combined progress tracking
	 */
	uploadMany: (files: File[], options?: UploadManyOptions) => Promise<any[]>;

	/**
	 * Get collection metadata (schema info, title field, timestamps, etc.)
	 * Useful for building dynamic UIs that adapt to collection configuration
	 */
	meta: () => Promise<CollectionMeta>;

	/**
	 * Get collection schema with full introspection (fields, relations, access, validation)
	 * Includes evaluated access control for the current user and JSON Schema for validation
	 */
	schema: () => Promise<CollectionSchema>;
} & CollectionFunctionsAPI<TCollection>;

/**
 * Collections API proxy with type-safe collection methods
 */
type CollectionsAPI<T extends Questpie> = {
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
			with?: With<ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>>;
			columns?: any;
			locale?: string;
			localeFallback?: boolean;
		},
	>(
		options?: TQuery,
	) => Promise<
		ApplyQuery<
			GlobalSelect<TGlobal>,
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>,
			TQuery
		>
	>;

	/**
	 * Update the global record
	 * Supports loading relations in response and nested relation mutations
	 */
	update: <
		TQuery extends {
			with?: With<ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>>;
			locale?: string;
			localeFallback?: boolean;
		},
	>(
		data: GlobalUpdateInput<
			GlobalUpdate<TGlobal>,
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>
		>,
		options?: TQuery,
	) => Promise<
		ApplyQuery<
			GlobalSelect<TGlobal>,
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>,
			TQuery
		>
	>;

	/**
	 * Get global schema with full introspection (fields, access, validation)
	 */
	schema: () => Promise<GlobalSchema>;

	/**
	 * Get global metadata (timestamps, versioning, localized fields)
	 */
	meta: () => Promise<GlobalMeta>;
} & GlobalFunctionsAPI<TGlobal>;

/**
 * Globals API proxy with type-safe global methods
 */
type GlobalsAPI<T extends Questpie> = {
	[K in keyof NonNullable<T["config"]["globals"]>]: GlobalAPI<
		GetGlobal<NonNullable<T["config"]["globals"]>, K>,
		T["config"]["collections"]
	>;
};

// ============================================================================
// Search Types
// ============================================================================

/**
 * Facet definition for search queries
 */
export interface SearchFacetDefinition {
	field: string;
	limit?: number;
	sortBy?: "count" | "alpha";
}

/**
 * Search query options
 */
export interface SearchOptions {
	query: string;
	collections?: string[];
	locale?: string;
	limit?: number;
	offset?: number;
	mode?: "lexical" | "semantic" | "hybrid";
	filters?: Record<string, string | string[]>;
	highlights?: boolean;
	facets?: SearchFacetDefinition[];
}

/**
 * Search metadata attached to populated records
 */
export interface SearchMeta {
	/** Relevance score from search */
	score: number;
	/** Highlighted snippets with <mark> tags */
	highlights?: {
		title?: string;
		content?: string;
	};
	/** Title as stored in search index */
	indexedTitle: string;
	/** Content preview from search index */
	indexedContent?: string;
}

/**
 * Populated search result - full record with search metadata
 */
export type PopulatedSearchResult<T = Record<string, any>> = T & {
	/** Collection name */
	_collection: string;
	/** Search metadata */
	_search: SearchMeta;
};

/**
 * Facet value with count
 */
export interface SearchFacetValue {
	value: string;
	count: number;
}

/**
 * Facet result
 */
export interface SearchFacetResult {
	field: string;
	values: SearchFacetValue[];
	stats?: {
		min: number;
		max: number;
	};
}

/**
 * Search response with populated records
 * Returns full records (with hooks applied) plus search metadata
 */
export interface SearchResponse<T = Record<string, any>> {
	/** Full records with search metadata */
	docs: PopulatedSearchResult<T>[];
	/** Total count (accurate after access filtering) */
	total: number;
	/** Facet results (if requested) */
	facets?: SearchFacetResult[];
}

/**
 * Search API
 */
type SearchAPI = {
	/**
	 * Search across collections
	 */
	search: (options: SearchOptions) => Promise<SearchResponse>;

	/**
	 * Reindex a collection
	 */
	reindex: (
		collection: string,
	) => Promise<{ success: boolean; collection: string }>;
};

/**
 * Questpie Client
 */
export type QuestpieClient<
	TCMS extends Questpie<any>,
	TRPC extends Record<string, any> = Record<string, never>,
> = {
	collections: CollectionsAPI<TCMS>;
	globals: GlobalsAPI<TCMS>;
	rpc: RpcClientAPI<TRPC>;
	search: SearchAPI;
	realtime: RealtimeAPI;
	setLocale?: (locale?: string) => void;
	getLocale?: () => string | undefined;
	getBasePath?: () => string;
};

/**
 * Create type-safe QUESTPIE CMS client
 *
 * @example
 * ```ts
 * import { createClient } from 'questpie/client'
 * import type { cms } from './server'
 *
 * const client = createClient<typeof cms>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Type-safe collections
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Type-safe RPC
 * const result = await client.rpc.addToCart({ productId: '123' })
 * ```
 */
export function createClient<
	TCMS extends Questpie<any>,
	TRPC extends Record<string, any> = Record<string, never>,
>(config: QuestpieClientConfig): QuestpieClient<TCMS, TRPC> {
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
		const useSuperJSON = config.useSuperJSON !== false; // default true

		const contentType = useSuperJSON
			? "application/superjson+json"
			: "application/json";

		const headers: Record<string, string> = {
			"Content-Type": contentType,
			...defaultHeaders,
			...(options.headers as Record<string, string>),
		};

		if (useSuperJSON) {
			headers["X-SuperJSON"] = "1";
		}

		// Serialize body with SuperJSON if enabled
		let body = options.body;
		if (body && typeof body === "string" && useSuperJSON) {
			try {
				const parsed = JSON.parse(body);
				body = superjson.stringify(parsed);
			} catch {
				// If parsing fails, keep original body
			}
		}

		const response = await fetcher(url, {
			...options,
			headers,
			body,
			credentials: "include", // Ensure cookies are sent with requests
		});

		if (!response.ok) {
			// Try to parse error response (could be SuperJSON or regular JSON)
			let errorData: any;
			try {
				const responseContentType = response.headers.get("Content-Type");
				const text = await response.text();
				if (text) {
					errorData = responseContentType?.includes("superjson")
						? superjson.parse(text)
						: JSON.parse(text);
				}
			} catch {
				errorData = undefined;
			}

			// Extract error from { error: ApiErrorShape } format
			const cmsError =
				errorData &&
				typeof errorData === "object" &&
				"error" in errorData &&
				typeof errorData.error === "object"
					? (errorData.error as ApiErrorShape)
					: undefined;

			const message =
				cmsError?.message ||
				(typeof errorData === "object" &&
				errorData &&
				"error" in errorData &&
				typeof (errorData as { error?: unknown }).error === "string"
					? (errorData as { error: string }).error
					: `Request failed: ${response.statusText}`);

			throw new QuestpieClientError({
				message,
				status: response.status,
				statusText: response.statusText,
				data: cmsError, // Pass the ApiErrorShape (not the wrapper)
				url,
			});
		}

		// Parse successful response (could be SuperJSON or regular JSON)
		const responseContentType = response.headers.get("Content-Type");
		const text = await response.text();
		if (!text) return undefined;

		return responseContentType?.includes("superjson")
			? superjson.parse(text)
			: JSON.parse(text);
	}

	/**
	 * Collections API
	 */
	const collections = new Proxy({} as CollectionsAPI<TCMS>, {
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

				count: async (options: any = {}) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});

					const path = `${cmsBasePath}/${collectionName}/count${queryString ? `?${queryString}` : ""}`;
					const result = await request(path);
					return result.count;
				},

				findOne: async (options: any = {}) => {
					const where = options?.where;

					// Optimization: if only id is provided in where, use the /:id endpoint
					if (where?.id && Object.keys(where).length === 1) {
						const queryString = qs.stringify(
							{
								with: options.with,
								columns: options.columns,
								includeDeleted: options.includeDeleted,
								locale: options.locale,
								localeFallback: options.localeFallback,
							},
							{
								skipNulls: true,
								arrayFormat: "brackets",
							},
						);

						const path = `${cmsBasePath}/${collectionName}/${where.id}${queryString ? `?${queryString}` : ""}`;
						return request(path);
					}

					// Otherwise use find with limit=1
					const queryString = qs.stringify(
						{ ...options, limit: 1 },
						{
							skipNulls: true,
							arrayFormat: "brackets",
						},
					);

					const path = `${cmsBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					const result = await request(path);
					return result?.docs?.[0] ?? null;
				},

				create: async (data: any, options: LocaleOptions = {}) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "POST",
						body: JSON.stringify(data),
					});
				},

				update: async (
					{ id, data }: { id: string; data: any },
					options: LocaleOptions = {},
				) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}/${id}${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "PATCH",
						body: JSON.stringify(data),
					});
				},

				delete: async ({ id }: { id: string }, options: LocaleOptions = {}) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}/${id}${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "DELETE",
					});
				},

				restore: async (
					{ id }: { id: string },
					options: LocaleOptions = {},
				) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}/${id}/restore${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "POST",
					});
				},

				updateMany: async (
					{ where, data }: { where: any; data: any },
					options: LocaleOptions = {},
				) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "PATCH",
						body: JSON.stringify({ where, data }),
					});
				},

				deleteMany: async (
					{ where }: { where: any },
					options: LocaleOptions = {},
				) => {
					const queryString = qs.stringify(options, {
						skipNulls: true,
						arrayFormat: "brackets",
					});
					const path = `${cmsBasePath}/${collectionName}/delete-many${queryString ? `?${queryString}` : ""}`;
					return request(path, {
						method: "POST",
						body: JSON.stringify({ where }),
					});
				},

				meta: async () => {
					return request(`${cmsBasePath}/${collectionName}/meta`);
				},

				schema: async () => {
					return request(`${cmsBasePath}/${collectionName}/schema`);
				},

				upload: (file: File, options?: UploadOptions): Promise<any> => {
					return new Promise((resolve, reject) => {
						const xhr = new XMLHttpRequest();
						const url = `${config.baseURL}${cmsBasePath}/${collectionName}/upload`;

						// Named handlers for cleanup
						const handleProgress = (event: ProgressEvent) => {
							if (event.lengthComputable && options?.onProgress) {
								const percent = Math.round((event.loaded / event.total) * 100);
								options.onProgress(percent);
							}
						};

						const handleLoad = () => {
							cleanup();
							if (xhr.status >= 200 && xhr.status < 300) {
								try {
									const response = JSON.parse(xhr.responseText);
									resolve(response);
								} catch {
									reject(new UploadError("Invalid response from server"));
								}
							} else {
								let errorMessage = "Upload failed";
								try {
									const errorResponse = JSON.parse(xhr.responseText);
									errorMessage =
										errorResponse.error?.message ||
										errorResponse.message ||
										errorMessage;
									reject(
										new UploadError(errorMessage, xhr.status, errorResponse),
									);
								} catch {
									reject(new UploadError(errorMessage, xhr.status));
								}
							}
						};

						const handleError = () => {
							cleanup();
							reject(new UploadError("Network error during upload"));
						};

						const handleAbort = () => {
							cleanup();
							reject(new UploadError("Upload cancelled"));
						};

						const handleSignalAbort = () => {
							xhr.abort();
						};

						// Cleanup function to remove all listeners (prevents memory leaks)
						const cleanup = () => {
							xhr.upload.removeEventListener("progress", handleProgress);
							xhr.removeEventListener("load", handleLoad);
							xhr.removeEventListener("error", handleError);
							xhr.removeEventListener("abort", handleAbort);
							if (options?.signal) {
								options.signal.removeEventListener("abort", handleSignalAbort);
							}
						};

						// Setup event listeners
						xhr.upload.addEventListener("progress", handleProgress);
						xhr.addEventListener("load", handleLoad);
						xhr.addEventListener("error", handleError);
						xhr.addEventListener("abort", handleAbort);

						// Handle abort signal
						if (options?.signal) {
							options.signal.addEventListener("abort", handleSignalAbort);
						}

						// Prepare form data
						const formData = new FormData();
						formData.append("file", file);

						// Send request with credentials (cookies)
						xhr.open("POST", url);
						xhr.withCredentials = true;
						xhr.send(formData);
					});
				},

				uploadMany: async (
					files: File[],
					options?: UploadManyOptions,
				): Promise<any[]> => {
					if (files.length === 0) {
						return [];
					}

					const results: any[] = [];
					const totalFiles = files.length;

					for (let i = 0; i < totalFiles; i++) {
						const file = files[i];

						// Check if cancelled
						if (options?.signal?.aborted) {
							throw new UploadError("Upload cancelled");
						}

						const result = await base.upload(file, {
							signal: options?.signal,
							onProgress: (fileProgress: number) => {
								// Calculate overall progress
								const baseProgress = (i / totalFiles) * 100;
								const currentFileContribution = fileProgress / totalFiles;
								const overallProgress = Math.round(
									baseProgress + currentFileContribution,
								);
								options?.onProgress?.(overallProgress, i);
							},
						});

						results.push(result);
					}

					options?.onProgress?.(100);
					return results;
				},
			};

			return new Proxy(base as any, {
				get(target, prop) {
					// Check if property exists on base object
					if (Object.hasOwn(target, prop)) {
						return target[prop as keyof typeof target];
					}
					if (typeof prop !== "string") return undefined;
					// Fallback to RPC for custom functions
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
	const globals = new Proxy({} as GlobalsAPI<TCMS>, {
		get(_, globalName: string) {
			const base = {
				get: async (
					options: {
						with?: any;
						columns?: any;
						locale?: string;
						localeFallback?: boolean;
					} = {},
				) => {
					const queryString = qs.stringify(
						{
							with: options.with,
							columns: options.columns,
							locale: options.locale,
							localeFallback: options.localeFallback,
						},
						{ skipNulls: true, arrayFormat: "brackets" },
					);
					const path = `${cmsBasePath}/globals/${globalName}${queryString ? `?${queryString}` : ""}`;
					return request(path);
				},

				update: async (
					data: any,
					options: {
						with?: any;
						locale?: string;
						localeFallback?: boolean;
					} = {},
				) => {
					const queryString = qs.stringify(
						{
							with: options.with,
							locale: options.locale,
							localeFallback: options.localeFallback,
						},
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

				schema: async () => {
					return request(`${cmsBasePath}/globals/${globalName}/schema`);
				},

				meta: async () => {
					return request(`${cmsBasePath}/globals/${globalName}/meta`);
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

	const createRpcProcedureProxy = (segments: string[]): any => {
		const callable = async (input: any) => {
			return request(`${cmsBasePath}/rpc/${segments.join("/")}`, {
				method: "POST",
				body: JSON.stringify(input),
			});
		};

		return new Proxy(callable, {
			get(_, prop) {
				if (prop === "then") return undefined;
				if (typeof prop !== "string") return undefined;
				return createRpcProcedureProxy([...segments, prop]);
			},
			apply(_, __, args: unknown[]) {
				const input = args[0];
				return request(`${cmsBasePath}/rpc/${segments.join("/")}`, {
					method: "POST",
					body: JSON.stringify(input),
				});
			},
		});
	};

	const rpc = new Proxy({} as RpcClientAPI<TRPC>, {
		get(_, prop) {
			if (typeof prop !== "string") return undefined;
			return createRpcProcedureProxy([prop]);
		},
	});

	/**
	 * Search API
	 */
	const search: SearchAPI = {
		search: async (options: SearchOptions) => {
			return request(`${cmsBasePath}/search`, {
				method: "POST",
				body: JSON.stringify(options),
			});
		},

		reindex: async (collection: string) => {
			return request(`${cmsBasePath}/search/reindex/${collection}`, {
				method: "POST",
			});
		},
	};

	const realtimeApi = createRealtimeAPI({
		baseUrl: `${config.baseURL}${cmsBasePath}`,
		withCredentials: true,
		debounceMs: 50,
	});

	return {
		collections,
		globals,
		rpc,
		search,
		realtime: realtimeApi,
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
		getBasePath: () => cmsBasePath,
	};
}

// Re-export collection schema types for admin introspection
export type {
	AccessResult,
	CollectionAccessInfo,
	CollectionSchema,
	FieldAccessInfo,
	FieldReactiveSchema,
	FieldSchema,
	RelationSchema,
} from "#questpie/server/collection/introspection.js";
export type { GlobalSchema } from "#questpie/server/global/introspection.js";
// Re-export collection and global meta types
export type {
	CollectionFieldMeta,
	CollectionMeta,
	CollectionTitleMeta,
} from "#questpie/shared/collection-meta.js";
export type { GlobalMeta } from "#questpie/shared/global-meta.js";
// Re-export realtime types and helpers
export type { RealtimeAPI, TopicConfig, TopicInput } from "./realtime/index.js";
export { buildCollectionTopic, buildGlobalTopic } from "./realtime/index.js";
