import { AsyncLocalStorage } from "node:async_hooks";
import type { Session, User } from "better-auth/types";
import type { AccessMode } from "./types.js";

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Infer the Session type from a CMS app instance.
 *
 * @example
 * ```ts
 * type MySession = InferSessionFromApp<typeof cms>;
 * ```
 */
export type InferSessionFromApp<TApp> = TApp extends {
  auth: { $Infer: { Session: infer S } };
}
  ? S
  : { user: User; session: Session };

/**
 * Infer the database type from a CMS app instance.
 *
 * @example
 * ```ts
 * type MyDb = InferDbFromApp<typeof cms>;
 * ```
 */
export type InferDbFromApp<TApp> = TApp extends { db: infer D } ? D : any;

/**
 * Extract base CMS type without functions to avoid circular dependencies.
 * Useful when defining functions that need to reference the CMS instance.
 *
 * @example
 * ```ts
 * // In cms.ts - create base instance
 * const baseInstance = q({ name: "app" })
 *   .collections({ posts })
 *   .jobs({ sendEmail })
 *   .build();
 *
 * export type BaseCMS = InferBaseCMS<typeof baseInstance>;
 *
 * // In functions/index.ts
 * import type { BaseCMS } from "../cms";
 *
 * export const getPosts = q.fn({
 *   handler: async ({ app }) => {
 *     const cms = getApp<BaseCMS>(app);
 *     return cms.api.collections.posts.find(); // ✅ Typed
 *   }
 * });
 * ```
 */
export type InferBaseCMS<T> = T extends { config: infer TConfig }
  ? { config: Omit<TConfig, "functions">; [key: string]: any }
  : never;

/**
 * Get typed CMS app instance from hook/job/function context.
 * Provides type-safe access to your CMS configuration and services.
 *
 * @example
 * ```ts
 * import { getApp } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ app }) => {
 *     const cms = getApp<AppCMS>(app);
 *     // ✅ Fully typed access
 *     await cms.api.collections.posts.find();
 *     await cms.queue.sendEmail.publish({ to: "user@example.com" });
 *   }
 * });
 * ```
 */
export function getApp<TApp>(app: unknown): TApp {
  return app as TApp;
}

/**
 * Get typed database client from hook/job/function context.
 * The db client may be a transaction within the current operation scope.
 *
 * @example
 * ```ts
 * import { getDb } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ app, db }) => {
 *     const cms = getApp<AppCMS>(app);
 *     const typedDb = getDb<AppCMS>(db);
 *
 *     // ✅ Fully typed Drizzle operations
 *     await typedDb.select().from(cms.config.collections.posts.table);
 *   }
 * });
 * ```
 */
export function getDb<TApp>(db: unknown): InferDbFromApp<TApp> {
  return db as InferDbFromApp<TApp>;
}

/**
 * Get typed session from hook/job/function context.
 * Returns null if unauthenticated, undefined if session not resolved.
 *
 * @example
 * ```ts
 * import { getSession } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * const posts = q.collection("posts").hooks({
 *   afterChange: async ({ session }) => {
 *     const typedSession = getSession<AppCMS>(session);
 *
 *     if (!typedSession) {
 *       throw new Error("Unauthorized");
 *     }
 *
 *     // ✅ Typed session access
 *     const userId = typedSession.user.id;
 *     const role = typedSession.user.role;
 *   }
 * });
 * ```
 */
export function getSession<TApp>(
  session: unknown,
): InferSessionFromApp<TApp> | null | undefined {
  return session as InferSessionFromApp<TApp> | null | undefined;
}

/**
 * Infer the app/CMS type from a CMS app instance.
 *
 * @example
 * ```ts
 * type MyApp = InferAppFromApp<typeof cms>;
 * ```
 */
export type InferAppFromApp<TApp> = TApp;

/**
 * Fully typed context helper - casts all context properties to their proper types.
 *
 * Use this in hooks and access control functions to get fully typed access to:
 * - `ctx.app` - your specific CMS instance with queues, email, etc.
 * - `ctx.session` - typed session from Better Auth
 * - `ctx.db` - typed Drizzle client with your schema
 *
 * @template TApp - Your CMS type (e.g., `typeof cms` or `AppCMS`)
 *
 * @example
 * ```ts
 * import { getContext } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * .access({
 *   read: (ctx) => {
 *     const { session, app, db } = getContext<AppCMS>(ctx);
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

// ============================================================================
// AsyncLocalStorage for Implicit Context
// ============================================================================

/**
 * Internal AsyncLocalStorage for request-scoped context.
 * Used when getContext() is called without explicit context parameter.
 */
const cmsContextStorage = new AsyncLocalStorage<{
  app: unknown;
  session?: unknown | null;
  db?: unknown;
  locale?: string;
  accessMode?: string;
}>();

/**
 * Run code within a request context scope.
 * Context set here can be retrieved via getContext<TApp>() without parameters.
 *
 * @example
 * ```ts
 * await runWithContext({ app: cms, session, db }, async () => {
 *   // Inside here, getContext<AppCMS>() works without parameters
 *   const { session } = getContext<AppCMS>();
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
  },
  fn: () => T | Promise<T>,
): Promise<T> {
  return cmsContextStorage.run(ctx, fn) as Promise<T>;
}

/**
 * Get typed context - supports both explicit and implicit patterns.
 *
 * **Explicit pattern** (recommended for hooks/access control):
 * Pass context object directly from handler parameters.
 * ```ts
 * .access({
 *   read: (ctx) => {
 *     const { session, app, db } = getContext<AppCMS>(ctx);
 *     return session?.user.role === "admin";
 *   }
 * })
 * ```
 *
 * **Implicit pattern** (useful in reusable functions):
 * Call without parameters to get context from AsyncLocalStorage.
 * Must be called within runWithContext() scope.
 * ```ts
 * async function reusableHelper() {
 *   const { db, session } = getContext<AppCMS>();
 *   // db and session are typed
 * }
 *
 * // Usage
 * await runWithContext({ app: cms, session, db }, async () => {
 *   await reusableHelper(); // Works without passing context
 * });
 * ```
 */

// Type helpers for smart return type based on input
type GetContextReturn<TApp, TCtx> = {
  app: TCtx extends { app: unknown } ? InferAppFromApp<TApp> : never;
  session: TCtx extends { session: infer S }
    ? S
    : InferSessionFromApp<TApp> | null | undefined;
  db: TCtx extends { db: unknown } ? InferDbFromApp<TApp> : never;
  locale: TCtx extends { locale: infer L } ? L : string | undefined;
  accessMode: TCtx extends { accessMode: infer A } ? A : string | undefined;
};

// Overload: No context provided - gets everything from AsyncLocalStorage
export function getContext<TApp>(): {
  app: InferAppFromApp<TApp>;
  session: InferSessionFromApp<TApp> | null | undefined;
  db: InferDbFromApp<TApp>;
  locale: string | undefined;
  accessMode: string | undefined;
};

// Overload: With context object - smart return type based on what you pass
export function getContext<
  TApp,
  TCtx extends {
    app?: unknown;
    session?: unknown | null;
    db?: unknown;
    locale?: string;
    accessMode?: string;
  },
>(ctx: TCtx): GetContextReturn<TApp, TCtx>;

// Implementation
export function getContext<TApp>(ctx?: {
  app?: unknown;
  session?: unknown | null;
  db?: unknown;
  locale?: string;
  accessMode?: string;
  [key: string]: any;
}): any {
  // If explicit context provided, use it
  if (ctx) {
    return ctx;
  }

  // Otherwise, try to get from AsyncLocalStorage
  const stored = cmsContextStorage.getStore();
  if (!stored) {
    throw new Error(
      "getContext() called without explicit context and no request scope available. " +
        "Either pass context as parameter or call within runWithContext() scope.",
    );
  }

  return stored;
}

// ============================================================================
// Request Context
// ============================================================================

/**
 * Minimal per-request context.
 * Contains session, locale, accessMode, and optional db override.
 * Services are accessed via app.* not context.*
 */
export interface RequestContext {
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
   * Access mode - defaults to 'system' since CMS API is backend-only.
   * Set to 'user' explicitly when handling user requests with access control.
   */
  accessMode?: AccessMode;

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

  /**
   * Allow extensions for custom context properties.
   * Use `extendContext` in adapter config to add custom properties.
   */
  [key: string]: unknown;
}
