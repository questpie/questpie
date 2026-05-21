/**
 * Route Context Helpers
 *
 * Typed helper functions that extract app, session, db, and locale
 * from route handler context. These encapsulate the `as any` casts
 * needed because the admin package cannot know the user's specific
 * AppContext augmentation at compile time.
 *
 * Route handlers use these instead of inline `(ctx as any).app` casts.
 */

import type { AppContext, Questpie } from "questpie";

// ============================================================================
// Route Handler Context
// ============================================================================

/**
 * Minimal route handler context for admin helpers.
 * Accepts full `JsonRouteHandlerArgs` and narrower resolver contexts (e.g. preview).
 */
type RouteHandlerContext = {
	app?: unknown;
	db?: unknown;
	session?: unknown;
	locale?: unknown;
	input?: unknown;
	request?: Request;
	params?: Record<string, string>;
};

/**
 * Typed app instance type used throughout admin routes.
 */
export type App = Questpie<any>;

// ============================================================================
// Context Extraction Helpers
// ============================================================================

/**
 * Get typed Questpie app instance from route handler context.
 */
export function getApp(ctx: RouteHandlerContext): App {
	return ctx.app as App;
}

/**
 * Get session from route handler context.
 * Returns undefined if no session exists.
 */
export function getSession(
	ctx: RouteHandlerContext,
): { user: Record<string, any> } | undefined {
	return ctx.session as { user: Record<string, any> } | undefined;
}

/**
 * Get database instance from route handler context.
 */
export function getDb(ctx: RouteHandlerContext): unknown {
	return ctx.db;
}

/**
 * Get current locale from route handler context.
 */
export function getLocale(ctx: RouteHandlerContext): string | undefined {
	return ctx.locale as string | undefined;
}

/**
 * Get the full access context needed by hasReadAccess and similar functions.
 */
export function getAccessContext(ctx: RouteHandlerContext): {
	app: App;
	session: { user: Record<string, any> } | undefined;
	db: any;
	locale: string | undefined;
} {
	return {
		app: getApp(ctx),
		session: getSession(ctx),
		db: getDb(ctx),
		locale: getLocale(ctx),
	};
}

// ============================================================================
// Collection/Global State Helpers
// ============================================================================

/**
 * Typed shape for collection state as accessed by admin routes.
 * The actual collection.state has a complex generic type, but admin
 * routes only need these specific properties.
 */
export interface AdminCollectionState {
	admin?: Record<string, any>;
	access?: Record<string, any>;
	options?: Record<string, any>;
	upload?: unknown;
	adminActions?: unknown;
	adminForm?: unknown;
	adminList?: unknown;
	adminPreview?: unknown;
	fieldDefinitions?: Record<string, any>;
	[key: string]: unknown;
}

/**
 * Typed shape for global state as accessed by admin routes.
 */
export interface AdminGlobalState {
	admin?: Record<string, any>;
	access?: Record<string, any>;
	options?: Record<string, any>;
	adminForm?: unknown;
	fieldDefinitions?: Record<string, any>;
	[key: string]: unknown;
}

/**
 * Get typed collection state.
 */
export function getCollectionState(collection: {
	state: any;
}): AdminCollectionState {
	return collection.state as AdminCollectionState;
}

/**
 * Get typed global state.
 */
export function getGlobalState(global: { state: any }): AdminGlobalState {
	return global.state as AdminGlobalState;
}

// ============================================================================
// App State Helpers
// ============================================================================

/**
 * Typed shape for app.state as accessed by admin routes.
 */
export interface AdminAppState {
	config?: {
		admin?: {
			sidebar?: unknown;
			dashboard?: unknown;
			shell?: unknown;
			branding?: unknown;
		};
	};
	blocks?: Record<string, unknown>;
	collections?: Record<string, { state: AdminCollectionState }>;
	globals?: Record<string, { state: AdminGlobalState }>;
	[key: string]: unknown;
}

/**
 * Get typed app state from app instance.
 */
export function getAppState(app: App): AdminAppState {
	return ((app as any).state || {}) as AdminAppState;
}

/**
 * Get admin config from app state.
 */
export function getAdminConfig(
	app: App,
): NonNullable<NonNullable<AdminAppState["config"]>["admin"]> {
	const state = getAppState(app);
	return state.config?.admin || {};
}

/**
 * Get registered collection definitions from the current or legacy app shape.
 */
export function getCollections(app: App): Record<
	string,
	{ state: AdminCollectionState; [key: string]: unknown }
> {
	const appRec = app as Record<string, any>;
	if (typeof appRec.getCollections === "function") {
		return appRec.getCollections();
	}
	return getAppState(app).collections ?? {};
}

/**
 * Get registered global definitions from the current or legacy app shape.
 */
export function getGlobals(app: App): Record<
	string,
	{ state: AdminGlobalState; [key: string]: unknown }
> {
	const appRec = app as Record<string, any>;
	if (typeof appRec.getGlobals === "function") {
		return appRec.getGlobals();
	}
	return getAppState(app).globals ?? {};
}

/**
 * Get a registered collection definition by slug.
 */
export function getCollection(
	app: App,
	collectionSlug: string,
): { state: AdminCollectionState; [key: string]: unknown } | undefined {
	return getCollections(app)[collectionSlug];
}

/**
 * Get a registered global definition by slug.
 */
export function getGlobal(
	app: App,
	globalSlug: string,
): { state: AdminGlobalState; [key: string]: unknown } | undefined {
	return getGlobals(app)[globalSlug];
}

/**
 * Get collection CRUD APIs from the current or legacy app shape.
 */
export function getCollectionCrud(app: App, collectionSlug: string): any {
	const appRec = app as Record<string, any>;
	return (
		appRec.collections?.[collectionSlug] ??
		appRec.api?.collections?.[collectionSlug] ??
		appRec._api?.collections?.[collectionSlug]
	);
}

/**
 * Get all collection CRUD APIs from the current or legacy app shape.
 */
export function getCollectionCruds(app: App): any {
	const appRec = app as Record<string, any>;
	return (
		appRec.collections ?? appRec.api?.collections ?? appRec._api?.collections
	);
}

/**
 * Get all global CRUD APIs from the current or legacy app shape.
 */
export function getGlobalCruds(app: App): any {
	const appRec = app as Record<string, any>;
	return appRec.globals ?? appRec.api?.globals ?? appRec._api?.globals;
}

// ============================================================================
// Server Context Builder (for reactive handlers)
// ============================================================================

/**
 * Build a ReactiveServerContext from route handler context.
 */
export function buildServerContext(ctx: RouteHandlerContext): {
	db: any;
	user: Record<string, any> | null;
	req: Request;
	locale: string;
} {
	const session = getSession(ctx);
	return {
		db: getDb(ctx),
		user: session?.user ?? null,
		req: new Request("http://localhost"),
		locale: getLocale(ctx) ?? "en",
	};
}
