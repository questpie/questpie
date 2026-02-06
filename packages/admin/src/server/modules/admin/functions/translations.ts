/**
 * Admin Translations Functions
 *
 * Functions for retrieving admin UI translations from the server.
 * The client fetches translations for its current UI locale.
 *
 * This enables:
 * - Single source of truth for all translations on server
 * - Dynamic locale switching without bundling all languages
 * - Custom messages via .messages() on QuestpieBuilder
 */

import { fn, type Questpie } from "questpie";
import { z } from "zod";
import type { AdminLocaleConfig } from "../../../augmentation.js";
import {
  type AdminMessages,
  getAdminMessagesForLocale,
  getSupportedAdminLocales,
} from "../../../i18n/index.js";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Helper to get typed CMS app from handler context.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
  return ctx.app as Questpie<any>;
}

/**
 * Get admin locale config from CMS state.
 */
function getAdminLocaleConfig(
  cms: Questpie<any>,
): AdminLocaleConfig | undefined {
  return (cms as any).state?.adminLocale;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const getAdminTranslationsSchema = z.object({
  /** Requested locale code */
  locale: z.string(),
});

const messageValueSchema = z.union([
  z.string(),
  z.object({ one: z.string(), other: z.string() }),
]);

const getAdminTranslationsOutputSchema = z.object({
  /** Actual locale returned (may differ from requested if not supported) */
  locale: z.string(),
  /** Messages for the locale */
  messages: z.record(z.string(), messageValueSchema),
  /** Fallback locale */
  fallbackLocale: z.string(),
});

const getAdminLocalesSchema = z.object({}).optional();

const getAdminLocalesOutputSchema = z.object({
  /** Available UI locales */
  locales: z.array(z.string()),
  /** Default UI locale */
  defaultLocale: z.string(),
});

// ============================================================================
// Functions
// ============================================================================

/**
 * Get admin UI translations for a specific locale.
 *
 * Merges:
 * 1. Built-in admin messages for the locale
 * 2. Custom messages from .messages() on QuestpieBuilder
 *
 * Custom messages override built-in messages with the same key.
 *
 * @example
 * ```ts
 * // Client fetches translations
 * const { messages, locale, fallbackLocale } = await client.functions.getAdminTranslations({
 *   locale: "sk",
 * });
 *
 * // messages contains all admin UI strings in Slovak
 * ```
 */
export const getAdminTranslations = fn({
  type: "query",
  schema: getAdminTranslationsSchema,
  outputSchema: getAdminTranslationsOutputSchema,
  handler: async (ctx) => {
    const cms = getApp(ctx);
    const input = ctx.input as z.infer<typeof getAdminTranslationsSchema>;
    const requestedLocale = input.locale;

    // Get admin locale config (set via .adminLocale())
    const adminLocaleConfig = getAdminLocaleConfig(cms);
    const supportedLocales =
      adminLocaleConfig?.locales ?? getSupportedAdminLocales();
    const defaultLocale = adminLocaleConfig?.defaultLocale ?? "en";

    // Resolve locale - fall back to default if not supported
    const locale = supportedLocales.includes(requestedLocale)
      ? requestedLocale
      : defaultLocale;

    // Get built-in admin messages for this locale
    const builtInMessages = getAdminMessagesForLocale(locale);

    // Get custom messages from .messages() on QuestpieBuilder
    const customMessages = cms.config.translations?.messages?.[locale] ?? {};

    // Merge: custom messages override built-in
    const messages: AdminMessages = {
      ...builtInMessages,
      ...customMessages,
    };

    return {
      locale,
      messages,
      fallbackLocale: defaultLocale,
    };
  },
});

/**
 * Get available admin UI locales.
 *
 * Returns locales configured via .adminLocale() or defaults to
 * all locales that have built-in message files.
 *
 * @example
 * ```ts
 * const { locales, defaultLocale } = await client.functions.getAdminLocales({});
 * // locales: ["en", "sk"]
 * // defaultLocale: "en"
 * ```
 */
export const getAdminLocales = fn({
  type: "query",
  schema: getAdminLocalesSchema,
  outputSchema: getAdminLocalesOutputSchema,
  handler: async (ctx) => {
    const cms = getApp(ctx);
    const adminLocaleConfig = getAdminLocaleConfig(cms);

    return {
      locales: adminLocaleConfig?.locales ?? getSupportedAdminLocales(),
      defaultLocale: adminLocaleConfig?.defaultLocale ?? "en",
    };
  },
});

// ============================================================================
// Export Bundle
// ============================================================================

/**
 * Bundle of translation-related functions.
 */
export const translationFunctions = {
  getAdminTranslations,
  getAdminLocales,
} as const;
