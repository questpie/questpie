/**
 * City Portal Admin Configuration
 *
 * Admin configuration for the city-portal app.
 *
 * Sidebar, dashboard, branding, and admin locales are configured on the SERVER (cms.ts).
 * The client only carries registries (fields, views, components, widgets).
 *
 * Translations are configured on the server via:
 * - .adminLocale({ locales: ["en"], defaultLocale: "en" })
 *
 * The client fetches translations from the server via getAdminTranslations() RPC.
 */

import { builder } from "./builder";

export const admin = builder;

export type AdminConfig = typeof admin;
