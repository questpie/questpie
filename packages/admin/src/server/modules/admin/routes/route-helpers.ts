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

import type { Questpie } from "questpie";

// ============================================================================
// Route Handler Context
// ============================================================================

/**
 * Minimal typed shape for route handler context.
 * The actual context is `JsonRouteHandlerArgs<T>` which extends `AppContext`,
 * but AppContext is empty in the admin package (augmented by user's codegen).
 *
 * These helpers safely extract the known properties at runtime.
 * Uses Record<string, any> base to accept JsonRouteHandlerArgs without index signature issues.
 */
type RouteHandlerContext = Record<string, any>;

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
export function getSession(ctx: RouteHandlerContext): { user: Record<string, any> } | undefined {
	return ctx.session as { user: Record<string, any> } | undefined;
}

/**
 * Get database instance from route handler context.
 */
export function getDb(ctx: RouteHandlerContext): any {
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
export function getCollectionState(collection: { state: any }): AdminCollectionState {
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
			branding?: unknown;
		};
	};
	blocks?: Record<string, unknown>;
	collections?: Record<string, { state: AdminCollectionState }>;
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
export function getAdminConfig(app: App): NonNullable<NonNullable<AdminAppState["config"]>["admin"]> {
	const state = getAppState(app);
	return state.config?.admin || {};
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
