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
 * Infer the app/app type from a app instance.
 *
 * @example
 * ```ts
 * type MyApp = InferAppFromApp<typeof app>;
 * ```
 */
export type InferAppFromApp<TApp> = TApp;

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
	_hookDepth?: number;
}>();

/** Maximum recursion depth for hook-triggered CRUD operations */
const MAX_HOOK_RECURSION = 5;

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
	_hookDepth?: number;
}

/**
 * Increment hook recursion depth and throw if limit exceeded.
 * Call this at the start of each CRUD operation to prevent infinite loops
 * caused by hooks triggering more CRUD operations.
 */
export function guardHookRecursion(): number {
	const ctx = appContextStorage.getStore();
	const depth = (ctx?._hookDepth ?? 0) + 1;
	if (depth > MAX_HOOK_RECURSION) {
		throw new Error(
			`[QUESTPIE] Maximum hook recursion depth (${MAX_HOOK_RECURSION}) exceeded. ` +
				"A lifecycle hook is likely triggering CRUD operations that re-trigger the same hook.",
		);
	}
	if (depth >= 3) {
		console.warn(
			`[QUESTPIE] Hook recursion depth at ${depth} — review hooks for potential infinite loops`,
		);
	}
	return depth;
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
		_hookDepth?: number;
	},
	fn: () => T | Promise<T>,
): Promise<T> {
	// Inherit hook depth from parent context if not explicitly set
	if (ctx._hookDepth === undefined) {
		const parent = appContextStorage.getStore();
		if (parent?._hookDepth !== undefined) {
			ctx._hookDepth = parent._hookDepth;
		}
	}
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
 * // collections/posts/index.ts
 * export default collection("posts", {
 *   hooks: {
 *     afterChange: async () => {
 *       await logActivity("post_updated"); // ✅ Context available
 *     },
 *   },
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
