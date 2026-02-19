/**
 * Admin I18n Module
 *
 * Framework-agnostic internationalization adapter for the admin UI.
 *
 * DESIGN PHILOSOPHY:
 * - We do NOT build a full i18n library - that's a solved problem
 * - We define an adapter interface for integration with existing libraries
 * - We provide adapters for popular libraries (i18next, react-intl)
 * - We include a simple built-in fallback for basic use cases
 *
 * CONCEPTS:
 * - **Content Locale**: Language of app content (posts, pages) - handled by QuestPie core
 * - **UI Locale**: Language of admin interface (buttons, labels) - handled here
 *
 * @example
 * ```tsx
 * // Option 1: Use with i18next (recommended for full i18n)
 * import { createI18nextAdapter } from "@questpie/admin/i18n/adapters/i18next";
 * import i18next from "i18next";
 *
 * const i18n = createI18nextAdapter(i18next);
 *
 * // Option 2: Use with react-intl
 * import { createReactIntlAdapter } from "@questpie/admin/i18n/adapters/react-intl";
 *
 * const i18n = createReactIntlAdapter(intl);
 *
 * // Option 3: Simple built-in (basic use cases only)
 * import { createSimpleI18n } from "@questpie/admin/i18n";
 *
 * const i18n = createSimpleI18n({
 *   locale: "en",
 *   messages: { "common.save": "Save", ... }
 * });
 *
 * // In AdminProvider
 * <AdminProvider admin={appAdmin} client={client} i18n={i18n}>
 *   ...
 * </AdminProvider>
 * ```
 */

export * from "./adapter";
export * from "./hooks";
// Re-export default English messages for admin UI
export { adminMessages } from "./messages";
export * from "./simple";
export * from "./types";
export * from "./utils";
