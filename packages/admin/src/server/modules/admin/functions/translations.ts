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
 * Helper to get typed app from handler context.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
	return ctx.app as Questpie<any>;
}

/**
 * Get admin locale config from app state.
 */
function getAdminLocaleConfig(
	app: Questpie<any>,
): AdminLocaleConfig | undefined {
	return (app as any).state?.adminLocale;
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
 * const { messages, locale, fallbackLocale } = await client.rpc.getAdminTranslations({
 *   locale: "sk",
 * });
 *
 * // messages contains all admin UI strings in Slovak
 * ```
 */
const getAdminTranslations = fn({
	type: "query",
	schema: getAdminTranslationsSchema,
	outputSchema: getAdminTranslationsOutputSchema,
	handler: async (ctx) => {
		const app = getApp(ctx);
		const input = ctx.input as z.infer<typeof getAdminTranslationsSchema>;
		const requestedLocale = input.locale;

		// Get admin locale config (set via .adminLocale())
		const adminLocaleConfig = getAdminLocaleConfig(app);
		const supportedLocales =
			adminLocaleConfig?.locales ?? getSupportedAdminLocales();
		const defaultLocale = adminLocaleConfig?.defaultLocale ?? "en";

		// Resolve locale - fall back to default if not supported
		const locale = supportedLocales.includes(requestedLocale)
			? requestedLocale
			: defaultLocale;

		// Get built-in admin messages for this locale
		const builtInMessages = getAdminMessagesForLocale(locale);

		// Get fallback messages (English by default) so missing keys still resolve
		const fallbackMessages =
			locale !== defaultLocale ? getAdminMessagesForLocale(defaultLocale) : {};

		// Get custom messages from .messages() on QuestpieBuilder
		const customFallbackMessages =
			locale !== defaultLocale
				? (app.config.translations?.messages?.[defaultLocale] ?? {})
				: {};
		const customMessages = app.config.translations?.messages?.[locale] ?? {};

		// Merge: fallback → built-in → custom (later overrides earlier)
		const messages: AdminMessages = {
			...fallbackMessages,
			...customFallbackMessages,
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
 * const { locales, defaultLocale } = await client.rpc.getAdminLocales({});
 * // locales: ["en", "sk"]
 * // defaultLocale: "en"
 * ```
 */
const getAdminLocales = fn({
	type: "query",
	schema: getAdminLocalesSchema,
	outputSchema: getAdminLocalesOutputSchema,
	handler: async (ctx) => {
		const app = getApp(ctx);
		const adminLocaleConfig = getAdminLocaleConfig(app);

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
