/**
 * Content Locales Functions
 *
 * Functions for retrieving available content locales from the app configuration.
 * Used by the admin panel to populate locale switchers and validate locale selection.
 */

import { route } from "questpie";
import { z } from "zod";

import { getApp } from "./route-helpers.js";

// ============================================================================
// Schema Definitions
// ============================================================================

const getContentLocalesSchema = z.object({}).optional();

const getContentLocalesOutputSchema = z.object({
	locales: z.array(
		z.object({
			code: z.string(),
			label: z.string().optional(),
			fallback: z.boolean().optional(),
			flagCountryCode: z.string().optional(),
		}),
	),
	defaultLocale: z.string(),
	fallbacks: z.record(z.string(), z.string()).optional(),
});

// ============================================================================
// Functions
// ============================================================================

/**
 * Get available content locales from app configuration.
 *
 * Returns the list of available locales for content localization,
 * the default locale, and any fallback mappings.
 *
 * @example
 * ```ts
 * const result = await client.routes.getContentLocales({});
 * // {
 * //   locales: [
 * //     { code: "en", label: "English", fallback: true },
 * //     { code: "sk", label: "Slovenčina" },
 * //   ],
 * //   defaultLocale: "en",
 * //   fallbacks: { "en-GB": "en" },
 * // }
 * ```
 */
const getContentLocales = route()
	.post()
	.schema(getContentLocalesSchema)
	.outputSchema(getContentLocalesOutputSchema)
	.handler(async (ctx) => {
		const app = getApp(ctx);
		const localeConfig = app.config.locale;

		// If no locale config, return sensible defaults
		if (!localeConfig) {
			return {
				locales: [{ code: "en", label: "English", fallback: true }],
				defaultLocale: "en",
			};
		}

		// Resolve locales (can be async function)
		const locales =
			typeof localeConfig.locales === "function"
				? await localeConfig.locales()
				: localeConfig.locales;

		return {
			locales: locales.map(
				(l: {
					code: string;
					label?: string;
					fallback?: boolean;
					flagCountryCode?: string;
				}) => ({
					code: l.code,
					label: l.label,
					fallback: l.fallback,
					flagCountryCode: l.flagCountryCode,
				}),
			),
			defaultLocale: localeConfig.defaultLocale,
			fallbacks: localeConfig.fallbacks,
		};
	});

// ============================================================================
// Export Bundle
// ============================================================================

/**
 * Bundle of locale-related functions.
 */
export const localeFunctions = {
	getContentLocales,
} as const;
