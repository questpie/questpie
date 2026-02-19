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
	app: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	operation: "create" | "update" | "delete";
	db: any;
}

/**
 * Context passed to global collection transition hooks.
 */
export interface GlobalCollectionTransitionHookContext<TData = any> {
	/** The name/slug of the collection being operated on */
	collection: string;
	data: TData;
	fromStage: string;
	toStage: string;
	app: any;
	session?: any | null;
	locale?: string;
	db: any;
}

/**
 * A single global collection hook entry with optional include/exclude filters.
 */
export interface GlobalCollectionHookEntry {
	/** Only apply to these collection slugs. If omitted, applies to all. */
	include?: string[];
	/** Exclude these collection slugs. Applied after include. */
	exclude?: string[];

	beforeChange?: (
		ctx: GlobalCollectionHookContext,
	) => Promise<void> | void;
	afterChange?: (
		ctx: GlobalCollectionHookContext,
	) => Promise<void> | void;
	beforeDelete?: (
		ctx: GlobalCollectionHookContext,
	) => Promise<void> | void;
	afterDelete?: (
		ctx: GlobalCollectionHookContext,
	) => Promise<void> | void;
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
	app: any;
	session?: any | null;
	locale?: string;
	accessMode?: AccessMode;
	db: any;
}

/**
 * Context passed to global global transition hooks.
 */
export interface GlobalGlobalTransitionHookContext<TData = any> {
	/** The name/slug of the global being operated on */
	global: string;
	data: TData;
	fromStage: string;
	toStage: string;
	app: any;
	session?: any | null;
	locale?: string;
	db: any;
}

/**
 * A single global global hook entry with optional include/exclude filters.
 */
export interface GlobalGlobalHookEntry {
	/** Only apply to these global slugs. If omitted, applies to all. */
	include?: string[];
	/** Exclude these global slugs. Applied after include. */
	exclude?: string[];

	beforeChange?: (
		ctx: GlobalGlobalHookContext,
	) => Promise<void> | void;
	afterChange?: (
		ctx: GlobalGlobalHookContext,
	) => Promise<void> | void;
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
