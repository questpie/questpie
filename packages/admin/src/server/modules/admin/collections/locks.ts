/**
 * Hidden locks collection — admin-internal, not shown in admin sidebar.
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 */
import { collection } from "questpie";

import { locksCollection } from "../../admin-preferences/collections/locks.collection.js";

export default collection("admin_locks")
	.merge(locksCollection)
	.set("admin", { hidden: true, audit: false });
