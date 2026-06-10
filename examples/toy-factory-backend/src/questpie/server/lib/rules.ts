/**
 * Generated-alias usage fixture — the OTHER half of the cycle rules.
 *
 * This file is NOT imported by any collection, so it may freely use the
 * generated aliases (`AccessRuleContext<K>`, `GlobalDoc`, `AppSession*`).
 * Compare with ./access.ts (collection-imported → package-level
 * `AccessContext` + explicit return annotations).
 */

import type {
	AccessRuleContext,
	AppSession,
	AppSessionUser,
	GlobalDoc,
} from "#questpie";

/** `ctx.data` is typed as the toys row via the K parameter. */
export function isToyNamed(ctx: AccessRuleContext<"toys">): boolean {
	const name: string | undefined = ctx.data?.name;
	const user: AppSessionUser | undefined = ctx.session?.user ?? undefined;
	return Boolean(name && user);
}

export type SiteSettingsDoc = GlobalDoc<"siteSettings">;

export function sessionLabel(session: AppSession): string {
	return session ? session.user.email : "anonymous";
}
