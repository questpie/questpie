/**
 * Shared access helpers — the infer-first pattern (and its cycle-regression
 * fixture).
 *
 * CYCLE RULE: this file is imported by a collection (production-orders),
 * which the generated index imports — so its PARAMETER types must be the
 * package-level `AccessContext` (not the generated `AccessRuleContext<K>`,
 * whose contextual resolution re-enters the index graph from here), and the
 * RETURN type must be annotated explicitly (cross-collection type-only
 * `CollectionDoc<K>` is fine in that declaration position) to cut the
 * inference loop (TS7022/TS2502 without it). The package-level
 * `AccessContext` from `questpie` is the cycle-safe helper param here:
 * `ctx.app` / `ctx.collections` / `ctx.session` are still fully typed through
 * the (lazily merged) AppContext augmentation.
 *
 * Helpers NOT imported by collections (scripts, routes, services, jobs) may
 * freely use the generated `CollectionDoc<K>` and friends.
 */

import type { AccessContext } from "questpie";

import type { CollectionDoc } from "#questpie";

/**
 * Resolve the toy referenced by a production order. `ctx` is the sanctioned
 * cycle-safe helper param — the rule ctx of ANY collection is assignable.
 *
 * CYCLE CUT: the explicit return annotation (cross-collection
 * `CollectionDoc<"toys">`, type-only) breaks the inference loop that
 * otherwise forms when a collection-imported helper dereferences
 * `ctx.collections` back into the module graph (TS7022/TS2502).
 */
export async function resolveOrderToy(
	ctx: AccessContext,
	toyId: string,
): Promise<{ toy: CollectionDoc<"toys"> | null; userId: string | null }> {
	const toy = await ctx.app.collections.toys.findOne(
		{ where: { id: toyId } },
		{ accessMode: "system" },
	);
	return { toy, userId: ctx.session?.user.id ?? null };
}

/** Rush orders may only be cancelled by an authenticated user. */
export function canCancelOrder(
	ctx: AccessContext<{ priority?: string | null }>,
) {
	if (ctx.data?.priority === "rush") return !!ctx.session?.user;
	return true;
}
