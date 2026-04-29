import { collection } from "questpie";

// Re-export types from shared
export type {
	FilterOperator,
	FilterRule,
	SortConfig,
	ViewConfiguration,
} from "../../../../shared/types/saved-views.types.js";

/**
 * Admin Saved Views Collection
 *
 * Stores user-specific view configurations for collection lists.
 * Each view can contain:
 * - Filter rules (field/operator/value combinations)
 * - Sort configuration (field/direction)
 * - Visible columns selection
 *
 * @example
 * ```ts
 * import { runtimeConfig } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * export default runtimeConfig({
 *   modules: [adminModule],
 *   // ...
 * });
 *
 * // Access saved views
 * const views = await app.collections.admin_saved_views.find({
 *   where: { collectionName: "posts", userId: currentUser.id }
 * });
 * ```
 */
export const savedViewsCollection = collection("admin_saved_views")
	.fields(({ f }) => ({
		// User who owns this saved view
		userId: f.text(255).required().label("User ID"),

		// Target collection for this view
		collectionName: f.text(255).required().label("Collection Name"),

		// Display name for the view
		name: f.text(255).required().label("Name"),

		// View configuration (filters, sort, columns)
		configuration: f.json().required().label("Configuration"),

		// Whether this is the default view for the user/collection
		isDefault: f.boolean().default(false).label("Is Default"),
	}))
	.options({
		timestamps: true,
	});
