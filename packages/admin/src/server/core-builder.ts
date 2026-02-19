/**
 * Internal admin core builder for standalone admin collections.
 *
 * Similar to questpie's coreBuilder (which provides default fields),
 * this builder additionally registers admin component and view registries
 * so that standalone collections (like audit-log) can use `.admin()`,
 * `.list()`, and `.form()` without crashing.
 */

import { q } from "questpie";
// Side-effect imports: apply runtime patches and type augmentation
import "../augmentation.js";
import "./patch.js";

/**
 * Pre-configured builder with admin defaults for admin-internal standalone collections.
 * Provides component registry (icon, badge) and view registries (table, form).
 */
export const adminCoreBuilder = q({ name: "questpie-admin-core" })
	.listViews({
		table: q.listView("table"),
	})
	.editViews({
		form: q.editView("form"),
	})
	.components({
		icon: q.component("icon"),
		badge: q.component("badge"),
	});
