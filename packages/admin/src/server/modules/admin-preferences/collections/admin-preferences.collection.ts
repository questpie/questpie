import { uniqueIndex } from "drizzle-orm/pg-core";
import { q } from "questpie";

/**
 * Admin Preferences Collection
 *
 * Stores user-specific preferences for admin UI state.
 * This includes view configurations (columns, filters, sort)
 * that persist across devices and sessions.
 *
 * Key format: "viewState:{collectionName}" for view state preferences
 *
 * @example
 * ```ts
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .collections({ ... })
 *   .build({ ... });
 *
 * // Access preferences
 * const prefs = await cms.api.collections.adminPreferences.findOne({
 *   where: { userId: currentUser.id, key: "viewState:posts" }
 * });
 * ```
 */
export const adminPreferencesCollection = q
  .collection("admin_preferences")
  .fields((f) => ({
    // User who owns this preference
    userId: f.text({ required: true, maxLength: 255, label: "User ID" }),

    // Preference key (e.g., "viewState:posts")
    key: f.text({ required: true, maxLength: 255, label: "Key" }),

    // Preference value (JSON)
    value: f.json({ required: true, label: "Value" }),
  }))
  .options({
    timestamps: true,
  })
  .indexes(({ table }) => [
    // Unique constraint on userId + key
    // Type assertion needed due to Drizzle ORM duplicate dependency resolution
    uniqueIndex("admin_preferences_user_key_idx").on(
      table.userId as any,
      table.key as any,
    ),
  ]);
