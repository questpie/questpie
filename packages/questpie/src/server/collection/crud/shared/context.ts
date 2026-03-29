/**
 * Shared Context Utilities
 *
 * Provides context normalization and database access utilities
 * used across CRUD operations.
 *
 * ## Context Propagation
 *
 * `normalizeContext()` automatically inherits `locale`, `accessMode`, `session`,
 * and `stage` from the current `runWithContext` scope (via AsyncLocalStorage)
 * when not explicitly provided. This enables implicit context propagation in
 * nested API calls without manual threading.
 *
 * ### Propagation priority (highest → lowest):
 * 1. **Explicit param** — values passed directly to `normalizeContext(ctx)`
 * 2. **ALS stored** — values set by the nearest `runWithContext()` ancestor
 * 3. **Defaults** — `accessMode: "system"`, `locale: "en"`
 *
 * ### session propagation in partial overrides
 *
 * When you override only `accessMode` inside a function handler (e.g. to
 * perform a user-level CRUD check), `session` is automatically inherited from
 * the ALS scope, so you don't need to thread it manually:
 *
 * ```typescript
 * // Inside a function handler — session comes from the request ALS scope
 * const posts = await app.collections.posts.find({ accessMode: "user" });
 * // ↑ session auto-merged from ALS, no need to pass it explicitly
 * ```
 *
 * @example
 * ```typescript
 * // HTTP adapter sets context via runWithContext for the entire request
 * await runWithContext({ locale: "sk", session, accessMode: "user" }, async () => {
 *   // All nested CRUD calls inherit locale + session automatically
 *   const posts = await app.collections.posts.find();
 *   // posts fetched with locale: "sk", session from request
 * });
 * ```
 *
 * This is particularly useful for:
 * - Function handlers that call multiple collections (locale + session propagate)
 * - Block prefetch hooks fetching related data
 * - Hooks that need to query other entities
 */

import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import { tryGetContext } from "#questpie/server/config/context.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

/**
 * Normalized context with required fields
 */
export type NormalizedContext = Required<
	Pick<CRUDContext, "accessMode" | "locale" | "defaultLocale">
> &
	CRUDContext;

/**
 * Normalize context with defaults
 *
 * Merges the explicit context with inherited values from AsyncLocalStorage (ALS).
 * Priority: explicit param > ALS stored > defaults.
 *
 * **session** is always inherited from ALS when not explicitly provided.
 * This means that if you only override `accessMode` inside a function handler,
 * the caller's session is still available for access checks — no manual threading.
 *
 * @param context - Optional CRUD context
 * @returns Context with required fields populated with defaults
 *
 * @default accessMode: 'system' - API is backend-only by default
 * @default locale: 'en' - Falls back to stored → defaultLocale → 'en'
 * @default defaultLocale: 'en'
 */
export function normalizeContext(context: CRUDContext = {}): NormalizedContext {
	// Try to inherit from AsyncLocalStorage if not explicitly provided
	const stored = tryGetContext();

	// Only use stored accessMode if it's a valid value
	const storedAccessMode = stored?.accessMode as "user" | "system" | undefined;

	return {
		...context,
		// session: always inherit from ALS when not explicitly provided.
		// Critical for partial overrides like { accessMode: "user" } inside
		// function handlers — the caller's session propagates automatically.
		// Cast needed: StoredContext.session is `unknown` (generic ALS store),
		// but here we know it matches the CRUD session shape.
		session: context.session ?? (stored?.session as CRUDContext["session"]),
		accessMode: context.accessMode ?? storedAccessMode ?? "system",
		locale:
			context.locale ??
			stored?.locale ??
			context.defaultLocale ??
			DEFAULT_LOCALE,
		defaultLocale: context.defaultLocale ?? DEFAULT_LOCALE,
		stage: context.stage ?? stored?.stage,
	};
}

/**
 * Get database instance from context or fallback
 *
 * @param defaultDb - Default database instance
 * @param context - Optional CRUD context with potential db override
 * @returns Database instance to use for the operation
 */
export function getDb(defaultDb: any, context?: CRUDContext): any {
	return context?.db ?? defaultDb;
}
