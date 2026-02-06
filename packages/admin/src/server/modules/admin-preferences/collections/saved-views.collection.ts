import { q } from "questpie";

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
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(starterModule)
 *   .use(adminModule)
 *   .collections({ ... })
 *   .build({ ... });
 *
 * // Access saved views
 * const views = await cms.api.collections.adminSavedViews.find({
 *   where: { collectionName: "posts", userId: currentUser.id }
 * });
 * ```
 */
export const savedViewsCollection = q
  .collection("admin_saved_views")
  .fields((f) => ({
    // User who owns this saved view
    userId: f.text({ required: true, maxLength: 255, label: "User ID" }),

    // Target collection for this view
    collectionName: f.text({
      required: true,
      maxLength: 255,
      label: "Collection Name",
    }),

    // Display name for the view
    name: f.text({ required: true, maxLength: 255, label: "Name" }),

    // View configuration (filters, sort, columns)
    configuration: f.json({
      required: true,
      label: "Configuration",
    }),

    // Whether this is the default view for the user/collection
    isDefault: f.boolean({ default: false, label: "Is Default" }),
  }))
  .options({
    timestamps: true,
  });
