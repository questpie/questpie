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

import { FatalGlobalHookError } from "#questpie/server/collection/crud/shared/global-hooks.js";
import { recordTransactionTxid } from "#questpie/server/collection/crud/shared/transaction.js";
import type {
	GlobalCollectionHookContext,
	GlobalCollectionTransitionHookContext,
	GlobalGlobalHookContext,
} from "#questpie/server/config/global-hooks-types.js";
import type { Locale } from "#questpie/server/config/types.js";
import type {
	RealtimeChangeEvent,
	RealtimeChangePayload,
	RealtimeEqualityProjection,
} from "#questpie/server/modules/core/integrated/realtime/types.js";
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
): RealtimeChangePayload {
	if (ctx.isBatch) {
		return {
			count: ctx.count ?? 0,
			recordIds: ctx.recordIds ? [...ctx.recordIds] : [],
		};
	}

	const before = hookType === "delete" ? ctx.data : ctx.original;
	const after = hookType === "delete" ? undefined : ctx.data;
	return {
		before: before ? projectRealtimeEqualityFields(before) : null,
		after: after ? projectRealtimeEqualityFields(after) : null,
	};
}

function projectRealtimeEqualityFields(
	data: unknown,
): RealtimeEqualityProjection {
	if (!data || typeof data !== "object" || Array.isArray(data)) return {};

	const projection: RealtimeEqualityProjection = {};
	for (const [key, value] of Object.entries(data)) {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			projection[key] = value;
		}
	}
	return projection;
}

const capturedRealtimeBatches = new WeakSet<object>();
const realtimeCaptureWarningAt = new WeakMap<object, number>();
const REALTIME_CAPTURE_WARNING_INTERVAL_MS = 60_000;

function hasPostgresErrorCode(error: unknown, code: string): boolean {
	let current = error;
	const seen = new Set<object>();
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ((current as { code?: unknown }).code === code) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

function handleRealtimeCaptureError(
	logger: GlobalCollectionHookContext["logger"],
	error: unknown,
): void {
	if (hasPostgresErrorCode(error, "42P01") || !logger) return;

	const now = Date.now();
	const lastWarningAt = realtimeCaptureWarningAt.get(logger) ?? 0;
	if (now - lastWarningAt < REALTIME_CAPTURE_WARNING_INTERVAL_MS) return;

	realtimeCaptureWarningAt.set(logger, now);
	logger.warn("[Core] Realtime change capture failed:", error);
}

function shouldCaptureRealtimeChange(
	ctx: GlobalCollectionHookContext,
): boolean {
	if (!ctx.isBatch) return true;
	const batchMarker = ctx.records ?? ctx.recordIds;
	if (!batchMarker) return true;
	if (capturedRealtimeBatches.has(batchMarker)) return false;
	capturedRealtimeBatches.add(batchMarker);
	return true;
}

function publishRealtimeAfterCommit(
	ctx: Pick<GlobalCollectionHookContext, "logger" | "onAfterCommit">,
	realtime: NonNullable<GlobalCollectionHookContext["realtime"]>,
	change: RealtimeChangeEvent,
): void {
	ctx.onAfterCommit(async () => {
		void realtime.notify(change).catch((error) => {
			ctx.logger?.error("[Core] Realtime publish failed:", error);
		});
	});
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
		if (!shouldCaptureRealtimeChange(ctx)) return;

		const operation = resolveRealtimeOperation(ctx, "change");
		const payload = resolveRealtimePayload(ctx, "change");

		try {
			const change = await realtime.appendChange({
				resourceType: "collection",
				resource: ctx.collection,
				operation,
				recordId: ctx.isBatch ? null : (ctx.data?.id ?? null),
				locale: ctx.locale ?? null,
				payload,
			});
			recordTransactionTxid(change.txid);

			publishRealtimeAfterCommit(ctx, realtime, change);
		} catch (error) {
			handleRealtimeCaptureError(ctx.logger, error);
			if (realtime.nativeDeltasEnabled) {
				throw new FatalGlobalHookError(error);
			}
		}
	},
	afterDelete: async (ctx: GlobalCollectionHookContext) => {
		const realtime = ctx.realtime;
		if (!realtime) return;
		if (!shouldCaptureRealtimeChange(ctx)) return;

		const operation = resolveRealtimeOperation(ctx, "delete");
		const payload = resolveRealtimePayload(ctx, "delete");

		try {
			const change = await realtime.appendChange({
				resourceType: "collection",
				resource: ctx.collection,
				operation,
				recordId: ctx.isBatch ? null : (ctx.data?.id ?? null),
				locale: ctx.locale ?? null,
				payload,
			});
			recordTransactionTxid(change.txid);

			publishRealtimeAfterCommit(ctx, realtime, change);
		} catch (error) {
			handleRealtimeCaptureError(ctx.logger, error);
			if (realtime.nativeDeltasEnabled) {
				throw new FatalGlobalHookError(error);
			}
		}
	},
	afterPurge: async (ctx: GlobalCollectionHookContext) => {
		const realtime = ctx.realtime;
		if (!realtime) return;

		try {
			const change = await realtime.appendChange({
				resourceType: "collection",
				resource: ctx.collection,
				operation: "delete",
				recordId: ctx.data?.id ?? null,
				locale: ctx.locale ?? null,
				// Soft delete already emitted the equality projection needed to
				// evict the live row. Purge is a second idempotent invalidation
				// and must not retain another copy of the removed preimage.
				payload: { before: null, after: null },
			});
			recordTransactionTxid(change.txid);
			publishRealtimeAfterCommit(ctx, realtime, change);
		} catch (error) {
			handleRealtimeCaptureError(ctx.logger, error);
			if (realtime.nativeDeltasEnabled) {
				throw new FatalGlobalHookError(error);
			}
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
				const scheduled = search.scheduleIndex(
					ctx.collection,
					String(recordId),
				);
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
	afterPurge: async (ctx: GlobalCollectionHookContext) => {
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
			const change = await realtime.appendChange({
				resourceType: "global",
				resource: ctx.global,
				operation: "update",
				recordId: ctx.data?.id ?? null,
				locale: ctx.locale ?? null,
				payload: {
					before: null,
					after: projectRealtimeEqualityFields(ctx.data),
				},
			});
			recordTransactionTxid(change.txid);

			publishRealtimeAfterCommit(ctx, realtime, change);
		} catch (error) {
			handleRealtimeCaptureError(ctx.logger, error);
			if (realtime.nativeDeltasEnabled) {
				throw new FatalGlobalHookError(error);
			}
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
