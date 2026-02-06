/**
 * Content Locales Functions
 *
 * Functions for retrieving available content locales from the CMS configuration.
 * Used by the admin panel to populate locale switchers and validate locale selection.
 */

import { fn, type Questpie } from "questpie";
import { z } from "zod";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Helper to get typed CMS app from handler context.
 */
function getApp(ctx: { app: unknown }): Questpie<any> {
  return ctx.app as Questpie<any>;
}

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
 * Get available content locales from CMS configuration.
 *
 * Returns the list of available locales for content localization,
 * the default locale, and any fallback mappings.
 *
 * @example
 * ```ts
 * const result = await client.rpc.getContentLocales({});
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
export const getContentLocales = fn({
  type: "query",
  schema: getContentLocalesSchema,
  outputSchema: getContentLocalesOutputSchema,
  handler: async (ctx) => {
    const cms = getApp(ctx);
    const localeConfig = cms.config.locale;

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
  },
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
