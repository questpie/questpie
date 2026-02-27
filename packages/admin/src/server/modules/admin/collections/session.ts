/**
 * Hidden session collection — internal auth collection, not shown in admin sidebar.
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 */
import { collection, starterModule } from "questpie";

export default collection("session")
	.merge(starterModule.collections.session)
	.set("admin", { hidden: true, audit: false });
