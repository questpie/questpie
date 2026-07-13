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
	GlobalGlobalHookContext,
} from "#questpie/server/config/global-hooks-types.js";
import type { Locale } from "#questpie/server/config/types.js";
import { buildIndexParams } from "#questpie/server/modules/core/integrated/search/index-params.js";
import type { SearchableConfig } from "#questpie/server/modules/core/integrated/search/types.js";
import {
	TransitionScheduledError,
	scheduleCollectionTransition,
} from "#questpie/server/modules/core/workflow/schedule-transition.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

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
		const realtime = ctx.realtime;
		if (!realtime) return;

		const operation = resolveRealtimeOperation(ctx, "change");
		const payload = resolveRealtimePayload(ctx, "change");

		try {
			const change = await realtime.appendChange(
				{
					resourceType: "collection",
					resource: ctx.collection,
					operation,
					recordId: ctx.isBatch ? null : (ctx.data?.id ?? null),
					locale: ctx.locale ?? null,
					payload,
				},
				{ db: ctx.db },
			);

			ctx.onAfterCommit(async () => {
				try {
					await realtime.notify(change);
				} catch {
					// Realtime adapter may be unavailable
				}
			});
		} catch {
			// Realtime log table may not exist yet
		}
	},
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		const realtime = ctx.realtime;
		if (!realtime) return;

		const operation = resolveRealtimeOperation(ctx, "delete");
		const payload = resolveRealtimePayload(ctx, "delete");

		try {
			const change = await realtime.appendChange(
				{
					resourceType: "collection",
					resource: ctx.collection,
					operation,
					recordId: ctx.isBatch ? null : (ctx.data?.id ?? null),
					locale: ctx.locale ?? null,
					payload,
				},
				{ db: ctx.db },
			);

			ctx.onAfterCommit(async () => {
				try {
					await realtime.notify(change);
				} catch {
					// Realtime adapter may be unavailable
				}
			});
		} catch {
			// Realtime log table may not exist yet
		}
	},
};

// ============================================================================
// Search helpers
// ============================================================================

/**
 * Minimal structural slice of the Questpie app instance the search hooks reach
 * for ({@link GlobalCollectionHookContext.app} is `unknown` pre-codegen). Lets
 * us resolve a collection's declarative `searchable` config + the configured
 * locales without an `as any` cast.
 */
interface AppSearchSurface {
	getCollectionConfig?: (
		name: string,
	) => { state?: { searchable?: SearchableConfig | false } } | undefined;
	getLocales?: () => Promise<Locale[]>;
	config?: { locale?: { defaultLocale?: string } };
}

/** Narrow the loosely-typed hook ctx app to the search slice we touch. */
function asSearchApp(app: unknown): AppSearchSurface {
	return (app ?? {}) as AppSearchSurface;
}

/**
 * Resolve a collection's `.searchable(...)` config from the app instance.
 * Returns `undefined` when the collection (or accessor) is unavailable, which
 * {@link buildIndexParams} treats as the default auto-index config.
 */
function resolveSearchableConfig(
	app: AppSearchSurface,
	collection: string,
): SearchableConfig | false | undefined {
	try {
		return app.getCollectionConfig?.(collection)?.state?.searchable;
	} catch {
		return undefined;
	}
}

/** Resolve the configured default locale (mirrors Questpie.createRequestContext). */
function resolveDefaultLocale(app: AppSearchSurface): string {
	return app.config?.locale?.defaultLocale ?? DEFAULT_LOCALE;
}

/**
 * Search indexing hook — schedules async index after change,
 * removes from index after delete. Uses per-app debounce
 * via SearchService.scheduleIndex() (QUE-244).
 */
const searchHook = {
	afterChange: async (ctx: GlobalCollectionHookContext) => {
		const search = ctx.search;
		const logger = ctx.logger;
		if (!search) return;
		const recordId = ctx.data?.id;
		if (!recordId) return;

		// Schedule debounced async indexing (fire-and-forget after commit)
		ctx.onAfterCommit(async () => {
			try {
				// Try per-instance debounced scheduling first
				const scheduled = search.scheduleIndex(ctx.collection, String(recordId));
				if (!scheduled) {
					// No queue — index synchronously for current locale.
					// Resolve the collection's declarative `searchable` config so
					// content/metadata/facets/embedding are populated (not title-only).
					const app = asSearchApp(ctx.app);
					const params = await buildIndexParams(
						ctx.data as Record<string, any>,
						{
							collection: ctx.collection,
							locale: ctx.locale ?? DEFAULT_LOCALE,
							searchable: resolveSearchableConfig(app, ctx.collection),
							app: ctx.app,
							defaultLocale: resolveDefaultLocale(app),
						},
					);
					if (params) {
						await search.index(params);
					}
				}
			} catch (err) {
				logger?.error(
					`[Core] Search index failed for ${ctx.collection}:${recordId}:`,
					err,
				);
			}
		});
	},
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		const search = ctx.search;
		const logger = ctx.logger;
		if (!search) return;
		const recordId = ctx.data?.id;
		if (!recordId) return;

		ctx.onAfterCommit(async () => {
			try {
				await search.remove({
					collection: ctx.collection,
					recordId: String(recordId),
				});
			} catch (err) {
				logger?.error(
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
// Global (globals) hooks
// ============================================================================

/**
 * Realtime hook for globals — appends changes to log + broadcasts after commit.
 * Globals only have afterChange (no delete operation).
 */
const globalRealtimeHook = {
	afterChange: async (ctx: GlobalGlobalHookContext) => {
		const realtime = ctx.realtime;
		if (!realtime) return;

		try {
			const change = await realtime.appendChange(
				{
					resourceType: "global",
					resource: ctx.global,
					operation: "update",
					recordId: ctx.data?.id ?? null,
					locale: ctx.locale ?? null,
					payload: ctx.data as Record<string, unknown>,
				},
				{ db: ctx.db },
			);

			ctx.onAfterCommit(async () => {
				try {
					await realtime.notify(change);
				} catch {
					// Realtime adapter may be unavailable
				}
			});
		} catch {
			// Realtime log table may not exist yet
		}
	},
};

/**
 * Search indexing hook for globals — schedules async index after change.
 */
const globalSearchHook = {
	afterChange: async (ctx: GlobalGlobalHookContext) => {
		const search = ctx.search;
		const logger = ctx.logger;
		if (!search) return;
		const recordId = ctx.data?.id;
		if (!recordId) return;

		ctx.onAfterCommit(async () => {
			try {
				const scheduled = search.scheduleIndex(ctx.global, String(recordId));
				if (!scheduled) {
					const title = ctx.data?._title || ctx.data?.id;
					await search.index({
						collection: ctx.global,
						recordId: String(recordId),
						locale: ctx.locale ?? "en",
						title: String(title),
					});
				}
			} catch (err) {
				logger?.error(
					`[Core] Search index failed for global ${ctx.global}:${recordId}:`,
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
		collections: [realtimeHook, searchHook, scheduledTransitionHook],
		globals: [globalRealtimeHook, globalSearchHook],
	},
};
