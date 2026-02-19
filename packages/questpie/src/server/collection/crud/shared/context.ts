/**
 * Shared Context Utilities
 *
 * Provides context normalization and database access utilities
 * used across CRUD operations.
 *
 * ## Context Propagation
 *
 * `normalizeContext()` automatically inherits `locale` and `accessMode` from
 * the current `runWithContext` scope (via AsyncLocalStorage) when not explicitly
 * provided. This enables implicit context propagation in nested API calls.
 *
 * @example
 * ```typescript
 * // Parent operation sets context
 * await runWithContext({ app: app, locale: "sk" }, async () => {
 *   // Nested API call automatically inherits locale
 *   const posts = await app.api.collections.posts.find();
 *   // posts are fetched with locale: "sk"
 * });
 * ```
 *
 * This is particularly useful for:
 * - Block prefetch hooks fetching related data
 * - Custom functions calling multiple collections
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
 * Automatically inherits locale, accessMode, and stage from AsyncLocalStorage
 * if not explicitly provided. This enables implicit context propagation
 * in nested API calls (e.g., prefetch hooks calling collection.find()).
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
