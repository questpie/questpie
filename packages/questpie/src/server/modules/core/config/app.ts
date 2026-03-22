/**
 * Core module app config — contributes global hooks for realtime events.
 *
 * These hooks generate realtime change events for all collection mutations.
 * They use the bulk metadata (isBatch, count) from QUE-238 and
 * onAfterCommit from QUE-243 for post-commit broadcast.
 *
 * Phase 2: Hook exists alongside direct CRUD calls (both emit events).
 * Phase 3: Direct CRUD calls will be removed, these hooks become sole source.
 */

import type { GlobalCollectionHookContext } from "#questpie/server/config/global-hooks-types.js";

/**
 * Build the realtime operation type from hook context.
 */
function resolveOperation(
	ctx: GlobalCollectionHookContext,
	hookType: "change" | "delete",
): "create" | "update" | "delete" | "bulk_update" | "bulk_delete" {
	if (hookType === "delete") {
		return ctx.isBatch ? "bulk_delete" : "delete";
	}
	if (ctx.operation === "create") return "create";
	return ctx.isBatch ? "bulk_update" : "update";
}

/**
 * Build the realtime payload from hook context.
 */
function resolvePayload(
	ctx: GlobalCollectionHookContext,
	hookType: "change" | "delete",
): Record<string, unknown> {
	if (ctx.isBatch) {
		return { count: ctx.count ?? 0 };
	}
	if (hookType === "delete") {
		return {};
	}
	// Single create/update — full record as payload
	return ctx.data as Record<string, unknown>;
}

export default {
	hooks: {
		collections: [
			{
				afterChange: async (ctx: GlobalCollectionHookContext) => {
					if (!ctx.realtime) return;

					const operation = resolveOperation(ctx, "change");
					const payload = resolvePayload(ctx, "change");

					// Append change to log inside transaction (durable)
					const change = await ctx.realtime.appendChange(
						{
							resourceType: "collection",
							resource: ctx.collection,
							operation,
							recordId: ctx.isBatch ? null : ctx.data?.id ?? null,
							locale: ctx.locale ?? null,
							payload,
						},
						{ db: ctx.db },
					);

					// Broadcast after transaction commits
					if (change) {
						ctx.onAfterCommit(async () => {
							await ctx.realtime.notify(change);
						});
					}
				},
				afterDelete: async (ctx: GlobalCollectionHookContext) => {
					if (!ctx.realtime) return;

					const operation = resolveOperation(ctx, "delete");
					const payload = resolvePayload(ctx, "delete");

					const change = await ctx.realtime.appendChange(
						{
							resourceType: "collection",
							resource: ctx.collection,
							operation,
							recordId: ctx.isBatch ? null : ctx.data?.id ?? null,
							locale: ctx.locale ?? null,
							payload,
						},
						{ db: ctx.db },
					);

					if (change) {
						ctx.onAfterCommit(async () => {
							await ctx.realtime.notify(change);
						});
					}
				},
			},
		],
		globals: [],
	},
};
