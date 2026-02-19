/**
 * QA Namespace
 *
 * Main entry point for admin builder API.
 */

import { AdminBuilder } from "./admin-builder";
import { field } from "./field/field";
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
 * import type { App } from "./server/app";
 * const admin = qa<App>().use(coreAdminModule);
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
});
