/**
 * Hidden saved views collection — admin-internal, not shown in admin sidebar.
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 */
import { collection } from "questpie";

import { savedViewsCollection } from "../../admin-preferences/collections/saved-views.js";

export default collection("admin_saved_views")
	.merge(savedViewsCollection)
	.set("admin", { hidden: true, audit: false });
