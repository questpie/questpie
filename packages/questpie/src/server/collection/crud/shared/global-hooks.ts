import type {
	GlobalCollectionHookContext,
	GlobalCollectionHookContextInput,
	GlobalCollectionHookEntry,
	GlobalCollectionTransitionHookContext,
	GlobalCollectionTransitionHookContextInput,
	GlobalGlobalHookContext,
	GlobalGlobalHookContextInput,
	GlobalGlobalHookEntry,
	GlobalGlobalTransitionHookContext,
	GlobalGlobalTransitionHookContextInput,
} from "#questpie/server/config/global-hooks-types.js";

type ContextLogger = {
	error: (message: string, ...args: unknown[]) => void;
};

/** Marks an after-hook failure that must abort its surrounding transaction. */
export class FatalGlobalHookError extends Error {
	constructor(readonly original: unknown) {
		super(
			original instanceof Error
				? original.message
				: "Fatal global hook failure",
			{ cause: original },
		);
		this.name = "FatalGlobalHookError";
	}
}

export function rethrowFatalGlobalHookError(error: unknown): void {
	if (error instanceof FatalGlobalHookError) throw error;
}

function getContextLogger(ctx: object): ContextLogger | undefined {
	if (
		"logger" in ctx &&
		ctx.logger &&
		typeof ctx.logger === "object" &&
		"error" in ctx.logger &&
		typeof ctx.logger.error === "function"
	) {
		return ctx.logger as ContextLogger;
	}

	return undefined;
}

/**
 * Check if a global hook entry matches a given entity name
 * based on its include/exclude configuration.
 */
function matchesFilter(
	entry: { include?: string[]; exclude?: string[] },
	name: string,
): boolean {
	if (entry.include && !entry.include.includes(name)) {
		return false;
	}
	if (entry.exclude?.includes(name)) {
		return false;
	}
	return true;
}

// ============================================================================
// Collection Global Hooks
// ============================================================================

/**
 * Execute global collection hooks.
 *
 * - `before*` hooks propagate errors (allow blocking operations).
 * - Ordinary `after*` hooks swallow errors and log.
 * - `afterPurge` is fatal because it is part of the irreversible purge
 *   transaction; external work belongs in `onAfterCommit`.
 */
export async function executeGlobalCollectionHooks(
	entries: GlobalCollectionHookEntry[] | undefined,
	hookName:
		| "beforeChange"
		| "afterChange"
		| "beforeDelete"
		| "afterDelete"
		| "beforePurge"
		| "afterPurge",
	collectionName: string,
	ctx: GlobalCollectionHookContextInput,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isFatal = hookName.startsWith("before") || hookName === "afterPurge";

	// Enrich context with collection name for global hooks
	const enrichedCtx: GlobalCollectionHookContext = {
		...ctx,
		collection: collectionName,
	};

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, collectionName)) continue;

		if (isFatal) {
			await hookFn(enrichedCtx);
		} else {
			try {
				await hookFn(enrichedCtx);
			} catch (err) {
				rethrowFatalGlobalHookError(err);
				getContextLogger(enrichedCtx)?.error(
					`[QUESTPIE] Global collection hook "${hookName}" error for "${collectionName}":`,
					err,
				);
			}
		}
	}
}

/**
 * Execute global collection transition hooks (beforeTransition, afterTransition).
 *
 * - `beforeTransition` propagates errors (allow blocking).
 * - `afterTransition` swallows errors and logs.
 */
export async function executeGlobalCollectionTransitionHooks(
	entries: GlobalCollectionHookEntry[] | undefined,
	hookName: "beforeTransition" | "afterTransition",
	collectionName: string,
	ctx: GlobalCollectionTransitionHookContextInput,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeTransition";

	// Enrich context with collection name for global hooks
	const enrichedCtx: GlobalCollectionTransitionHookContext = {
		...ctx,
		collection: collectionName,
	};

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, collectionName)) continue;

		if (isBefore) {
			await hookFn(enrichedCtx);
		} else {
			try {
				await hookFn(enrichedCtx);
			} catch (err) {
				rethrowFatalGlobalHookError(err);
				getContextLogger(enrichedCtx)?.error(
					`[QUESTPIE] Global collection hook "${hookName}" error for "${collectionName}":`,
					err,
				);
			}
		}
	}
}

// ============================================================================
// Global Global Hooks
// ============================================================================

/**
 * Execute global global hooks (beforeChange, afterChange).
 *
 * - `beforeChange` propagates errors (allow blocking).
 * - `afterChange` swallows errors and logs.
 */
export async function executeGlobalGlobalHooks(
	entries: GlobalGlobalHookEntry[] | undefined,
	hookName: "beforeChange" | "afterChange",
	globalName: string,
	ctx: GlobalGlobalHookContextInput,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeChange";

	// Enrich context with global name for global hooks
	const enrichedCtx: GlobalGlobalHookContext = { ...ctx, global: globalName };

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, globalName)) continue;

		if (isBefore) {
			await hookFn(enrichedCtx);
		} else {
			try {
				await hookFn(enrichedCtx);
			} catch (err) {
				rethrowFatalGlobalHookError(err);
				getContextLogger(enrichedCtx)?.error(
					`[QUESTPIE] Global global hook "${hookName}" error for "${globalName}":`,
					err,
				);
			}
		}
	}
}

/**
 * Execute global global transition hooks (beforeTransition, afterTransition).
 *
 * - `beforeTransition` propagates errors.
 * - `afterTransition` swallows errors and logs.
 */
export async function executeGlobalGlobalTransitionHooks(
	entries: GlobalGlobalHookEntry[] | undefined,
	hookName: "beforeTransition" | "afterTransition",
	globalName: string,
	ctx: GlobalGlobalTransitionHookContextInput,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeTransition";

	// Enrich context with global name for global hooks
	const enrichedCtx: GlobalGlobalTransitionHookContext = {
		...ctx,
		global: globalName,
	};

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, globalName)) continue;

		if (isBefore) {
			await hookFn(enrichedCtx);
		} else {
			try {
				await hookFn(enrichedCtx);
			} catch (err) {
				rethrowFatalGlobalHookError(err);
				getContextLogger(enrichedCtx)?.error(
					`[QUESTPIE] Global global hook "${hookName}" error for "${globalName}":`,
					err,
				);
			}
		}
	}
}
