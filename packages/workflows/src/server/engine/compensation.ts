/**
 * Compensation Engine
 *
 * Implements the saga pattern — when a workflow fails, compensating
 * actions run in reverse order (LIFO) to undo completed steps.
 *
 * Key behaviors:
 * - Compensations run in REVERSE order of step execution
 * - Each compensation is isolated — one failing doesn't stop the rest
 * - All compensation errors are collected and attached to the instance
 * - The logger records all compensation activity
 */

import type { WorkflowLogger } from "../workflow/types.js";

// ============================================================================
// Types
// ============================================================================

/** A registered compensation callback with its step result. */
export interface CompensationEntry {
	/** Step name that registered this compensation. */
	name: string;
	/** The compensation callback. */
	fn: (result: unknown) => Promise<void>;
	/** The result of the original step (passed to the compensation fn). */
	result: unknown;
}

/** Result of running compensations. */
export interface CompensationResult {
	/** Number of compensations that ran successfully. */
	succeeded: number;
	/** Number of compensations that failed. */
	failed: number;
	/** Errors from failed compensations. */
	errors: Array<{ stepName: string; error: string }>;
}

// ============================================================================
// CompletedStepsMap
// ============================================================================

/**
 * Creates a CompletedStepsMap from step entries.
 * Used in the onFailure handler to inspect what was done.
 */
export function createCompletedStepsMap(
	entries: Array<{ name: string; result: unknown }>,
): {
	has(name: string): boolean;
	get<T = unknown>(name: string): T | undefined;
	entries(): IterableIterator<[string, unknown]>;
} {
	const map = new Map<string, unknown>();
	for (const entry of entries) {
		map.set(entry.name, entry.result);
	}

	return {
		has: (name: string) => map.has(name),
		get: <T = unknown>(name: string) => map.get(name) as T | undefined,
		entries: () => map.entries(),
	};
}

// ============================================================================
// Compensation runner
// ============================================================================

/**
 * Run compensation callbacks in reverse order (LIFO).
 *
 * Each compensation is executed in isolation — if one fails, the error
 * is captured and the rest still run. This ensures maximum rollback
 * coverage even when individual compensations are flaky.
 *
 * @param compensations - Registered compensation entries (in execution order)
 * @param log - Workflow logger for recording activity
 * @returns Compensation result with success/failure counts and errors
 */
export async function runCompensations(
	compensations: ReadonlyArray<CompensationEntry>,
	log: WorkflowLogger,
): Promise<CompensationResult> {
	if (compensations.length === 0) {
		return { succeeded: 0, failed: 0, errors: [] };
	}

	log.info(`Running ${compensations.length} compensation(s) in reverse order`);

	const result: CompensationResult = {
		succeeded: 0,
		failed: 0,
		errors: [],
	};

	// Run in reverse order (LIFO — last completed step compensates first)
	const reversed = [...compensations].reverse();

	for (const entry of reversed) {
		try {
			log.info(`Compensating step "${entry.name}"`);
			await entry.fn(entry.result);
			result.succeeded++;
			log.info(`Compensation for "${entry.name}" succeeded`);
		} catch (error) {
			result.failed++;
			const errMsg = error instanceof Error ? error.message : String(error);
			result.errors.push({ stepName: entry.name, error: errMsg });
			log.error(`Compensation for "${entry.name}" failed: ${errMsg}`);
		}
	}

	log.info(
		`Compensation complete: ${result.succeeded} succeeded, ${result.failed} failed`,
	);

	return result;
}
