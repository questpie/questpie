/**
 * Event Matching Engine
 *
 * Implements JSONB-containment-style matching between events and waiters.
 *
 * Two flows:
 * 1. **Forward**: `sendEvent()` → find all waiting steps → resume them
 * 2. **Retroactive**: `waitForEvent()` → check if a matching event already exists
 *
 * Matching semantics (mirrors PostgreSQL JSONB `@>` containment):
 * - Null/empty criteria = match any event with the same name
 * - Each key in the criteria must exist in the target and have equal value
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Port interface for event persistence operations.
 *
 * Implemented by the wf-execute job layer using QUESTPIE collection CRUD.
 */
export interface EventPersistence {
	/** Insert an event record into wf_event. */
	createEvent(event: {
		eventName: string;
		data?: unknown;
		matchCriteria?: Record<string, unknown>;
		sourceType: "workflow" | "hook" | "external";
		sourceInstanceId?: string;
		sourceStepName?: string;
	}): Promise<{ id: string }>;

	/**
	 * Find a matching unconsumed event (retroactive check).
	 * Used by waitForEvent to check if an event was already sent.
	 */
	findMatchingEvent(
		eventName: string,
		matchCriteria?: Record<string, unknown>,
	): Promise<{ id: string; data: unknown } | null>;

	/**
	 * Find all waiting steps that match a given event.
	 * Used by sendEvent to resume matching workflows.
	 */
	findWaitingSteps(
		eventName: string,
		matchData?: Record<string, unknown>,
	): Promise<
		Array<{
			instanceId: string;
			stepName: string;
			matchCriteria: Record<string, unknown> | null;
		}>
	>;

	/**
	 * Increment the consumed count on an event (marks it as matched).
	 */
	markEventConsumed(eventId: string): Promise<void>;
}

/**
 * Callback to resume a waiting workflow step.
 * Typically publishes a wf-resume job.
 */
export type ResumeWaiterFn = (
	instanceId: string,
	stepName: string,
	result: unknown,
) => Promise<void>;

// ============================================================================
// Pure matching logic
// ============================================================================

/**
 * Check if `target` satisfies `criteria` using containment semantics.
 *
 * This mirrors PostgreSQL's JSONB `@>` operator:
 * - Null/empty criteria matches everything
 * - Every key in criteria must exist in target with the same value
 *
 * @param criteria - The match criteria (from the waiter or event)
 * @param target - The match data (from the event or waiter)
 * @returns true if target contains all criteria key-value pairs
 */
export function matchesCriteria(
	criteria: Record<string, unknown> | null | undefined,
	target: Record<string, unknown> | null | undefined,
): boolean {
	// No criteria = match anything
	if (!criteria || Object.keys(criteria).length === 0) return true;

	// Has criteria but no target = no match
	if (!target) return false;

	// Every key in criteria must exist in target with equal value
	for (const [key, value] of Object.entries(criteria)) {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			// Recursive containment for nested objects
			if (
				typeof target[key] !== "object" ||
				target[key] === null ||
				Array.isArray(target[key])
			) {
				return false;
			}
			if (
				!matchesCriteria(
					value as Record<string, unknown>,
					target[key] as Record<string, unknown>,
				)
			) {
				return false;
			}
		} else if (target[key] !== value) {
			return false;
		}
	}

	return true;
}

// ============================================================================
// Event dispatch
// ============================================================================

/**
 * Send an event and resume all matching waiters.
 *
 * Flow:
 * 1. Insert event into wf_event
 * 2. Find all waiting steps whose eventName matches and matchCriteria
 *    is contained by the event's matchData
 * 3. Resume each matched waiter via the callback
 *
 * @returns Number of waiters that were matched and resumed
 */
export async function dispatchEvent(
	event: {
		name: string;
		data?: unknown;
		match?: Record<string, unknown>;
		sourceType: "workflow" | "hook" | "external";
		sourceInstanceId?: string;
		sourceStepName?: string;
	},
	persistence: EventPersistence,
	resumeWaiter: ResumeWaiterFn,
): Promise<{ matchedCount: number }> {
	// 1. Persist the event
	await persistence.createEvent({
		eventName: event.name,
		data: event.data,
		matchCriteria: event.match,
		sourceType: event.sourceType,
		sourceInstanceId: event.sourceInstanceId,
		sourceStepName: event.sourceStepName,
	});

	// 2. Find waiting steps that match this event
	const waiters = await persistence.findWaitingSteps(event.name, event.match);

	// 3. Resume each matched waiter
	let matchedCount = 0;
	for (const waiter of waiters) {
		// Double-check criteria match in application layer
		// (the persistence layer may return broader results)
		if (matchesCriteria(waiter.matchCriteria, event.match)) {
			await resumeWaiter(waiter.instanceId, waiter.stepName, event.data);
			matchedCount++;
		}
	}

	return { matchedCount };
}

/**
 * Check retroactively if a matching event already exists.
 *
 * Used by `step.waitForEvent()` — before suspending, check if the event
 * was already sent. If so, return the event data immediately and mark
 * it as consumed.
 *
 * @returns The event data if found, or null
 */
export async function checkRetroactiveMatch(
	eventName: string,
	matchCriteria: Record<string, unknown> | undefined,
	persistence: EventPersistence,
): Promise<{ data: unknown } | null> {
	const event = await persistence.findMatchingEvent(eventName, matchCriteria);

	if (event) {
		await persistence.markEventConsumed(event.id);
		return { data: event.data };
	}

	return null;
}
