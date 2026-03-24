/**
 * Core module app config — contributes global hooks for:
 * 1. Realtime events (afterChange/afterDelete → append + post-commit broadcast)
 * 2. Search indexing (afterChange → scheduleIndex, afterDelete → remove)
 * 3. Workflow scheduled transitions (beforeTransition → queue dispatch)
 *
 * Uses bulk metadata (isBatch, count) from QUE-238 and
 * onAfterCommit from QUE-243 for post-commit side effects.
 *
 * Phase 2: Hooks coexist with direct CRUD integration calls.
 * Phase 3: Direct CRUD calls will be removed, these hooks become sole source.
 */

import type {
	GlobalCollectionHookContext,
	GlobalCollectionTransitionHookContext,
} from "#questpie/server/config/global-hooks-types.js";
import {
	TransitionScheduledError,
	scheduleCollectionTransition,
} from "#questpie/server/modules/core/workflow/schedule-transition.js";

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

		// Defer both the log append and broadcast to after-commit.
		// Running appendChange inside the CRUD transaction can deadlock
		// on single-connection databases (PGlite) because the insert
		// waits for the outer transaction to release its lock.
		ctx.onAfterCommit(async () => {
			try {
				const change = await ctx.realtime.appendChange({
					resourceType: "collection",
					resource: ctx.collection,
					operation,
					recordId: ctx.isBatch ? null : ctx.data?.id ?? null,
					locale: ctx.locale ?? null,
					payload,
				});
				if (change) {
					await ctx.realtime.notify(change);
				}
			} catch {
				// Realtime log table may not exist yet
			}
		});
	},
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		if (!ctx.realtime) return;

		const operation = resolveRealtimeOperation(ctx, "delete");
		const payload = resolveRealtimePayload(ctx, "delete");

		ctx.onAfterCommit(async () => {
			try {
				const change = await ctx.realtime.appendChange({
					resourceType: "collection",
					resource: ctx.collection,
					operation,
					recordId: ctx.isBatch ? null : ctx.data?.id ?? null,
					locale: ctx.locale ?? null,
					payload,
				});
				if (change) {
					await ctx.realtime.notify(change);
				}
			} catch {
				// Realtime log table may not exist yet
			}
		});
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
// Workflow scheduled transition hook
// ============================================================================

/**
 * Scheduled transition hook — intercepts beforeTransition when
 * scheduledAt is a future date, dispatches to queue, and aborts
 * the immediate transition by throwing TransitionScheduledError.
 *
 * The CRUD generator catches TransitionScheduledError and returns
 * the existing record unchanged.
 */
const scheduledTransitionHook = {
	beforeTransition: async (ctx: GlobalCollectionTransitionHookContext) => {
		if (!ctx.scheduledAt) return;
		if (ctx.scheduledAt.getTime() <= Date.now()) return;

		await scheduleCollectionTransition(ctx.queue, {
			collection: ctx.collection,
			recordId: String(ctx.recordId),
			stage: ctx.toStage,
			scheduledAt: ctx.scheduledAt,
		});

		throw new TransitionScheduledError();
	},
};

// ============================================================================
// Export
// ============================================================================

export default {
	hooks: {
		collections: [realtimeHook, searchHook, scheduledTransitionHook],
		globals: [],
	},
};
