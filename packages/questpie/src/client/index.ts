import type { GlobalSchema } from "#questpie/server/global/introspection.js";
import type {
	HttpMethod,
	InferRouteInput,
	InferRouteOutput,
	JsonRouteDefinition,
	RawRouteDefinition,
} from "#questpie/server/routes/types.js";
import { stringifyQuery } from "#questpie/shared/query-string.js";
import { attachTxid, QUESTPIE_TXID_HEADER } from "#questpie/shared/txid.js";
import type {
	AnyCollection,
	AnyCollectionOrBuilder,
	CollectionHasSoftDelete,
	CollectionInsert,
	CollectionRelations,
	CollectionState,
	CollectionUpdate,
	GetCollection,
	GlobalRelations,
	GlobalSelect,
	GlobalState,
	GlobalUpdate,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";
import {
	parseTypedWire,
	stringifyTypedWire,
} from "#questpie/shared/typed-wire.js";

import type { ChannelDefinitions } from "../server/channels/channel-builder.js";
import type {
	ApplyQuery,
	CollectionSelect as CollectionSelectFromApp,
	CreateInputBase,
	CreateInputWithRelations,
	DeleteManyParams,
	DeleteParams,
	ExpectedRevision,
	FindResult,
	FindManyOptions,
	FindOneOptionsBase,
	OrderBy,
	PurgeParams,
	RevertVersionOptions,
	RestoreParams,
	UpdateBatchParams,
	UpdateManyParams,
	UpdateParams,
	Where,
	With,
} from "../server/collection/crud/types.js";
import type { GlobalUpdateParams } from "../server/global/crud/types.js";
import type { CrdtRegistryShape } from "../server/modules/core/integrated/crdt/types.js";
import type { GetAuthHeaders } from "./auth.js";
import { createChannelsAPI, type ChannelsClient } from "./channels/index.js";
// NOTE: deliberately a type-only import. A value import of ./crdt/index.js
// pulls the whole 164 KB client CRDT implementation into every bundle — see
// ./crdt-host.ts for the measurement.
import { CRDT_CLIENT_HOST, type CrdtClientHostHandle } from "./crdt-host.js";
import {
	buildCollectionTopic,
	buildGlobalTopic,
	createRealtimeAPI,
	type RealtimeAPI,
} from "./realtime/index.js";
import { PusherConnectionManager } from "./realtime/pusher-connection.js";
import { createRealtimeClientSession } from "./realtime/session.js";
import { SseConnectionManager } from "./realtime/sse-connection.js";

export type { AuthHeaders, GetAuthHeaders } from "./auth.js";

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

	/**
	 * Optional destination path/folder for the uploaded file. Sent alongside the
	 * binary in form-data; the server spreads it onto the created record (e.g. an
	 * `assets` row's required `path`) so a blob upload can land inside a folder.
	 */
	path?: string;
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
	stage?: string;
};

export type CollectionTransitionStageInput<
	TOptions extends
		import("../server/collection/builder/types.js").CollectionOptions =
		import("../server/collection/builder/types.js").CollectionOptions,
> = {
	id: string;
	stage: string;
	scheduledAt?: string | Date;
} & (TOptions extends { optimisticConcurrency: true }
	? { expectedRevision: number }
	: { expectedRevision?: number });

export type GlobalTransitionStageInput<
	TOptions extends import("../server/global/builder/types.js").GlobalOptions =
		import("../server/global/builder/types.js").GlobalOptions,
> = {
	stage: string;
	scheduledAt?: string | Date;
} & (TOptions extends { optimisticConcurrency: true }
	? { expectedRevision: number }
	: { expectedRevision?: number });

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

import type { CollectionSchema } from "#questpie/server/collection/introspection.js";
import type { CollectionMeta } from "#questpie/shared/collection-meta.js";
import type { ApiErrorShape } from "#questpie/shared/error-types.js";
import type { GlobalMeta } from "#questpie/shared/global-meta.js";
import type { AnyGlobal, GetGlobal } from "#questpie/shared/type-utils.js";

/**
 * Minimal app type constraint for client APIs.
 * Generated `AppConfig` satisfies this — flat { collections, globals, routes, auth }.
 */
export interface QuestpieApp {
	collections: Record<string, AnyCollectionOrBuilder>;
	channels?: ChannelDefinitions;
	crdt?: CrdtRegistryShape;
	globals?: Record<string, any>;
	routes?: Record<string, any>;
	auth?: any;
}

type AppChannelDefinitions<TApp extends QuestpieApp> = 0 extends 1 & TApp
	? {}
	: NonNullable<TApp["channels"]> extends ChannelDefinitions
		? NonNullable<TApp["channels"]>
		: {};

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
type RawRouteRegistrationKeys<TRoutes> = string extends keyof TRoutes
	? string
	: {
			[K in keyof TRoutes & string]: K extends `${string}[${string}`
				? never
				: TRoutes[K] extends {
							mode: "raw";
							method: infer TMethod;
					  }
					? HttpMethod extends TMethod
						? never
						: K extends `${string}:${string}`
							? K
							: `${K}:${Extract<TMethod, HttpMethod>}`
					: never;
		}[keyof TRoutes & string];

type RawRouteRegistration<TApp extends QuestpieApp> =
	string extends RawRouteRegistrationKeys<NonNullable<TApp["routes"]>>
		? { rawRoutes?: Readonly<Record<string, true>> }
		: [RawRouteRegistrationKeys<NonNullable<TApp["routes"]>>] extends [never]
			? { rawRoutes?: undefined }
			: {
					rawRoutes: {
						readonly [K in RawRouteRegistrationKeys<
							NonNullable<TApp["routes"]>
						>]: true;
					};
				};

export type QuestpieRouteClientConfig<TApp extends QuestpieApp = QuestpieApp> =
	RawRouteRegistration<TApp>;

export type QuestpieClientConfig<TApp extends QuestpieApp = QuestpieApp> = {
	/**
	 * Base URL of the app API
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
	 * Use '/' for server-only apps or '/api' for fullstack apps.
	 * @default '/'
	 */
	basePath?: string;

	/**
	 * Default headers to include in all requests
	 */
	headers?: Record<string, string>;

	/**
	 * Resolve authentication headers for every request.
	 *
	 * The resolver runs immediately before data, upload, and realtime requests,
	 * so rotated bearer tokens do not require recreating the client. Resolved
	 * headers override matching static `headers`. Cookie credentials remain
	 * enabled when this hook is omitted or used.
	 */
	getAuthHeaders?: GetAuthHeaders;

	/**
	 * Enable SuperJSON serialization for enhanced type support (Date, Map, Set, BigInt)
	 * When enabled, adds X-SuperJSON header and uses SuperJSON for request/response serialization
	 * @default true
	 */
	useSuperJSON?: boolean;
} & QuestpieRouteClientConfig<TApp>;

/**
 * Caller for a JSON route — sends input, returns typed output.
 */
type JsonRouteCaller<TDef extends JsonRouteDefinition<any, any>> = (
	input: InferRouteInput<TDef>,
) => Promise<InferRouteOutput<TDef>>;

/**
 * Caller for a raw route — returns raw Response.
 */
type RawRouteCaller = (options?: RouteCallOptions) => Promise<Response>;

/**
 * Type-safe routes client API.
 *
 * Flat route keys like `"admin/stats"` are expanded into nested dot notation
 * with explicit HTTP method leaves
 * (`client.routes.admin.stats.post({ period: "week" })`) and literal keys only.
 * Unknown route names are compile errors.
 *
 * Untyped apps (`routes: Record<string, any>`) degrade to a permissive index
 * signature; apps without routes get `{}`.
 */
type RoutesClient<TRoutes> = [NonNullable<TRoutes>] extends [never]
	? {}
	: // No keys (apps without routes / missing `routes` member) → empty surface.
		// Guarded before ExpandRoutes: `UnionToIntersection<never>` is `unknown`.
		[keyof NonNullable<TRoutes>] extends [never]
		? {}
		: // Non-literal keys (untyped apps, `QuestpieClient<any>`) → permissive
			// surface that typed clients stay assignable to.
			string extends keyof NonNullable<TRoutes>
			? { [routeKey: string]: any }
			: [NonNullable<TRoutes>] extends [Record<string, any>]
				? ExpandRoutes<NonNullable<TRoutes>>
				: {};

/**
 * Expand flat route keys into nested structure.
 * `"admin/stats"` → `{ admin: { stats: { post: RouteLeaf } } }`
 * `"admin/stats:GET"` → `{ admin: { stats: { get: ... } } }`
 */
type ExpandRoutes<TRoutes extends Record<string, any>> = UnionToIntersection<
	{
		[K in keyof TRoutes & string]: ExpandKey<K, TRoutes[K]>;
	}[keyof TRoutes & string]
>;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
	k: infer I,
) => void
	? I
	: never;

/**
 * Expand a single route key into its nested shape.
 */
type ExpandKey<K extends string, TDef> = K extends `${infer Head}/${infer Rest}`
	? { [P in Head]: ExpandKey<Rest, TDef> }
	: K extends `${infer Path}:${infer Method}`
		? { [P in Path]: { [M in Lowercase<Method>]: RouteCallerFromDef<TDef> } }
		: { [P in K]: RouteMethodCallers<TDef> };

type RouteMethodNames<TMethod> = TMethod extends readonly (infer M)[]
	? Lowercase<Extract<M, HttpMethod>>
	: Lowercase<Extract<TMethod, HttpMethod>>;

type RouteMethodCallers<TDef> = TDef extends { method: infer TMethod }
	? { [M in RouteMethodNames<TMethod>]: RouteCallerFromDef<TDef> }
	: { post: RouteCallerFromDef<TDef> };

type RouteCallerFromDef<TDef> =
	TDef extends JsonRouteDefinition<any, any>
		? JsonRouteCaller<TDef>
		: TDef extends RawRouteDefinition<any, infer TMethod>
			? HttpMethod extends TMethod
				? (input?: unknown) => Promise<unknown>
				: RawRouteCaller
			: (input?: any) => Promise<any>;

/**
 * Options accepted by `live()` / `liveIter()` on collections — the subset of
 * `find()` options that the realtime wire protocol carries as topic fields
 * (`POST /realtime`). Same `where`/`with`/`orderBy` aliases as `find()`.
 *
 * Notably excludes `columns`, `groupBy`, `search`, etc. — snapshots are always
 * full query results re-run server-side from these fields.
 */
export type LiveQueryOptions<TSelect, TRelations> = {
	where?: Where<TSelect, TRelations>;
	with?: With<TRelations>;
	limit?: number;
	offset?: number;
	orderBy?: OrderBy<TSelect>;
	locale?: string;
};

/**
 * Options accepted by `live()` / `liveIter()` on globals — the subset of
 * `get()` options that the realtime wire protocol carries as topic fields.
 */
export type GlobalLiveQueryOptions<TRelations> = {
	with?: With<TRelations>;
	locale?: string;
};

/**
 * Lifecycle options for `live()` subscriptions.
 */
export type LiveSubscribeOptions = {
	/** Abort signal — unsubscribes when aborted. */
	signal?: AbortSignal;
	/** Called when the underlying SSE connection fails. */
	onError?: (error: Error) => void;
};

/**
 * Client-side output row for a collection.
 *
 * Unifies the client SDK row with the SERVER row: both resolve through the
 * app-aware `CollectionSelectFromApp` (2-arg field-def select) so the same
 * collection has ONE row type — readonly and module-aware on both surfaces —
 * instead of the legacy 1-arg Drizzle `$infer.select` rebuild (mutable,
 * module-blind) that drifted from the server (CL-10). The app shape mirrors the
 * server's `AppFromCollections<TCollections>` ({ collections: TCollections }).
 */
type ClientRow<
	TCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
> = CollectionSelectFromApp<TCollection, { collections: TCollections }>;

type ClientCollectionOptions<TCollection> =
	CollectionState<TCollection> extends {
		options: infer TOptions extends
			import("#questpie/server/collection/builder/types.js").CollectionOptions;
	}
		? TOptions
		: import("#questpie/server/collection/builder/types.js").CollectionOptions;

type CollectionPurgeAPI<TCollection> =
	CollectionHasSoftDelete<TCollection> extends true
		? {
				/**
				 * Permanently purge a soft-deleted record by ID.
				 *
				 * Purge has separate server authorization from delete and rejects
				 * active records. It intentionally has no alias.
				 */
				purgeById: (
					params: PurgeParams<string, ClientCollectionOptions<TCollection>>,
					options?: LocaleOptions,
				) => Promise<{ success: true }>;
			}
		: {};

/**
 * Type-safe collection API for a single collection
 */
type CollectionAPI<
	TCollection extends AnyCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	TDefinition = TCollection,
> = {
	/**
	 * Find many records (paginated)
	 */
	find: <
		TQuery extends FindManyOptions<
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<
		FindResult<
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			TQuery
		>
	>;

	/**
	 * Live form of `find()` — subscribes to access-controlled query snapshots
	 * pushed over the multiplexed SSE stream (`POST /realtime`). The first
	 * snapshot arrives immediately on connect; later snapshots whenever a
	 * matching record changes. Snapshot type equals the `find()` result type.
	 *
	 * Returns an unsubscribe function.
	 */
	live: <
		TQuery extends
			| LiveQueryOptions<
					ClientRow<TCollection, TCollections>,
					ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			  >
			| undefined,
	>(
		options: TQuery,
		onSnapshot: (
			snapshot: FindResult<
				ClientRow<TCollection, TCollections>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
				TQuery
			>,
		) => void,
		opts?: LiveSubscribeOptions,
	) => () => void;

	/**
	 * Async-iterable form of `live()` — yields the same snapshots as an
	 * AsyncGenerator (for workers, agents, tests). Terminate via `opts.signal`.
	 */
	liveIter: <
		TQuery extends LiveQueryOptions<
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		options?: TQuery,
		opts?: { signal?: AbortSignal },
	) => AsyncGenerator<
		FindResult<
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			TQuery
		>,
		void,
		unknown
	>;

	/**
	 * Count records matching query
	 */
	count: (options?: {
		where?: FindManyOptions<
			ClientRow<TCollection, TCollections>,
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
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
		>,
	>(
		options?: TQuery,
	) => Promise<ApplyQuery<
		ClientRow<TCollection, TCollections>,
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
	) => Promise<ClientRow<TCollection, TCollections>>;
	/**
	 * Update a single record by ID
	 * Canonical name — same vocabulary as server CRUD.
	 */
	updateById: (
		params: UpdateParams<
			CollectionUpdate<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			string,
			ClientCollectionOptions<TDefinition>
		>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Update a single record by ID
	 * Alias of {@link updateById} (note: server CRUD `update` is bulk-by-where).
	 */
	update: (
		params: UpdateParams<
			CollectionUpdate<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			string,
			ClientCollectionOptions<TDefinition>
		>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Delete a single record by ID
	 * Canonical name — same vocabulary as server CRUD.
	 */
	deleteById: (
		params: DeleteParams<string, ClientCollectionOptions<TDefinition>>,
		options?: LocaleOptions,
	) => Promise<{
		success: boolean;
		data: ClientRow<TCollection, TCollections>;
	}>;

	/**
	 * Delete a single record by ID
	 * Alias of {@link deleteById} (note: server CRUD `delete` is bulk-by-where).
	 */
	delete: (
		params: DeleteParams<string, ClientCollectionOptions<TDefinition>>,
		options?: LocaleOptions,
	) => Promise<{
		success: boolean;
		data: ClientRow<TCollection, TCollections>;
	}>;

	/**
	 * Restore a soft-deleted record by ID
	 * Canonical name — same vocabulary as server CRUD.
	 */
	restoreById: (
		params: RestoreParams<string, ClientCollectionOptions<TDefinition>>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Restore a soft-deleted record by ID
	 * Alias of {@link restoreById}.
	 */
	restore: (
		params: RestoreParams<string, ClientCollectionOptions<TDefinition>>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Find version history for a single record
	 */
	findVersions: (
		params: { id: string; limit?: number; offset?: number },
		options?: LocaleOptions,
	) => Promise<
		Array<
			ClientRow<TCollection, TCollections> & {
				versionId: string;
				versionNumber: number;
				sourceRevision: number | null;
				versionOperation: string;
				versionUserId: string | null;
				versionCreatedAt: Date;
			}
		>
	>;

	/**
	 * Revert a record to a specific version
	 */
	revertToVersion: (
		params: RevertVersionOptions<string, ClientCollectionOptions<TDefinition>>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Transition a record to a different workflow stage (no data mutation)
	 */
	transitionStage: (
		params: CollectionTransitionStageInput<
			ClientCollectionOptions<TDefinition>
		>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>>;

	/**
	 * Update multiple records matching a where clause
	 */
	updateMany: (
		params: UpdateManyParams<
			CollectionUpdate<TCollection>,
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			ClientCollectionOptions<TDefinition>
		>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>[]>;

	/**
	 * Update multiple records with distinct data per record
	 */
	updateBatch: (
		params: UpdateBatchParams<
			CollectionUpdate<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			string,
			ClientCollectionOptions<TDefinition>
		>,
		options?: LocaleOptions,
	) => Promise<ClientRow<TCollection, TCollections>[]>;

	/**
	 * Delete multiple records matching a where clause
	 */
	deleteMany: (
		params: DeleteManyParams<
			ClientRow<TCollection, TCollections>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			ClientCollectionOptions<TDefinition>
		>,
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
} & CollectionPurgeAPI<TDefinition>;

/**
 * Collections API proxy with type-safe collection methods
 */
type CollectionsAPI<T extends QuestpieApp> = {
	[K in keyof T["collections"]]: CollectionAPI<
		GetCollection<T["collections"], K>,
		T["collections"],
		T["collections"][K]
	>;
};

/**
 * One mutation inside `client.transaction()`, for a single collection.
 *
 * The payload of each arm is the SAME params type the single-record client
 * method takes — `UpdateParams` for update, `DeleteParams` for delete — so
 * `expectedRevision` stays required at the type level exactly where
 * `optimisticConcurrency` makes it required elsewhere, with no second
 * definition to drift.
 */
type TransactionOperationFor<
	TCollection extends AnyCollection,
	TCollections extends Record<string, AnyCollectionOrBuilder>,
	TName,
	TDefinition = TCollection,
> =
	| {
			collection: TName;
			operation: "create";
			data: CreateInputBase<
				CollectionInsert<TCollection>,
				ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>
			>;
	  }
	| ({ collection: TName; operation: "update" } & UpdateParams<
			CollectionUpdate<TCollection>,
			ResolveRelationsDeep<CollectionRelations<TCollection>, TCollections>,
			string,
			ClientCollectionOptions<TDefinition>
	  >)
	| ({ collection: TName; operation: "delete" } & DeleteParams<
			string,
			ClientCollectionOptions<TDefinition>
	  >);

type UntypedTransactionOperation =
	| {
			collection: string;
			operation: "create";
			data: Record<string, unknown>;
	  }
	| {
			collection: string;
			operation: "update";
			id: string;
			data: Record<string, unknown>;
			expectedRevision?: number;
	  }
	| {
			collection: string;
			operation: "delete";
			id: string;
			expectedRevision?: number;
	  };

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Every mutation any collection in the app accepts inside a transaction.
 *
 * `collection` and `operation` are both literal-typed, so a literal element
 * narrows to one arm through TypeScript's discriminated-union fast path rather
 * than a scan of the whole union.
 */
export type TransactionOperation<TApp extends QuestpieApp> =
	IsAny<TApp> extends true
		? UntypedTransactionOperation
		: {
				[K in keyof TApp["collections"]]: TransactionOperationFor<
					GetCollection<TApp["collections"], K>,
					TApp["collections"],
					K,
					TApp["collections"][K]
				>;
			}[keyof TApp["collections"]];

/**
 * Result of one operation, in the same shape the equivalent single-record
 * method returns: the row for create/update, `{ success, data }` for delete.
 */
type TransactionOperationResult<TApp extends QuestpieApp, TOperation> =
	IsAny<TApp> extends true
		? unknown
		: TOperation extends {
					collection: infer TName extends keyof TApp["collections"];
			  }
			? TOperation extends { operation: "delete" }
				? {
						success: boolean;
						data: ClientRow<
							GetCollection<TApp["collections"], TName>,
							TApp["collections"]
						>;
					}
				: ClientRow<
						GetCollection<TApp["collections"], TName>,
						TApp["collections"]
					>
			: never;

/**
 * Results positionally typed against the operations that produced them.
 *
 * Per-position inference needs the `const` type parameter on `transaction()`
 * and an array LITERAL at the call site; that combination infers a tuple. A
 * pre-built `TransactionOperation<TApp>[]` variable is an array, not a tuple,
 * so its result degrades to an array of the union of every row type the app
 * can produce. That is the documented limit of this surface — the degraded
 * form is still a real union, never `any`.
 */
export type TransactionResults<
	TApp extends QuestpieApp,
	TOperations extends readonly unknown[],
> = {
	-readonly [I in keyof TOperations]: TransactionOperationResult<
		TApp,
		TOperations[I]
	>;
};

type ValidateTransactionOperation<
	TApp extends QuestpieApp,
	TOperation,
> = TOperation extends {
	collection: infer TName extends keyof TApp["collections"];
}
	? TOperation extends TransactionOperationFor<
			GetCollection<TApp["collections"], TName>,
			TApp["collections"],
			TName,
			TApp["collections"][TName]
		>
		? TOperation
		: never
	: never;

type ValidateTransactionOperations<
	TApp extends QuestpieApp,
	TOperations extends readonly unknown[],
> = {
	[I in keyof TOperations]: ValidateTransactionOperation<TApp, TOperations[I]>;
};

type ClientTransaction<TApp extends QuestpieApp> =
	IsAny<TApp> extends true
		? (...args: any[]) => Promise<any>
		: <const TOperations extends readonly UntypedTransactionOperation[]>(
				operations: TOperations &
					ValidateTransactionOperations<TApp, TOperations>,
				options?: LocaleOptions,
			) => Promise<TransactionResults<TApp, TOperations>>;

type ClientGlobalOptions<TGlobal> =
	GlobalState<TGlobal> extends {
		options: infer TOptions extends
			import("../server/global/builder/types.js").GlobalOptions;
	}
		? TOptions
		: import("../server/global/builder/types.js").GlobalOptions;

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
			columns?: Record<string, boolean>;
			locale?: string;
			localeFallback?: boolean;
			stage?: string;
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
	 * Live form of `get()` — subscribes to access-controlled snapshots of the
	 * global pushed over the multiplexed SSE stream (`POST /realtime`).
	 * Snapshot type equals the `get()` result type.
	 *
	 * Returns an unsubscribe function.
	 */
	live: <
		TQuery extends
			| GlobalLiveQueryOptions<
					ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>
			  >
			| undefined,
	>(
		options: TQuery,
		onSnapshot: (
			snapshot: ApplyQuery<
				GlobalSelect<TGlobal>,
				ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>,
				TQuery
			>,
		) => void,
		opts?: LiveSubscribeOptions,
	) => () => void;

	/**
	 * Async-iterable form of `live()` — yields the same snapshots as an
	 * AsyncGenerator. Terminate via `opts.signal`.
	 */
	liveIter: <
		TQuery extends GlobalLiveQueryOptions<
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>
		>,
	>(
		options?: TQuery,
		opts?: { signal?: AbortSignal },
	) => AsyncGenerator<
		ApplyQuery<
			GlobalSelect<TGlobal>,
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>,
			TQuery
		>,
		void,
		unknown
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
			stage?: string;
		},
	>(
		data: GlobalUpdateParams<
			GlobalUpdate<TGlobal>,
			ResolveRelationsDeep<GlobalRelations<TGlobal>, TCollections>,
			ClientGlobalOptions<TGlobal>
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

	/**
	 * Find global version history
	 */
	findVersions: (options?: {
		id?: string;
		limit?: number;
		offset?: number;
		locale?: string;
		localeFallback?: boolean;
		stage?: string;
	}) => Promise<
		Array<
			GlobalSelect<TGlobal> & {
				versionId: string;
				versionNumber: number;
				sourceRevision: number | null;
				versionOperation: string;
				versionUserId: string | null;
				versionCreatedAt: Date;
			}
		>
	>;

	/**
	 * Revert global to a specific version
	 */
	revertToVersion: (
		params: {
			id?: string;
			version?: number;
			versionId?: string;
		} & (ClientGlobalOptions<TGlobal> extends { optimisticConcurrency: true }
			? { expectedRevision: number }
			: { expectedRevision?: number }),
		options?: {
			locale?: string;
			localeFallback?: boolean;
			stage?: string;
		},
	) => Promise<GlobalSelect<TGlobal>>;

	/**
	 * Transition global to a different workflow stage (no data mutation)
	 */
	transitionStage: (
		params: GlobalTransitionStageInput<ClientGlobalOptions<TGlobal>>,
		options?: {
			locale?: string;
			localeFallback?: boolean;
		},
	) => Promise<GlobalSelect<TGlobal>>;
};

/**
 * Globals API proxy with type-safe global methods
 */
type GlobalsAPI<T extends QuestpieApp> = {
	[K in keyof NonNullable<T["globals"]>]: GlobalAPI<
		GetGlobal<NonNullable<T["globals"]>, K>,
		T["collections"]
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
 * Options for calling a custom route.
 */
type RouteCallOptions = Omit<RequestInit, "method">;

/**
 * Questpie Client
 *
 * The app schema is invariant: client methods both consume schema-derived
 * inputs and return schema-derived outputs. Declaring that relationship keeps
 * app-agnostic client comparisons from recursively measuring the full API.
 */
export type QuestpieClient<in out TApp extends QuestpieApp> = {
	collections: CollectionsAPI<TApp>;
	/**
	 * Apply an ordered list of mutations spanning any number of collections as
	 * ONE server-side transaction. Every operation commits or none does — the
	 * rows and the realtime change events roll back together.
	 *
	 * Each operation is authorized as the requesting principal against its own
	 * collection; batching skips no access check. Operations run in the order
	 * given and are never reordered, because order is semantic (create the post,
	 * then its comment). Cross-table lock ordering is therefore the caller's:
	 * two concurrent transactions touching the same rows in opposite order can
	 * deadlock, so order operations consistently across call sites.
	 *
	 * Any thrown `QuestpieClientError` means NOTHING was applied. When an
	 * operation is what failed, the error keeps that operation's own status and
	 * code — a stale `expectedRevision` is still a 409 `CONFLICT`, a denied
	 * write still a 403 — and `error.context.custom.transaction` says which
	 * one: `{ index, collection, operation, applied: false }`. A malformed
	 * request is rejected before anything runs and names the offending index in
	 * its message instead.
	 *
	 * @example
	 * ```ts
	 * const [post, comment] = await client.transaction([
	 *   { collection: "posts", operation: "create", data: { title: "Hello" } },
	 *   { collection: "comments", operation: "update", id, data: { body: "Hi" } },
	 * ]);
	 * ```
	 */
	transaction: ClientTransaction<TApp>;
	channels: ChannelsClient<AppChannelDefinitions<TApp>>;
	globals: GlobalsAPI<TApp>;
	routes: RoutesClient<TApp["routes"]>;
	search: SearchAPI;
	realtime: RealtimeAPI;
	setLocale?: (locale?: string) => void;
	getLocale?: () => string | undefined;
	getBasePath?: () => string;
	/** @internal Consumed by `createCrdtClient()`; see ./crdt-host.ts. */
	[CRDT_CLIENT_HOST]?: CrdtClientHostHandle;
};

/**
 * Create type-safe QUESTPIE client
 *
 * @example
 * ```ts
 * import { createClient } from 'questpie/client'
 * import type { app } from './app'
 *
 * const client = createClient<typeof app>({
 *   baseURL: 'http://localhost:3000'
 * })
 *
 * // Type-safe collections
 * const posts = await client.collections.posts.find({ limit: 10 })
 *
 * // Type-safe routes — nested keys from flat route files, explicit method leaf
 * const result = await client.routes.admin.stats.post({ period: "week" })
 * ```
 */
export function createClient<TApp extends QuestpieApp>(
	config: QuestpieClientConfig<TApp>,
): QuestpieClient<TApp> {
	// Bind the default fetch: realtime/channels store this and invoke it as a
	// method (`this.fetcher(...)`), and browsers throw "Illegal invocation"
	// when native fetch runs with a foreign `this`.
	const fetcher = config.fetch || globalThis.fetch.bind(globalThis);
	const basePath = config.basePath ?? "/";
	const normalizedBasePath = basePath.startsWith("/")
		? basePath
		: `/${basePath}`;
	const trimmedBasePath = normalizedBasePath.replace(/\/$/, "");
	const apiBasePath = trimmedBasePath || "";
	const defaultHeaders = config.headers || {};
	let currentLocale: string | undefined =
		defaultHeaders["accept-language"] ?? defaultHeaders["Accept-Language"];

	/**
	 * Make a request to the app API
	 */
	type QuestpieRequestInit = RequestInit & {
		json?: unknown;
	};

	async function requestWithMeta(
		path: string,
		options: QuestpieRequestInit = {},
	): Promise<{ data: any; headers: Headers }> {
		const url = `${config.baseURL}${path}`;
		const useSuperJSON = config.useSuperJSON !== false; // default true

		const contentType = useSuperJSON
			? "application/superjson+json"
			: "application/json";

		const authHeaders = await config.getAuthHeaders?.();
		const headers: Record<string, string> = {
			"Content-Type": contentType,
			...defaultHeaders,
			...(options.headers as Record<string, string>),
			...authHeaders,
		};

		if (useSuperJSON) {
			headers["X-SuperJSON"] = "1";
		}

		const { json, ...requestOptions } = options;
		const body =
			json === undefined
				? requestOptions.body
				: useSuperJSON
					? stringifyTypedWire(json)
					: JSON.stringify(json);

		const response = await fetcher(url, {
			...requestOptions,
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
						? parseTypedWire(text)
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
		if (!text) return { data: undefined, headers: response.headers };

		return {
			data: responseContentType?.includes("superjson")
				? parseTypedWire(text)
				: JSON.parse(text),
			headers: response.headers,
		};
	}

	async function request(
		path: string,
		options: QuestpieRequestInit = {},
	): Promise<any> {
		return (await requestWithMeta(path, options)).data;
	}

	async function mutationRequest(
		path: string,
		options: QuestpieRequestInit,
	): Promise<any> {
		const { data, headers } = await requestWithMeta(path, options);
		return attachTxid(data, headers.get(QUESTPIE_TXID_HEADER));
	}

	const refetchRealtimeTopic = async (
		topic: Parameters<RealtimeAPI["subscribe"]>[0],
	): Promise<unknown> => {
		if (topic.resourceType === "collection") {
			if (topic.operation === "count") {
				const queryString = stringifyQuery({
					where: topic.where,
					locale: topic.locale,
				});
				const result = await request(
					`${apiBasePath}/${topic.resource}/count${queryString ? `?${queryString}` : ""}`,
				);
				return result.count;
			}
			if (topic.operation === "get") {
				const queryString = stringifyQuery({
					with: topic.with,
					locale: topic.locale,
				});
				return request(
					`${apiBasePath}/${topic.resource}/${topic.id}${queryString ? `?${queryString}` : ""}`,
				);
			}
			const queryString = stringifyQuery({
				where: topic.where,
				with: topic.with,
				limit: topic.limit,
				offset: topic.offset,
				orderBy: topic.orderBy,
				locale: topic.locale,
			});
			return request(
				`${apiBasePath}/${topic.resource}${queryString ? `?${queryString}` : ""}`,
			);
		}
		const queryString = stringifyQuery({
			where: topic.where,
			with: topic.with,
			locale: topic.locale,
		});
		return request(
			`${apiBasePath}/globals/${topic.resource}${queryString ? `?${queryString}` : ""}`,
		);
	};
	const pusherConnection = new PusherConnectionManager();
	const sseConnection = new SseConnectionManager({
		baseUrl: `${config.baseURL}${apiBasePath}`,
		withCredentials: true,
		fetcher,
		getAuthHeaders: config.getAuthHeaders,
		debounceMs: 50,
	});
	const realtimeSession = createRealtimeClientSession({
		baseUrl: `${config.baseURL}${apiBasePath}`,
		withCredentials: true,
		debounceMs: 50,
		getAuthHeaders: config.getAuthHeaders,
		fetcher,
		pusherConnection,
		sseConnection,
		refetchTopic: refetchRealtimeTopic,
	});
	const realtimeApi = createRealtimeAPI({
		baseUrl: `${config.baseURL}${apiBasePath}`,
		withCredentials: true,
		debounceMs: 50,
		getAuthHeaders: config.getAuthHeaders,
		fetcher,
		pusherConnection,
		sseConnection,
		refetchTopic: refetchRealtimeTopic,
		realtimeSession,
	});
	const channelsApi = createChannelsAPI<AppChannelDefinitions<TApp>>({
		baseUrl: `${config.baseURL}${apiBasePath}`,
		withCredentials: true,
		fetcher,
		useSuperJSON: config.useSuperJSON !== false,
		getAuthHeaders: config.getAuthHeaders,
		pusherConnection,
		sseConnection,
	});
	// The CRDT API is NOT constructed here — see ./crdt-host.ts. Only the
	// ingredients are captured, so `createCrdtClient(client)` can build it on
	// demand while reusing this client's single realtime session.
	const crdtHost = {
		baseURL: config.baseURL,
		basePath: apiBasePath,
		fetcher,
		defaultHeaders,
		getAuthHeaders: config.getAuthHeaders,
		realtimeSession,
	} as const;

	/**
	 * Collections API
	 */
	const collections = new Proxy({} as CollectionsAPI<TApp>, {
		get(_, collectionName: string) {
			const base = {
				find: async (options: any = {}) => {
					// Use qs for cleaner query strings with nested objects
					const queryString = stringifyQuery(options);

					const path = `${apiBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;

					return request(path);
				},

				live: (
					options: any,
					onSnapshot: (snapshot: any) => void,
					opts?: LiveSubscribeOptions,
				) => {
					return realtimeApi.subscribe(
						buildCollectionTopic(collectionName, options),
						onSnapshot,
						opts?.signal,
						undefined,
						opts?.onError,
					);
				},

				liveIter: (options?: any, opts?: { signal?: AbortSignal }) => {
					return realtimeApi.stream(
						buildCollectionTopic(collectionName, options),
						opts?.signal,
					);
				},

				count: async (options: any = {}) => {
					const queryString = stringifyQuery(options);

					const path = `${apiBasePath}/${collectionName}/count${queryString ? `?${queryString}` : ""}`;
					const result = await request(path);
					return result.count;
				},

				findOne: async (options: any = {}) => {
					const where = options?.where;

					// Optimization: if only id is provided in where, use the /:id endpoint
					if (where?.id && Object.keys(where).length === 1) {
						const queryString = stringifyQuery({
							with: options.with,
							columns: options.columns,
							includeDeleted: options.includeDeleted,
							locale: options.locale,
							localeFallback: options.localeFallback,
							stage: options.stage,
						});

						const path = `${apiBasePath}/${collectionName}/${where.id}${queryString ? `?${queryString}` : ""}`;
						return request(path);
					}

					// Otherwise use find with limit=1
					const queryString = stringifyQuery({ ...options, limit: 1 });

					const path = `${apiBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					const result = await request(path);
					return result?.docs?.[0] ?? null;
				},

				create: async (data: any, options: LocaleOptions = {}) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						json: data,
					});
				},

				update: async (
					{
						id,
						data,
						expectedRevision,
					}: { id: string; data: unknown; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "PATCH",
						json:
							expectedRevision === undefined
								? data
								: { data, expectedRevision },
					});
				},

				delete: async (
					{ id, expectedRevision }: { id: string; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "DELETE",
						...(expectedRevision === undefined
							? {}
							: { json: { expectedRevision } }),
					});
				},

				restore: async (
					{ id, expectedRevision }: { id: string; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}/restore${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						...(expectedRevision === undefined
							? {}
							: { json: { expectedRevision } }),
					});
				},

				purgeById: async (
					{ id, expectedRevision }: { id: string; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}/purge${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						...(expectedRevision === undefined
							? {}
							: { json: { expectedRevision } }),
					});
				},

				findVersions: async (
					{
						id,
						limit,
						offset,
					}: { id: string; limit?: number; offset?: number },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery({
						limit,
						offset,
						...options,
					});
					const path = `${apiBasePath}/${collectionName}/${id}/versions${queryString ? `?${queryString}` : ""}`;
					return request(path);
				},

				revertToVersion: async (
					{
						id,
						version,
						versionId,
						expectedRevision,
					}: {
						id: string;
						version?: number;
						versionId?: string;
						expectedRevision?: number;
					},
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}/revert${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						json: { version, versionId, expectedRevision },
					});
				},

				transitionStage: async (
					{
						id,
						stage,
						scheduledAt,
						expectedRevision,
					}: CollectionTransitionStageInput,
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/${id}/transition${queryString ? `?${queryString}` : ""}`;
					const body = {
						stage,
						...(expectedRevision === undefined ? {} : { expectedRevision }),
						...(scheduledAt !== undefined
							? {
									scheduledAt:
										scheduledAt instanceof Date
											? scheduledAt.toISOString()
											: scheduledAt,
								}
							: {}),
					};
					return request(path, {
						method: "POST",
						json: body,
					});
				},

				updateMany: async (
					{
						where,
						data,
						expectedRevisions,
					}: {
						where: unknown;
						data: unknown;
						expectedRevisions?: Array<ExpectedRevision<string | number>>;
					},
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "PATCH",
						json: {
							where,
							data,
							...(expectedRevisions === undefined ? {} : { expectedRevisions }),
						},
					});
				},

				updateBatch: async (
					{ updates }: { updates: Array<{ id: string; data: unknown }> },
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/update-batch${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						json: { updates },
					});
				},

				deleteMany: async (
					{
						where,
						expectedRevisions,
					}: {
						where: unknown;
						expectedRevisions?: Array<ExpectedRevision<string | number>>;
					},
					options: LocaleOptions = {},
				) => {
					const queryString = stringifyQuery(options);
					const path = `${apiBasePath}/${collectionName}/delete-many${queryString ? `?${queryString}` : ""}`;
					return mutationRequest(path, {
						method: "POST",
						json: {
							where,
							...(expectedRevisions === undefined ? {} : { expectedRevisions }),
						},
					});
				},

				meta: async () => {
					return request(`${apiBasePath}/${collectionName}/meta`);
				},

				schema: async () => {
					return request(`${apiBasePath}/${collectionName}/schema`);
				},

				upload: (file: File, options?: UploadOptions): Promise<any> => {
					return new Promise((resolve, reject) => {
						const xhr = new XMLHttpRequest();
						const url = `${config.baseURL}${apiBasePath}/${collectionName}/upload`;

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
						if (options?.path) {
							formData.append("path", options.path);
						}

						const send = (authHeaders?: Record<string, string>) => {
							for (const [name, value] of Object.entries(authHeaders ?? {})) {
								xhr.setRequestHeader(name, value);
							}
							xhr.send(formData);
						};

						// Keep cookie credentials enabled while allowing dynamic bearer auth.
						xhr.open("POST", url);
						xhr.withCredentials = true;
						if (config.getAuthHeaders) {
							try {
								Promise.resolve(config.getAuthHeaders()).then(send, (error) => {
									cleanup();
									reject(error);
								});
							} catch (error) {
								cleanup();
								reject(error);
							}
						} else {
							send();
						}
					});
				},

				// Canonical by-id aliases — one CRUD vocabulary across server
				// and client (server `update`/`delete` are bulk-by-where).
				updateById: async (
					params: { id: string; data: unknown; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					return base.update(params, options);
				},

				deleteById: async (
					params: { id: string; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					return base.delete(params, options);
				},

				restoreById: async (
					params: { id: string; expectedRevision?: number },
					options: LocaleOptions = {},
				) => {
					return base.restore(params, options);
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
							path: options?.path,
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

			return base as any;
		},
	});

	/**
	 * Globals API
	 */
	const globals = new Proxy({} as GlobalsAPI<TApp>, {
		get(_, globalName: string) {
			const base = {
				get: async (
					options: {
						with?: any;
						columns?: Record<string, boolean>;
						locale?: string;
						localeFallback?: boolean;
						stage?: string;
					} = {},
				) => {
					const queryString = stringifyQuery({
						with: options.with,
						columns: options.columns,
						locale: options.locale,
						localeFallback: options.localeFallback,
						stage: options.stage,
					});
					const path = `${apiBasePath}/globals/${globalName}${queryString ? `?${queryString}` : ""}`;
					return request(path);
				},

				live: (
					options: any,
					onSnapshot: (snapshot: any) => void,
					opts?: LiveSubscribeOptions,
				) => {
					return realtimeApi.subscribe(
						buildGlobalTopic(globalName, options),
						onSnapshot,
						opts?.signal,
						undefined,
						opts?.onError,
					);
				},

				liveIter: (options?: any, opts?: { signal?: AbortSignal }) => {
					return realtimeApi.stream(
						buildGlobalTopic(globalName, options),
						opts?.signal,
					);
				},

				update: async (
					data: any,
					options: {
						with?: any;
						locale?: string;
						localeFallback?: boolean;
						stage?: string;
					} = {},
				) => {
					const queryString = stringifyQuery({
						with: options.with,
						locale: options.locale,
						localeFallback: options.localeFallback,
						stage: options.stage,
					});
					return mutationRequest(
						`${apiBasePath}/globals/${globalName}${queryString ? `?${queryString}` : ""}`,
						{
							method: "PATCH",
							json: data,
						},
					);
				},

				schema: async () => {
					return request(`${apiBasePath}/globals/${globalName}/schema`);
				},

				meta: async () => {
					return request(`${apiBasePath}/globals/${globalName}/meta`);
				},

				findVersions: async (
					options: {
						id?: string;
						limit?: number;
						offset?: number;
						locale?: string;
						localeFallback?: boolean;
						stage?: string;
					} = {},
				) => {
					const queryString = stringifyQuery({
						id: options.id,
						limit: options.limit,
						offset: options.offset,
						locale: options.locale,
						localeFallback: options.localeFallback,
						stage: options.stage,
					});
					const path = `${apiBasePath}/globals/${globalName}/versions${queryString ? `?${queryString}` : ""}`;
					return request(path);
				},

				revertToVersion: async (
					params: { id?: string; version?: number; versionId?: string },
					options: {
						locale?: string;
						localeFallback?: boolean;
						stage?: string;
					} = {},
				) => {
					const queryString = stringifyQuery({
						locale: options.locale,
						localeFallback: options.localeFallback,
						stage: options.stage,
					});
					return mutationRequest(
						`${apiBasePath}/globals/${globalName}/revert${queryString ? `?${queryString}` : ""}`,
						{
							method: "POST",
							json: params,
						},
					);
				},

				transitionStage: async (
					params: GlobalTransitionStageInput,
					options: {
						locale?: string;
						localeFallback?: boolean;
					} = {},
				) => {
					const queryString = stringifyQuery({
						locale: options.locale,
						localeFallback: options.localeFallback,
					});
					return request(
						`${apiBasePath}/globals/${globalName}/transition${queryString ? `?${queryString}` : ""}`,
						{
							method: "POST",
							json: {
								stage: params.stage,
								...(params.expectedRevision === undefined
									? {}
									: { expectedRevision: params.expectedRevision }),
								...(params.scheduledAt !== undefined
									? {
											scheduledAt:
												params.scheduledAt instanceof Date
													? params.scheduledAt.toISOString()
													: params.scheduledAt,
										}
									: {}),
							},
						},
					);
				},
			};

			return base as any;
		},
	});

	/**
	 * Search API
	 */
	const search: SearchAPI = {
		search: async (options: SearchOptions) => {
			return request(`${apiBasePath}/search`, {
				method: "POST",
				json: options,
			});
		},

		reindex: async (collection: string) => {
			return request(`${apiBasePath}/search/reindex/${collection}`, {
				method: "POST",
			});
		},
	};

	/** Convert camelCase to kebab-case for URL paths */
	const camelToKebab = (s: string) =>
		s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

	/**
	 * Routes API — nested proxy that maps route keys to callable endpoints.
	 *
	 * Route paths use slash-separated segments accessed via dot notation:
	 *   `routes/admin/stats.post.ts` → `client.routes.admin.stats.post(input)`
	 *
	 * For routes with method suffix:
	 *   `admin/stats:GET` → `client.routes.admin.stats.get(input)`
	 * Traversing deeper builds the URL path.
	 * Segment names are converted from camelCase to kebab-case for URLs.
	 */
	const createRouteProxy = (segments: string[]): any => {
		const path = segments.map(camelToKebab).join("/");
		const callable = async (input?: any) => {
			return request(`${apiBasePath}/${path}`, {
				method: "POST",
				json: input,
			});
		};

		return new Proxy(callable, {
			get(_, prop) {
				if (prop === "then") return undefined;
				if (prop === "url") return `${config.baseURL}${apiBasePath}/${path}`;
				if (typeof prop !== "string") return undefined;

				// HTTP method names at leaf → method-specific caller
				const method = prop.toUpperCase();
				if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.test(method)) {
					return async (input?: any) => {
						if (
							(
								config.rawRoutes as Readonly<Record<string, true>> | undefined
							)?.[`${segments.join("/")}:${method}`]
						) {
							return (await import("./raw-route.js")).callRawRoute(
								fetcher,
								`${config.baseURL}${apiBasePath}/${path}`,
								method,
								input ?? {},
								defaultHeaders,
								config.getAuthHeaders,
							);
						}
						if (method === "GET" && input) {
							const queryString = stringifyQuery(input);
							return request(
								`${apiBasePath}/${path}${queryString ? `?${queryString}` : ""}`,
								{ method: "GET" },
							);
						}
						return request(`${apiBasePath}/${path}`, {
							method,
							json: input,
						});
					};
				}

				// Otherwise, deeper nesting
				return createRouteProxy([...segments, prop]);
			},
		});
	};

	const routesProxy = new Proxy({} as any, {
		get(_, prop) {
			if (typeof prop !== "string") return undefined;
			return createRouteProxy([prop]);
		},
	});

	/**
	 * Cross-collection transaction — one request, one server transaction.
	 *
	 * The operations go over the wire as given; the server dispatches them in
	 * that order. `mutationRequest` attaches the response's txid so realtime
	 * echo suppression treats the whole batch as one of our own writes.
	 */
	const transaction = async (
		operations: readonly unknown[],
		options: LocaleOptions = {},
	) => {
		const queryString = stringifyQuery(options);
		const path = `${apiBasePath}/transaction${queryString ? `?${queryString}` : ""}`;
		return mutationRequest(path, {
			method: "POST",
			json: { operations },
		});
	};

	return {
		collections,
		transaction,
		channels: channelsApi,
		[CRDT_CLIENT_HOST]: crdtHost,
		globals,
		routes: routesProxy,
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
		getBasePath: () => apiBasePath,
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
// Re-export reactive prop placeholder shape so the admin client can detect
// it in `extraProps` values and decide whether to call /admin/reactive.
export type {
	ReactivePropPlaceholder,
	ReactivePropValue,
} from "#questpie/server/fields/reactive-types.js";

/**
 * Type guard for `ReactivePropPlaceholder` — inlined here to avoid pulling
 * the server's reactive runtime (Proxy dep-tracking) into the client bundle.
 * Keep in sync with `serializeReactivePropValue`'s output shape.
 */
import type { ReactivePropPlaceholder as _ReactivePropPlaceholder } from "#questpie/server/fields/reactive-types.js";
export function isReactivePropPlaceholder(
	value: unknown,
): value is _ReactivePropPlaceholder {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { "~reactive"?: unknown })["~reactive"] === "prop"
	);
}
// Re-export collection and global meta types
export type {
	CollectionFieldMeta,
	CollectionMeta,
	CollectionTitleMeta,
} from "#questpie/shared/collection-meta.js";
export type { GlobalMeta } from "#questpie/shared/global-meta.js";
// Re-export realtime types and helpers
export type {
	RealtimeAPI,
	RealtimeDeltaDeleteReason,
	RealtimeFindWindow,
	RealtimeStreamEvent,
	RealtimeTopicRejectedDetails,
	RealtimeTopicRejectedPayload,
	TopicConfig,
	TopicInput,
} from "./realtime/index.js";
export {
	applyRealtimeFindEvent,
	applyRealtimeScalarEvent,
	applyRealtimeSingleEvent,
	buildCollectionTopic,
	buildGlobalTopic,
	deriveFindDeltas,
	envelopeMeta,
	realtimeEventResolvesTxid,
	RealtimeCrdtBindingRejectedError,
	RealtimeTxidTracker,
	RealtimeTopicRejectedError,
} from "./realtime/index.js";
export type {
	ChannelClient,
	ChannelMessage,
	ChannelPublishInput,
	ChannelPublishReceipt,
	ChannelsClient,
	ChannelPresenceOptions,
	ChannelSubscribeOptions,
} from "./channels/index.js";
export * from "./crdt/index.js";
// Re-export the query-surface types the client's own method signatures are
// built from, so consumers (e.g. @questpie/tanstack-query) can derive
// per-call generics without reaching into server internals.
export type {
	ApplyQuery,
	CollectionSelect as CollectionSelectFromApp,
	FindManyOptions,
	FindOneOptionsBase,
	FindResult,
	GroupedPaginatedResult,
	OrderBy,
	PaginatedResult,
	Where,
	With,
} from "../server/collection/crud/types.js";
export type {
	AnyCollection,
	AnyCollectionOrBuilder,
	AnyGlobal,
	CollectionRelations,
	CollectionSelect,
	GetCollection,
	GetGlobal,
	GlobalRelations,
	GlobalSelect,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";
export {
	attachTxid,
	getTxid,
	QUESTPIE_TXID,
	QUESTPIE_TXID_HEADER,
} from "#questpie/shared/txid.js";
