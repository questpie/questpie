import { uniqueIndex } from "drizzle-orm/pg-core";
import { collection } from "questpie";

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
 * import { runtimeConfig } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * export default runtimeConfig({
 *   modules: [adminModule],
 *   // ...
 * });
 *
 * // Access preferences
 * const prefs = await app.api.collections.admin_preferences.findOne({
 *   where: { userId: currentUser.id, key: "viewState:posts" }
 * });
 * ```
 */
export const adminPreferencesCollection = collection("admin_preferences")
	.fields(({ f }) => ({
		// User who owns this preference
		userId: f.text(255).required().label("User ID"),

		// Preference key (e.g., "viewState:posts")
		key: f.text(255).required().label("Key"),

		// Preference value (JSON)
		value: f.json().required().label("Value"),
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
