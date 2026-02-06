/**
 * Core Admin Module
 *
 * Default "batteries included" module with all built-in fields, views, and pages.
 * Uses the same extensibility API as custom modules - nothing is baked in.
 */

import { AdminBuilder } from "../admin-builder";
import { builtInComponents } from "./components";
import { builtInFields } from "./fields";
import { builtInPages } from "./pages";
import { builtInViews } from "./views";
import { builtInWidgets } from "./widgets";

/**
 * Core admin module - contains all built-in fields, views, and pages.
 *
 * Includes:
 * - Fields: text, email, password, textarea, number, checkbox, select, etc.
 * - Views: table (list), form (edit)
 * - Pages: login, forgot-password, reset-password, dashboard
 *
 * @example
 * ```ts
 * import { coreAdminModule } from "@questpie/admin/client";
 *
 * // Use directly to create collections
 * const barbers = coreAdminModule.collection("barbers")
 *   .fields(({ r }) => ({
 *     name: r.text({ label: "Name" }),
 *     email: r.email({ label: "Email" })
 *   }))
 *
 * // Or compose into your own builder
 * const builder = qa<AppCMS>().use(coreAdminModule);
 * ```
 */
export const coreAdminModule = AdminBuilder.empty()
  .fields(builtInFields)
  .components(builtInComponents)
  .views(builtInViews)
  .pages(builtInPages)
  .widgets(builtInWidgets);

/**
 * Type of core admin module state
 */
export type CoreAdminModule = typeof coreAdminModule;
