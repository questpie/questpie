/**
 * Shared Context Utilities
 *
 * Provides context normalization and database access utilities
 * used across CRUD operations.
 */

import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
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
 * @param context - Optional CRUD context
 * @returns Context with required fields populated with defaults
 *
 * @default accessMode: 'system' - CMS API is backend-only by default
 * @default locale: 'en' - Falls back to defaultLocale, then 'en'
 * @default defaultLocale: 'en'
 */
export function normalizeContext(context: CRUDContext = {}): NormalizedContext {
  return {
    ...context,
    accessMode: context.accessMode ?? "system",
    locale: context.locale ?? context.defaultLocale ?? DEFAULT_LOCALE,
    defaultLocale: context.defaultLocale ?? DEFAULT_LOCALE,
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
