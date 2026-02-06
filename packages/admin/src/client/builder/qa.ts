/**
 * QA Namespace
 *
 * Main entry point for admin builder API.
 */

import { AdminBuilder } from "./admin-builder";
import { block } from "./block/block-builder";
import { collection } from "./collection/collection";
import { field } from "./field/field";
import { global } from "./global/global";
import { page } from "./page/page";
import { editView, listView } from "./view/view";
import { widget } from "./widget/widget";

/**
 * Create admin builder (starts empty)
 *
 * @example
 * ```ts
 * // Without backend types
 * const admin = qa().use(coreAdminModule);
 *
 * // With backend types for autocomplete
 * import type { AppCMS } from './server/cms';
 * const admin = qa<AppCMS>().use(coreAdminModule);
 * ```
 */
function qaFactory<TApp = any>() {
  return AdminBuilder.empty<TApp>();
}

/**
 * QA namespace with helpers
 */
export const qa = Object.assign(qaFactory, {
  // Primitive definition helpers (for advanced use)
  field,
  listView,
  editView,
  widget,
  page,

  // Standalone factories (for use outside builder context)
  collection,
  global,
  block,
});
