import { AsyncLocalStorage } from "node:async_hooks";
import type { Session, User } from "better-auth/types";
import type { AccessMode, QuestpieContextExtension } from "./types.js";

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Infer the Session type from a app instance.
 *
 * @example
 * ```ts
 * type MySession = InferSessionFromApp<typeof app>;
 * ```
 */
export type InferSessionFromApp<TApp> = TApp extends {
	auth: { $Infer: { Session: infer S } };
}
	? S
	: { user: User; session: Session };

/**
 * Infer the database type from a app instance.
 *
 * @example
 * ```ts
 * type MyDb = InferDbFromApp<typeof app>;
 * ```
 */
export type InferDbFromApp<TApp> = TApp extends { db: infer D } ? D : any;

/**
 * Extract base app type without functions to avoid circular dependencies.
 * Useful when defining functions that need to reference the app instance.
 *
 * @example
 * ```ts
 * // In app.ts - create base instance
 * const baseInstance = q({ name: "app" })
 *   .collections({ posts })
 *   .jobs({ sendEmail })
 *   .build();
 *
 * export type BaseCMS = InferBaseApp<typeof baseInstance>;
 *
 * // In functions/index.ts
 * import type { BaseCMS } from "../app";
 *
 * export const getPosts = q.fn({
 *   handler: async ({ app }) => {
 *     const app = typedApp<BaseCMS>(app);
 *     return app.api.collections.posts.find(); // ✅ Typed
 *   }
 * });
 * ```
 */
export type InferBaseApp<T> = T extends { config: infer TConfig }
	? { config: Omit<TConfig, "functions">; [key: string]: any }
	: never;

/**
 * Infer the app/app type from a app instance.
 *
 * @example
 * ```ts
 * type MyApp = InferAppFromApp<typeof app>;
 * ```
 */
export type InferAppFromApp<TApp> = TApp;

// ============================================================================
// TYPE HELPERS (compile-time only, no runtime effect)
//
// These functions only add TypeScript types - they perform no runtime logic.
// Use them to get type-safe access to context properties in hooks/functions.
//
// Pattern: typed* prefix clearly indicates these are type casts
// ============================================================================

/**
 * Add types to app instance from hook/job/function context.
 * This is a compile-time only type cast - no runtime effect.
 *
 * @example
 * ```ts
 * import { typedApp } from "questpie";
 * import type { App } from "./questpie";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ app }) => {
 *     const app = typedApp<App>(app);
 *     // ✅ Fully typed access
 *     await app.api.collections.posts.find();
 *     await app.queue.sendEmail.publish({ to: "user@example.com" });
 *   }
 * });
 * ```
 */
export function typedApp<TApp>(app: unknown): TApp {
	return app as TApp;
}

/**
 * Add types to database client from hook/job/function context.
 * This is a compile-time only type cast - no runtime effect.
 *
 * The db client may be a transaction within the current operation scope.
 *
 * @example
 * ```ts
 * import { typedApp, typedDb } from "questpie";
 * import type { App } from "./questpie";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ app, db }) => {
 *     const app = typedApp<App>(app);
 *     const database = typedDb<App>(db);
 *
 *     // ✅ Fully typed Drizzle operations
 *     await database.select().from(app.config.collections.posts.table);
 *   }
 * });
 * ```
 */
export function typedDb<TApp>(db: unknown): InferDbFromApp<TApp> {
	return db as InferDbFromApp<TApp>;
}

/**
 * Add types to session from hook/job/function context.
 * This is a compile-time only type cast - no runtime effect.
 *
 * Returns null if unauthenticated, undefined if session not resolved.
 *
 * @example
 * ```ts
 * import { typedSession } from "questpie";
 * import type { App } from "./questpie";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ session }) => {
 *     const typedSess = typedSession<App>(session);
 *
 *     if (!typedSess) {
 *       throw new Error("Unauthorized");
 *     }
 *
 *     // ✅ Typed session access
 *     const userId = typedSess.user.id;
 *     const role = typedSess.user.role;
 *   }
 * });
 * ```
 */
export function typedSession<TApp>(
	session: unknown,
): InferSessionFromApp<TApp> | null | undefined {
	return session as InferSessionFromApp<TApp> | null | undefined;
}

/**
 * Add types to entire context object.
 * This is a compile-time only type cast - no runtime effect.
 *
 * Use this in hooks and access control functions to get fully typed access to:
 * - `ctx.app` - your specific app instance with queues, email, etc.
 * - `ctx.session` - typed session from Better Auth
 * - `ctx.db` - typed Drizzle client with your schema
 *
 * @template TApp - Your app type (e.g., `typeof app` or `App`)
 *
 * @example
 * ```ts
 * import { typedContext } from "questpie";
 * import type { App } from "./questpie";
 *
 * .access({
 *   read: (ctx) => {
 *     const { session, app, db } = typedContext<App>(ctx);
 *
 *     // ✅ session.user is fully typed
 *     if (session?.user.role !== "admin") return false;
 *
 *     // ✅ app has your specific queues, collections, etc.
 *     await app.queue.notifications.publish({ ... });
 *
 *     // ✅ db is typed with your schema
 *     const logs = await db.query.auditLogs.findMany({ ... });
 *
 *     return true;
 *   }
 * })
 * ```
 */

// Type helpers for smart return type based on input
type TypedContextReturn<TApp, TCtx> = {
	app: TCtx extends { app: unknown } ? InferAppFromApp<TApp> : never;
	session: TCtx extends { session: infer S }
		? S
		: InferSessionFromApp<TApp> | null | undefined;
	db: TCtx extends { db: unknown } ? InferDbFromApp<TApp> : never;
	locale: TCtx extends { locale: infer L } ? L : string | undefined;
	accessMode: TCtx extends { accessMode: infer A } ? A : string | undefined;
	stage: TCtx extends { stage: infer S } ? S : string | undefined;
};

export function typedContext<
	TApp,
	TCtx extends {
		app?: unknown;
		session?: unknown | null;
		db?: unknown;
		locale?: string;
		accessMode?: string;
		stage?: string;
	},
>(ctx: TCtx): TypedContextReturn<TApp, TCtx> {
	return ctx as unknown as TypedContextReturn<TApp, TCtx>;
}

// ============================================================================
// CONTEXT ACCESS (runtime - AsyncLocalStorage)
//
// These functions actually retrieve context from AsyncLocalStorage at runtime.
// Pattern: get* prefix indicates actual runtime retrieval
// ============================================================================

/**
 * Internal AsyncLocalStorage for request-scoped context.
 * Used when getContext() is called to retrieve implicit context.
 */
const appContextStorage = new AsyncLocalStorage<{
	app: unknown;
	session?: unknown | null;
	db?: unknown;
	locale?: string;
	accessMode?: string;
	stage?: string;
}>();

/**
 * Stored context shape returned by tryGetContext.
 */
export interface StoredContext {
	app: unknown;
	session?: unknown | null;
	db?: unknown;
	locale?: string;
	accessMode?: string;
	stage?: string;
}

/**
 * Try to get stored context from AsyncLocalStorage.
 * Returns undefined if not in runWithContext scope.
 *
 * This is the safe version of getContext() - it won't throw if called
 * outside of a request scope. Useful for optional context access.
 *
 * @example
 * ```ts
 * import { tryGetContext } from "questpie";
 *
 * function maybeLogUser() {
 *   const ctx = tryGetContext();
 *   if (ctx?.session) {
 *     console.log("User:", ctx.session.user.id);
 *   }
 * }
 * ```
 */
export function tryGetContext(): StoredContext | undefined {
	return appContextStorage.getStore();
}

/**
 * Run code within a request context scope.
 * Context set here can be retrieved via getContext<TApp>() without parameters.
 *
 * @example
 * ```ts
 * await runWithContext({ app: app, session, db, locale: "sk" }, async () => {
 *   // Inside here, getContext<TApp>() works without parameters
 *   const { session, locale } = getContext<App>();
 *   // locale === "sk"
 * });
 * ```
 */
export function runWithContext<T>(
	ctx: {
		app: unknown;
		session?: unknown | null;
		db?: unknown;
		locale?: string;
		accessMode?: string;
		stage?: string;
	},
	fn: () => T | Promise<T>,
): Promise<T> {
	return appContextStorage.run(ctx, fn) as Promise<T>;
}

/**
 * Get typed context from AsyncLocalStorage.
 *
 * Must be called within runWithContext() scope - throws if no context available.
 * For safe access that returns undefined, use tryGetContext().
 *
 * All CRUD operations automatically run within runWithContext() scope,
 * so this works in hooks, access control, and nested API calls.
 *
 * @example
 * ```ts
 * import { getContext } from "questpie";
 * import type { App } from "./questpie";
 *
 * // In a reusable function called from hooks
 * async function logActivity(action: string) {
 *   const { db, session, locale } = getContext<App>();
 *
 *   await db.insert(activityLog).values({
 *     userId: session?.user.id,
 *     action,
 *     locale,
 *   });
 * }
 *
 * // Usage in hook - works because CRUD runs within runWithContext
 * const posts = q.collection("posts").hooks({
 *   afterChange: async () => {
 *     await logActivity("post_updated"); // ✅ Context available
 *   }
 * });
 * ```
 *
 * @throws Error if called outside runWithContext scope
 */
export function getContext<TApp>(): {
	app: InferAppFromApp<TApp>;
	session: InferSessionFromApp<TApp> | null | undefined;
	db: InferDbFromApp<TApp>;
	locale: string | undefined;
	accessMode: string | undefined;
	stage: string | undefined;
} {
	const stored = appContextStorage.getStore();
	if (!stored) {
		throw new Error(
			"getContext() called outside request scope. " +
				"Either call within runWithContext() scope, or use tryGetContext() for safe access.",
		);
	}
	return stored as any;
}

// ============================================================================
// Request Context Types
// ============================================================================

/**
 * Base request context properties (always present).
 */
export interface BaseRequestContext {
	/**
	 * Auth session from Better Auth (contains user + session).
	 * - undefined = session not resolved (e.g. system operation without request)
	 * - null = explicitly unauthenticated
	 * - object = authenticated session with user
	 *
	 * @example
	 * ```ts
	 * // Check if authenticated
	 * if (!ctx.session) {
	 *   throw new Error('Unauthorized');
	 * }
	 *
	 * // Access user
	 * const userId = ctx.session.user.id;
	 * const role = ctx.session.user.role;
	 *
	 * // Access session metadata
	 * const expiresAt = ctx.session.session.expiresAt;
	 * ```
	 */
	session?: { user: User; session: Session } | null;

	/**
	 * Current locale for this request
	 */
	locale?: string;

	/**
	 * Default locale (fallback)
	 */
	defaultLocale?: string;

	/**
	 * Whether to fallback to default locale when current locale translation is missing.
	 */
	localeFallback?: boolean;

	/**
	 * Access mode - defaults to 'system' since API is backend-only.
	 * Set to 'user' explicitly when handling user requests with access control.
	 */
	accessMode?: AccessMode;

	/**
	 * Workflow stage for stage-aware reads/writes.
	 *
	 * When omitted, operations use the workflow initial stage.
	 */
	stage?: string;

	/**
	 * Database client - may be transaction within hook/handler scope.
	 * All operations on this client participate in the current transaction if one is active.
	 *
	 * @example
	 * ```ts
	 * afterChange: async ({ db, data }) => {
	 *   // This INSERT is part of the same transaction as the main CRUD operation
	 *   await db.insert(auditLog).values({
	 *     recordId: data.id,
	 *     action: 'created',
	 *     timestamp: new Date()
	 *   });
	 * }
	 * ```
	 */
	db?: any;
}

/**
 * Full request context including user-defined extensions.
 *
 * Extend via module augmentation:
 * ```ts
 * declare module 'questpie' {
 *   interface QuestpieContextExtension {
 *     tenantId: string | null
 *   }
 * }
 * ```
 *
 * Then in access functions:
 * ```ts
 * .access({
 *   read: ({ ctx }) => {
 *     ctx.tenantId // ✅ Typed as string | null
 *   }
 * })
 * ```
 */
export type RequestContext = BaseRequestContext &
	QuestpieContextExtension & {
		/**
		 * Allow additional properties for backwards compatibility.
		 */
		[key: string]: unknown;
	};
