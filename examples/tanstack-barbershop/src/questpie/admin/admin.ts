import { builder } from "./builder";

// ============================================================================
// Admin UI Configuration
// ============================================================================

/**
 * Admin configuration for the barbershop app.
 *
 * Sidebar, dashboard, branding, and admin locales are configured on the SERVER (cms.ts).
 * The client only carries registries (fields, views, components, widgets).
 *
 * Translations are configured on the server via:
 * - .adminLocale({ locales: ["en", "sk"], defaultLocale: "en" })
 * - .messages({ en: {...}, sk: {...} })
 *
 * The client fetches translations from the server via getAdminTranslations() RPC.
 */
export const admin = builder;

export type AdminConfig = typeof admin;
