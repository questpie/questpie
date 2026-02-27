/**
 * Hidden API key collection — internal auth collection, not shown in admin sidebar.
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 */
import { collection, starterModule } from "questpie";

export default collection("apikey")
	.merge(starterModule.collections.apikey)
	.set("admin", { hidden: true, audit: false });
