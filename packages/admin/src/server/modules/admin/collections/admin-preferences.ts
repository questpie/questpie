/**
 * Hidden preferences collection — admin-internal, not shown in admin sidebar.
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 */
import { collection } from "questpie";

import { adminPreferencesCollection } from "../../admin-preferences/collections/admin-preferences.js";

export default collection("admin_preferences")
	.merge(adminPreferencesCollection)
	.set("admin", { hidden: true, audit: false });
