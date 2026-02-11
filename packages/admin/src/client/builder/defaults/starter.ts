/**
 * Admin Module (Client)
 *
 * Frontend counterpart to `adminModule` from `@questpie/admin/server`.
 * All collection admin configs, sidebar, and branding come from the server.
 * The client module only carries registries: fields, components, views, pages, widgets, blocks, translations.
 *
 * @example
 * ```ts
 * import { qa, adminModule } from "@questpie/admin/client";
 *
 * const admin = qa()
 *   .use(adminModule);
 * ```
 */

import { coreAdminModule } from "./core";

/**
 * Admin Module - the complete frontend config for QuestPie admin panel.
 *
 * All collection admin configs and sidebar come from server adminModule.
 */
export const adminModule = coreAdminModule;

/**
 * Type of admin module state
 */
export type AdminModule = typeof adminModule;
