import type { AccessMode } from "#questpie/server/config/types.js";

// ============================================================================
// Global Collection Hook Types
// ============================================================================

/**
 * Context passed to global collection hooks.
 * Extends the standard HookContext with the collection name.
 */
export interface GlobalCollectionHookContext<TData = any, TOriginal = any> {
	/** The name/slug of the collection being operated on */
	collection: string;
	data: TData;
	original: TOriginal | undefined;
	/** @deprecated Use flat context properties instead */
	app?: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	operation: "create" | "update" | "delete";
	db: any;
	/** Queue client for publishing background jobs */
	queue: any;
	/** Email service */
	email: any;
	/** Storage service */
	storage: any;
	/** Key-value store */
	kv: any;
	/** Logger */
	logger: any;
	/** Search service */
	search: any;
	/** Realtime service */
	realtime: any;
	/** Collection CRUD APIs */
	collections: Record<string, any>;
	/** Global CRUD APIs */
	globals: Record<string, any>;

	// ---- Bulk metadata (present when operation is part of a batch) ----

	/** True when this hook is invoked as part of a bulk operation (updateMany/deleteMany) */
	isBatch?: boolean;
	/** IDs of all affected records in the batch */
	recordIds?: (string | number)[];
	/**
	 * All affected records in the batch.
	 * Semantics: post-image on update, pre-image on delete.
	 */
	records?: TData[];
	/** Total number of affected records in the batch */
	count?: number;

	/**
	 * Queue a callback to run after the current transaction commits.
	 * If called outside a transaction, the callback runs immediately (fire-and-forget).
	 *
	 * Use this for side effects that should only happen when data is durable:
	 * dispatching jobs, sending emails, search indexing, webhook calls.
	 */
	onAfterCommit: (callback: () => Promise<void>) => void;
}

/**
 * Context passed to global collection transition hooks.
 */
export interface GlobalCollectionTransitionHookContext<TData = any> {
	/** The name/slug of the collection being operated on */
	collection: string;
	/** The record being transitioned */
	data: TData;
	/** Record ID (string or number) */
	recordId: string | number;
	fromStage: string;
	toStage: string;
	/** When set, the transition should be scheduled for this future date instead of executing immediately */
	scheduledAt?: Date;
	/** @deprecated Use flat context properties instead */
	app?: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	db: any;
	/** Queue client for publishing background jobs */
	queue: any;
	/** Email service */
	email: any;
	/** Storage service */
	storage: any;
	/** Key-value store */
	kv: any;
	/** Logger */
	logger: any;
	/** Search service */
	search: any;
	/** Realtime service */
	realtime: any;
	/** Collection CRUD APIs */
	collections: Record<string, any>;
	/** Global CRUD APIs */
	globals: Record<string, any>;
}

/**
 * A single global collection hook entry with optional include/exclude filters.
 */
export interface GlobalCollectionHookEntry {
	/** Only apply to these collection slugs. If omitted, applies to all. */
	include?: string[];
	/** Exclude these collection slugs. Applied after include. */
	exclude?: string[];

	beforeChange?: (ctx: GlobalCollectionHookContext) => Promise<void> | void;
	afterChange?: (ctx: GlobalCollectionHookContext) => Promise<void> | void;
	beforeDelete?: (ctx: GlobalCollectionHookContext) => Promise<void> | void;
	afterDelete?: (ctx: GlobalCollectionHookContext) => Promise<void> | void;
	beforeTransition?: (
		ctx: GlobalCollectionTransitionHookContext,
	) => Promise<void> | void;
	afterTransition?: (
		ctx: GlobalCollectionTransitionHookContext,
	) => Promise<void> | void;
}

// ============================================================================
// Global Global Hook Types
// ============================================================================

/**
 * Context passed to global global hooks.
 * Extends the standard GlobalHookContext with the global name.
 */
export interface GlobalGlobalHookContext<TData = any> {
	/** The name/slug of the global being operated on */
	global: string;
	data: TData;
	input?: any;
	/** @deprecated Use flat context properties instead */
	app?: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	db: any;
	/** Queue client for publishing background jobs */
	queue: any;
	/** Email service */
	email: any;
	/** Storage service */
	storage: any;
	/** Key-value store */
	kv: any;
	/** Logger */
	logger: any;
	/** Search service */
	search: any;
	/** Realtime service */
	realtime: any;
	/** Collection CRUD APIs */
	collections: Record<string, any>;
	/** Global CRUD APIs */
	globals: Record<string, any>;

	/**
	 * Queue a callback to run after the current transaction commits.
	 * If called outside a transaction, the callback runs immediately (fire-and-forget).
	 *
	 * Use this for side effects that should only happen when data is durable:
	 * dispatching jobs, sending emails, search indexing, webhook calls.
	 */
	onAfterCommit: (callback: () => Promise<void>) => void;
}

/**
 * Context passed to global global transition hooks.
 */
export interface GlobalGlobalTransitionHookContext<TData = any> {
	/** The name/slug of the global being operated on */
	global: string;
	/** The record being transitioned */
	data: TData;
	fromStage: string;
	toStage: string;
	/** When set, the transition should be scheduled for this future date instead of executing immediately */
	scheduledAt?: Date;
	/** @deprecated Use flat context properties instead */
	app?: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	db: any;
	/** Queue client for publishing background jobs */
	queue: any;
	/** Email service */
	email: any;
	/** Storage service */
	storage: any;
	/** Key-value store */
	kv: any;
	/** Logger */
	logger: any;
	/** Search service */
	search: any;
	/** Realtime service */
	realtime: any;
	/** Collection CRUD APIs */
	collections: Record<string, any>;
	/** Global CRUD APIs */
	globals: Record<string, any>;
}

/**
 * A single global global hook entry with optional include/exclude filters.
 */
export interface GlobalGlobalHookEntry {
	/** Only apply to these global slugs. If omitted, applies to all. */
	include?: string[];
	/** Exclude these global slugs. Applied after include. */
	exclude?: string[];

	beforeChange?: (ctx: GlobalGlobalHookContext) => Promise<void> | void;
	afterChange?: (ctx: GlobalGlobalHookContext) => Promise<void> | void;
	beforeTransition?: (
		ctx: GlobalGlobalTransitionHookContext,
	) => Promise<void> | void;
	afterTransition?: (
		ctx: GlobalGlobalTransitionHookContext,
	) => Promise<void> | void;
}

// ============================================================================
// Storage & Input Types
// ============================================================================

/**
 * Internal storage shape for accumulated global hooks.
 */
export interface GlobalHooksState {
	collections: GlobalCollectionHookEntry[];
	globals: GlobalGlobalHookEntry[];
}

/**
 * User-facing input shape for a single `.hooks()` call.
 */
export interface GlobalHooksInput {
	collections?: GlobalCollectionHookEntry;
	globals?: GlobalGlobalHookEntry;
}
