import { AsyncLocalStorage } from "node:async_hooks";

import type { Auth, BetterAuthOptions } from "better-auth";
import type { Session, User } from "better-auth/types";

import type { AuthorityActor } from "../modules/core/integrated/crdt/authority.js";
import type { LoggerService } from "../modules/core/integrated/logger/service.js";
import type { InternalContextStore } from "./internal-context.js";
import type { AccessMode } from "./types.js";

export type RequestContextLogger = LoggerService;

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

type SessionMarker<TAuthConfig> = TAuthConfig extends {
	__questpieSessionType__?: infer TSession;
}
	? NonNullable<TSession>
	: never;

type BetterAuthSessionFromConfig<TAuthConfig> = Auth<
	TAuthConfig extends BetterAuthOptions ? TAuthConfig : BetterAuthOptions
>["$Infer"]["Session"];

type MergeSessionShapes<TBase, TOverride> = [TOverride] extends [never]
	? TBase
	: TBase extends { user: infer TBaseUser; session: infer TBaseSession }
		? TOverride extends {
				user: infer TOverrideUser;
				session: infer TOverrideSession;
			}
			? {
					user: TBaseUser & TOverrideUser;
					session: TBaseSession & TOverrideSession;
				}
			: TBase & TOverride
		: TBase & TOverride;

/**
 * Infer custom request-context extensions from `config/app.ts`.
 *
 * This extracts the return shape of `appConfig({ context })` so generated
 * `AppContext` can expose those request-scoped properties without relying on
 * `typeof app`.
 */
export type InferContextExtensionsFromAppConfig<TAppConfig> =
	TAppConfig extends {
		context?: infer TContext;
	}
		? TContext extends (...args: any[]) => infer TResult
			? NonNullable<Awaited<TResult>> extends Record<string, any>
				? NonNullable<Awaited<TResult>>
				: {}
			: {}
		: {};

/**
 * Infer request-context extensions from a generated app instance.
 *
 * Reads the `"~contextExtensions"` phantom that codegen sets on the app's
 * `QuestpieConfig` — a single shallow conditional, no deep inference.
 * Used by `getContext<App>()` to expose resolver-derived keys.
 */
export type InferContextExtensionsFromApp<TApp> = TApp extends {
	config: { "~contextExtensions"?: infer T };
}
	? NonNullable<T>
	: {};

/**
 * Infer the Session type from a Better Auth config object.
 *
 * Used by generated code to avoid recursive `typeof app` references while still
 * preserving plugin-extended session/user fields.
 */
export type InferSessionFromAuthConfig<TAuthConfig> = [
	SessionMarker<TAuthConfig>,
] extends [never]
	? BetterAuthSessionFromConfig<TAuthConfig>
	: MergeSessionShapes<
			BetterAuthSessionFromConfig<TAuthConfig>,
			SessionMarker<TAuthConfig>
		>;

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
const appContextStorage = new AsyncLocalStorage<
	{
		app: unknown;
		session?: unknown | null;
		principal?: Principal;
		actor?: AuthorityActor;
		db?: unknown;
		locale?: string;
		accessMode?: string;
		stage?: string;
		requestId?: string;
		traceId?: string;
		workload?: { type: string; id: string; name?: string };
		logger?: RequestContextLogger;
		_hookDepth?: number;
		"~contextExtensions"?: Record<string, unknown>;
	} & InternalContextStore
>();

/** Maximum recursion depth for hook-triggered CRUD operations */
const MAX_HOOK_RECURSION = 5;

/**
 * Stored context shape returned by tryGetContext.
 */
export interface StoredContext {
	app: unknown;
	session?: unknown | null;
	principal?: Principal;
	actor?: AuthorityActor;
	db?: unknown;
	locale?: string;
	accessMode?: string;
	stage?: string;
	requestId?: string;
	traceId?: string;

	/** Identity of the service or workload performing a system-scoped operation. */
	workload?: { type: string; id: string; name?: string };

	/** Request-scoped logger override, primarily for explicit adapters and tests. */
	logger?: RequestContextLogger;
	_hookDepth?: number;
	/**
	 * Request-context extensions resolved by `appConfig({ context })`.
	 * Carried as one bundle so nested CRUD inherits it like `session`/`db`.
	 * @internal
	 */
	"~contextExtensions"?: Record<string, unknown>;
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
	if (depth >= MAX_HOOK_RECURSION - 1) {
		(
			ctx?.logger ?? (ctx?.app as { logger?: RequestContextLogger })?.logger
		)?.warn(
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
		principal?: Principal;
		actor?: AuthorityActor;
		db?: unknown;
		locale?: string;
		accessMode?: string;
		stage?: string;
		requestId?: string;
		traceId?: string;
		workload?: { type: string; id: string; name?: string };
		logger?: RequestContextLogger;
		_hookDepth?: number;
		"~contextExtensions"?: Record<string, unknown>;
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
	// Cast needed because some @types/node versions type AsyncLocalStorage.run() as returning void
	return appContextStorage.run(
		ctx as StoredContext & InternalContextStore,
		fn,
	) as unknown as Promise<T>;
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
export function getContext<TApp>(): InferContextExtensionsFromApp<TApp> & {
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
	const extensions = stored["~contextExtensions"];
	if (!extensions) {
		return stored as any;
	}
	// Extensions flat on the result; base keys win.
	return { ...extensions, ...stored } as any;
}

// ============================================================================
// Principal (identity on the request context)
// ============================================================================

/**
 * Discriminated identity for a request.
 *
 * Generalizes the implicit "session is the only identity" model. The variant
 * discriminates how the request was authenticated:
 * - `user` — cookie / bearer-session (first-party admin). Today's session path.
 * - `oauth` — an OAuth 2.1 access token. Resolves to a real `user` plus the
 *   consented `scopes`; RBAC still applies as that user (scopes are an
 *   additional gate). Nothing constructs this variant yet — it is populated by
 *   a later task once token verification lands.
 * - `system` — stdio / internal / trusted worker. Bypasses access control,
 *   matching today's `accessMode: "system"` path.
 *
 * `accessMode` is derived from `kind` (`system` ⇔ `kind: "system"`, else
 * `"user"`), so every existing reader of `accessMode` keeps working unchanged.
 */
export type Principal =
	| { kind: "user"; user: User; session: Session }
	| {
			kind: "oauth";
			user: User;
			clientId: string;
			scopes: string[];
			tokenId: string;
	  }
	| { kind: "system" };

/**
 * Derive the legacy `accessMode` from a principal.
 *
 * `system` principal ⇔ `"system"` (full-access bypass); every other principal
 * (`user`, `oauth`) ⇔ `"user"` (access control applies).
 */
export function accessModeForPrincipal(principal: Principal): AccessMode {
	return principal.kind === "system" ? "system" : "user";
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
	 * Discriminated identity for this request (`user` / `oauth` / `system`).
	 *
	 * The richer source of truth that `accessMode` is derived from. `session`
	 * stays populated for back-compat; `principal` additionally carries the
	 * OAuth `scopes` when the request is authenticated by an access token.
	 * Access rules receive this so later work can gate on `principal.scopes`.
	 *
	 * Undefined when no identity has been resolved (e.g. a system operation
	 * without a request).
	 */
	principal?: Principal;

	/**
	 * Stable Human/Agent authority actor for collaboration-aware access rules.
	 * Legacy request authentication remains available separately as `principal`.
	 */
	actor?: AuthorityActor;

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
	 * Stable identifier for this HTTP request. Propagated from `x-request-id`
	 * when present, otherwise generated by the HTTP adapter.
	 */
	requestId?: string;

	/**
	 * Distributed trace identifier. Propagated from `x-trace-id` or W3C
	 * `traceparent` when present, otherwise aligned with `requestId`.
	 */
	traceId?: string;

	/** Identity of the service or workload performing a system-scoped operation. */
	workload?: { type: string; id: string; name?: string };

	/** Request-scoped logger override, primarily for explicit adapters and tests. */
	logger?: RequestContextLogger;

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
	 * Request-context extensions resolved by `appConfig({ context })`,
	 * carried as one bundle alongside the flat-merged keys. The bundle is what
	 * travels (into access rules, hooks, ALS); the flat keys are what handlers
	 * read.
	 * @internal
	 */
	"~contextExtensions"?: Record<string, unknown>;
}

/**
 * Full request context.
 *
 * In access functions:
 * ```ts
 * .access({
 *   read: ({ ctx }) => {
 *     ctx.session // ✅ Typed
 *   }
 * })
 * ```
 */
export type RequestContext = BaseRequestContext & {
	/**
	 * Allow additional properties for backwards compatibility.
	 */
	[key: string]: unknown;
};
