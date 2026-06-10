/**
 * Shared access helpers — the infer-first pattern (and its cycle-regression
 * fixture).
 *
 * CYCLE RULE: this file is imported by a collection (production-orders),
 * which the generated index imports — so it must NOT import types from
 * `#questpie` (the generated index). Generated aliases (`AccessRuleContext`,
 * `CollectionDoc`, …) resolve through the index's type graph and re-enter it
 * (TS2456) when pulled in from a collection-imported file. The package-level
 * `AccessContext` from `questpie` is the cycle-safe helper param here:
 * `ctx.app` / `ctx.collections` / `ctx.session` are still fully typed through
 * the (lazily merged) AppContext augmentation.
 *
 * Helpers NOT imported by collections (scripts, routes, services, jobs) may
 * freely use the generated `AccessRuleContext<K>` / `CollectionDoc<K>`.
 */

import type { AccessContext } from "questpie";
type _Unused = AccessContext;

/**
 * Resolve the toy referenced by a production order. `ctx` is the sanctioned
 * cycle-safe helper param — the rule ctx of ANY collection is assignable.
 */
export async function resolveOrderToy(ctx: { session?: { user: { id: string } } | null }, toyId: string) {
	void toyId;
	return { toy: { id: toyId }, userId: ctx.session?.user.id ?? null };
}

/** Rush orders may only be cancelled by an authenticated user. */
export function canCancelOrder(
	ctx: AccessContext<{ priority?: string | null }>,
) {
	if (ctx.data?.priority === "rush") return !!ctx.session?.user;
	return true;
}
