import type {
	GlobalCollectionHookContext,
	GlobalCollectionHookEntry,
	GlobalCollectionTransitionHookContext,
	GlobalGlobalHookContext,
	GlobalGlobalHookEntry,
	GlobalGlobalTransitionHookContext,
} from "#questpie/server/config/global-hooks-types.js";

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
	if (entry.exclude && entry.exclude.includes(name)) {
		return false;
	}
	return true;
}

// ============================================================================
// Collection Global Hooks
// ============================================================================

/**
 * Execute global collection hooks (beforeChange, afterChange, beforeDelete, afterDelete).
 *
 * - `before*` hooks propagate errors (allow blocking operations).
 * - `after*` hooks swallow errors and log to console.
 */
export async function executeGlobalCollectionHooks(
	entries: GlobalCollectionHookEntry[] | undefined,
	hookName: "beforeChange" | "afterChange" | "beforeDelete" | "afterDelete",
	collectionName: string,
	ctx: GlobalCollectionHookContext,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName.startsWith("before");

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, collectionName)) continue;

		if (isBefore) {
			await hookFn(ctx);
		} else {
			try {
				await hookFn(ctx);
			} catch (err) {
				console.error(
					`[QuestPie] Global collection hook "${hookName}" error for "${collectionName}":`,
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
	ctx: GlobalCollectionTransitionHookContext,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeTransition";

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, collectionName)) continue;

		if (isBefore) {
			await hookFn(ctx);
		} else {
			try {
				await hookFn(ctx);
			} catch (err) {
				console.error(
					`[QuestPie] Global collection hook "${hookName}" error for "${collectionName}":`,
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
	ctx: GlobalGlobalHookContext,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeChange";

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, globalName)) continue;

		if (isBefore) {
			await hookFn(ctx);
		} else {
			try {
				await hookFn(ctx);
			} catch (err) {
				console.error(
					`[QuestPie] Global global hook "${hookName}" error for "${globalName}":`,
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
	ctx: GlobalGlobalTransitionHookContext,
): Promise<void> {
	if (!entries || entries.length === 0) return;

	const isBefore = hookName === "beforeTransition";

	for (const entry of entries) {
		const hookFn = entry[hookName];
		if (!hookFn || !matchesFilter(entry, globalName)) continue;

		if (isBefore) {
			await hookFn(ctx);
		} else {
			try {
				await hookFn(ctx);
			} catch (err) {
				console.error(
					`[QuestPie] Global global hook "${hookName}" error for "${globalName}":`,
					err,
				);
			}
		}
	}
}
