import { builder } from "./builder";

// ============================================================================
// Admin UI Configuration
// ============================================================================

/**
 * Admin configuration for the barbershop app.
 *
 * Sidebar, dashboard, and branding are configured on the SERVER (cms.ts).
 * The client only carries locale config and registries (fields, views, etc.)
 *
 * Translations are configured on the server via:
 * - .adminLocale({ locales: ["en", "sk"], defaultLocale: "en" })
 * - .messages({ en: {...}, sk: {...} })
 *
 * The client fetches translations from the server via getAdminTranslations() RPC.
 */
export const admin = builder.locale({
  default: "en",
  supported: ["en", "sk"],
});

export type AdminConfig = typeof admin;
