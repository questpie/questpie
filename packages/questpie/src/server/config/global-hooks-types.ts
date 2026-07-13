import type { ResolvedAppHookContext } from "#questpie/server/config/app-context.js";
import type {
	AccessMode,
	DrizzleClientFromQuestpieConfig,
} from "#questpie/server/config/types.js";

// ============================================================================
// Global Collection Hook Types
// ============================================================================

/** Hook-specific fields for global collection hooks. */
export type GlobalCollectionHookContextFields<
	TData = any,
	TOriginal = any,
> = {
	/** The name/slug of the collection being operated on */
	collection: string;
	/** Transaction-bound database client for the current mutation. */
	db: DrizzleClientFromQuestpieConfig<any>;
	data: TData;
	original: TOriginal | undefined;
	locale?: string;
	accessMode?: AccessMode;
	operation: "create" | "update" | "delete";
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
	 */
	onAfterCommit: (callback: () => Promise<void>) => void;
};

/**
 * Context passed to global collection hooks.
 * Extends the lazy {@link ResolvedAppHookContext} infra seam; generated apps fill it (and augment full {@link AppContext}) separately.
 */
export type GlobalCollectionHookContext<TData = any, TOriginal = any> =
	GlobalCollectionHookContextFields<TData, TOriginal> & ResolvedAppHookContext;

/**
 * Context passed to global collection hooks before the collection name is injected.
 */
export type GlobalCollectionHookContextInput<
	TData = any,
	TOriginal = any,
> = Omit<GlobalCollectionHookContextFields<TData, TOriginal>, "collection"> &
	ResolvedAppHookContext;

/** Hook-specific fields for global collection transition hooks. */
export type GlobalCollectionTransitionHookContextFields<TData = any> = {
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
	locale?: string;
	accessMode?: AccessMode;
};

/**
 * Context passed to global collection transition hooks.
 */
export type GlobalCollectionTransitionHookContext<TData = any> =
	GlobalCollectionTransitionHookContextFields<TData> & ResolvedAppHookContext;

/**
 * Context passed to global collection transition hooks before the collection name is injected.
 */
export type GlobalCollectionTransitionHookContextInput<TData = any> = Omit<
	GlobalCollectionTransitionHookContextFields<TData>,
	"collection"
> &
	ResolvedAppHookContext;

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

/** Hook-specific fields for global global hooks. */
export type GlobalGlobalHookContextFields<TData = any> = {
	/** The name/slug of the global being operated on */
	global: string;
	/** Transaction-bound database client for the current mutation. */
	db: DrizzleClientFromQuestpieConfig<any>;
	data: TData;
	input?: unknown;
	locale?: string;
	accessMode?: AccessMode;
	/**
	 * Queue a callback to run after the current transaction commits.
	 * If called outside a transaction, the callback runs immediately (fire-and-forget).
	 */
	onAfterCommit: (callback: () => Promise<void>) => void;
};

/**
 * Context passed to global global hooks.
 */
export type GlobalGlobalHookContext<TData = any> =
	GlobalGlobalHookContextFields<TData> & ResolvedAppHookContext;

/**
 * Context passed to global global hooks before the global name is injected.
 */
export type GlobalGlobalHookContextInput<TData = any> = Omit<
	GlobalGlobalHookContextFields<TData>,
	"global"
> &
	ResolvedAppHookContext;

/** Hook-specific fields for global global transition hooks. */
export type GlobalGlobalTransitionHookContextFields<TData = any> = {
	/** The name/slug of the global being operated on */
	global: string;
	/** The record being transitioned */
	data: TData;
	fromStage: string;
	toStage: string;
	/** When set, the transition should be scheduled for this future date instead of executing immediately */
	scheduledAt?: Date;
	locale?: string;
	accessMode?: AccessMode;
};

/**
 * Context passed to global global transition hooks.
 */
export type GlobalGlobalTransitionHookContext<TData = any> =
	GlobalGlobalTransitionHookContextFields<TData> & ResolvedAppHookContext;

/**
 * Context passed to global global transition hooks before the global name is injected.
 */
export type GlobalGlobalTransitionHookContextInput<TData = any> = Omit<
	GlobalGlobalTransitionHookContextFields<TData>,
	"global"
> &
	ResolvedAppHookContext;

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
