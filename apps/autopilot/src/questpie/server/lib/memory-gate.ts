/**
 * Memory write gate — resolves the per-scope "agent may write memory" toggle (§9.7).
 *
 * The reflection write step (`workflows`) calls {@link agentMayWriteMemory} BEFORE
 * persisting candidates. It reads `memory_settings` rows most-specific-first
 * (task → project → company): the first row that EXISTS for the active scope decides;
 * if NO row exists for any tier, the default is ALLOWED (the loop works out of the
 * box — see `collections/memory-settings.ts`).
 *
 * Pure-ish: the collection `find` is injected, so the resolution order is unit-tested
 * with a double.
 */

/** The `memory_settings` surface the gate reads. */
export interface MemorySettingsCollections {
	memory_settings: {
		findOne(args: {
			where: Record<string, unknown>;
		}): Promise<{ agentMayWrite?: boolean | null } | null>;
	};
}

/** The active scope to resolve the toggle for. */
export interface GateScope {
	projectId?: string | null;
	taskId?: string | null;
}

/**
 * Resolve whether agent-authored memory writes are permitted for this scope.
 *
 * Checks, in order, the MOST SPECIFIC scope first:
 *   1. task   (if `taskId`)    — `{ scopeType:"task", scopeRef:taskId }`
 *   2. project (if `projectId`) — `{ scopeType:"project", scopeRef:projectId }`
 *   3. company                  — `{ scopeType:"company" }`
 * The first row that EXISTS wins (its `agentMayWrite`, defaulting true if the column
 * is null). If none exist, returns `true` (default-allowed).
 */
export async function agentMayWriteMemory(
	collections: MemorySettingsCollections,
	scope: GateScope,
): Promise<boolean> {
	const lookups: Array<Record<string, unknown>> = [];
	if (scope.taskId) {
		lookups.push({ scopeType: "task", scopeRef: scope.taskId });
	}
	if (scope.projectId) {
		lookups.push({ scopeType: "project", scopeRef: scope.projectId });
	}
	lookups.push({ scopeType: "company" });

	for (const where of lookups) {
		const row = await collections.memory_settings.findOne({ where });
		if (row) {
			// A row exists for this tier → it decides (null column ⇒ default allow).
			return row.agentMayWrite !== false;
		}
	}

	// No setting anywhere → default-allowed.
	return true;
}
