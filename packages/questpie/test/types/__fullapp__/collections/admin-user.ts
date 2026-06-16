/**
 * Full-app gate fixture — admin re-declaration of the starter `user` collection.
 *
 * Mirrors the REAL admin module's `collections/user.ts`:
 *   collection("user").merge(starterModule.collections.user).<more admin config>
 *
 * This is the exact same-key, cross-module-nesting re-declaration that detonated
 * the additive `ExtractModulePropArr` fold into `never` (the create() never/{} bug).
 * Pulling it through the fold here makes the package gate SEE the bug the module-only
 * gate was blind to — the override fold (`ExtractModulePropArrOverride`) is what
 * keeps `AppCollections["user"]` a real `Collection` instead of `never`.
 */
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import starterModule from "#questpie/server/modules/starter/.generated/module.js";

export const adminUser = collection("user")
	.merge(starterModule.collections.user)
	.options({ timestamps: true });

export default adminUser;
