/**
 * Hidden account collection — internal auth collection, not shown in admin sidebar.
 *
 * Pattern: collection("name").merge(existingModule).set("admin", config)
 *
 * We use `.merge()` instead of chaining directly on the starter collection because:
 * 1. The extension methods (.admin, .list, .form) are generated per-user-app via factories.ts
 *    and are NOT available on the bare CollectionBuilder in library code.
 * 2. `.set("stateKey", value)` is the low-level API on CollectionBuilder that libraries use
 *    to attach admin config without depending on the generated extension methods.
 * 3. Starting with `collection("name").merge(existing)` makes the intent explicit:
 *    "create a new collection that extends this existing one".
 */
import { collection, starterModule } from "questpie";

export default collection("account")
	.merge(starterModule.collections.account)
	.set("admin", { hidden: true, audit: false });
