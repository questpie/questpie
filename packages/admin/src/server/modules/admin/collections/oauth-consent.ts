/**
 * Hidden OAuth consent collection — framework-internal auth table, never edited
 * from the admin, so it must not appear in the sidebar or global search.
 *
 * `oauthModule` is always present wherever the admin runs
 * (adminModule → starterModule → oauthModule), so this merge is safe.
 *
 * @see account.ts for the collection().merge().set() pattern rationale.
 */
import { collection, oauthModule } from "questpie";

export default collection("oauthConsent")
	.merge(oauthModule.collections.oauthConsent)
	.set("admin", { hidden: true, audit: false });
