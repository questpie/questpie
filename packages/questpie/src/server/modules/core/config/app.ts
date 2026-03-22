/**
 * Core module app config — contributes global hooks for:
 * 1. Realtime events (afterChange/afterDelete → append + post-commit broadcast)
 * 2. Search indexing (afterChange → scheduleIndex, afterDelete → remove)
 *
 * Uses bulk metadata (isBatch, count) from QUE-238 and
 * onAfterCommit from QUE-243 for post-commit side effects.
 *
 * Phase 2: Hooks coexist with direct CRUD integration calls.
 * Phase 3: Direct CRUD calls will be removed, these hooks become sole source.
 */

import type { GlobalCollectionHookContext } from "#questpie/server/config/global-hooks-types.js";

// ============================================================================
// Realtime helpers
// ============================================================================

function resolveRealtimeOperation(
	ctx: GlobalCollectionHookContext,
	hookType: "change" | "delete",
): "create" | "update" | "delete" | "bulk_update" | "bulk_delete" {
	if (hookType === "delete") {
		return ctx.isBatch ? "bulk_delete" : "delete";
	}
	if (ctx.operation === "create") return "create";
	return ctx.isBatch ? "bulk_update" : "update";
}

function resolveRealtimePayload(
	ctx: GlobalCollectionHookContext,
	hookType: "change" | "delete",
): Record<string, unknown> {
	if (ctx.isBatch) return { count: ctx.count ?? 0 };
	if (hookType === "delete") return {};
	return ctx.data as Record<string, unknown>;
}

// ============================================================================
// Hook definitions
// ============================================================================

/**
 * Realtime hook — appends changes to log + broadcasts after commit.
 */
const realtimeHook = {
	afterChange: async (ctx: GlobalCollectionHookContext) => {
		if (!ctx.realtime) return;

		const operation = resolveRealtimeOperation(ctx, "change");
		const payload = resolveRealtimePayload(ctx, "change");

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
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		if (!ctx.realtime) return;

		const operation = resolveRealtimeOperation(ctx, "delete");
		const payload = resolveRealtimePayload(ctx, "delete");

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
};

/**
 * Search indexing hook — schedules async index after change,
 * removes from index after delete. Uses per-app debounce
 * via SearchService.scheduleIndex() (QUE-244).
 */
const searchHook = {
	afterChange: async (ctx: GlobalCollectionHookContext) => {
		if (!ctx.search) return;
		const recordId = ctx.data?.id;
		if (!recordId) return;

		// Schedule debounced async indexing (fire-and-forget after commit)
		ctx.onAfterCommit(async () => {
			try {
				// Try per-instance debounced scheduling first
				const scheduled = ctx.search.scheduleIndex(
					ctx.collection,
					String(recordId),
				);
				if (!scheduled) {
					// No queue — index synchronously for current locale
					const title = ctx.data?._title || ctx.data?.id;
					await ctx.search.index({
						collection: ctx.collection,
						recordId: String(recordId),
						locale: ctx.locale ?? "en",
						title: String(title),
					});
				}
			} catch (err) {
				ctx.logger.error(
					`[Core] Search index failed for ${ctx.collection}:${recordId}:`,
					err,
				);
			}
		});
	},
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		if (!ctx.search) return;
		const recordId = ctx.data?.id;
		if (!recordId) return;

		ctx.onAfterCommit(async () => {
			try {
				await ctx.search.remove({
					collection: ctx.collection,
					recordId: String(recordId),
				});
			} catch (err) {
				ctx.logger.error(
					`[Core] Search remove failed for ${ctx.collection}:${recordId}:`,
					err,
				);
			}
		});
	},
};

// ============================================================================
// Export
// ============================================================================

export default {
	hooks: {
		collections: [realtimeHook, searchHook],
		globals: [],
	},
};
