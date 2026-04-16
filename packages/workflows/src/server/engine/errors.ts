/**
 * Workflow Engine Errors
 *
 * Custom error types used internally by the replay engine.
 *
 * - {@link StepSuspendError} — thrown to pause execution (sleep, waitForEvent, invoke)
 * - {@link StepRetryError} — thrown to signal a step should be retried
 * - {@link StepFailedError} — wraps a step failure with metadata
 * - {@link NonDeterministicError} — thrown when replay detects step order mismatch
 * - {@link WorkflowTimeoutError} — thrown when a workflow exceeds its timeout
 */

// ============================================================================
// Base Error
// ============================================================================

/**
 * Base class for all workflow-specific errors.
 *
 * Provides a `code` discriminant so callers can use `instanceof` checks
 * or switch on `.code` without relying on error messages.
 */
export abstract class WorkflowError extends Error {
	abstract readonly code: string;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = this.constructor.name;
	}
}

// ============================================================================
// StepSuspendError
// ============================================================================

/**
 * Step suspension reason — indicates why execution was paused.
 */
export type SuspendReason = "sleep" | "sleepUntil" | "waitForEvent" | "invoke";

/**
 * Thrown to pause workflow execution when a step needs to wait.
 *
 * This is a **control flow signal**, not a true error — the engine catches it
 * and transitions the instance to "suspended" status.
 *
 * @example
 * ```ts
 * // Inside step.sleep():
 * throw new StepSuspendError("sleep", "delay-5m", new Date("2026-01-01T00:05:00Z"));
 * ```
 */
export class StepSuspendError extends WorkflowError {
	readonly code = "STEP_SUSPENDED" as const;

	constructor(
		/** Why the step is suspended. */
		readonly reason: SuspendReason,
		/** Name of the step that caused suspension. */
		readonly stepName: string,
		/** When to resume (for sleep/sleepUntil), or undefined for event-based waits. */
		readonly resumeAt?: Date,
	) {
		super(`Step "${stepName}" suspended: ${reason}`);
	}
}

// ============================================================================
// StepRetryError
// ============================================================================

/**
 * Thrown to signal that a step should be retried.
 *
 * The engine catches this and schedules a retry according to the step's
 * retry policy (or the workflow-level default).
 */
export class StepRetryError extends WorkflowError {
	readonly code = "STEP_RETRY" as const;

	constructor(
		/** Name of the step to retry. */
		readonly stepName: string,
		/** Current attempt number (1-indexed). */
		readonly attempt: number,
		/** Maximum attempts allowed. */
		readonly maxAttempts: number,
		/** When to retry next. */
		readonly retryAt: Date,
		/** The original error that triggered the retry. */
		readonly cause: Error,
	) {
		super(
			`Step "${stepName}" failed (attempt ${attempt}/${maxAttempts}), retrying at ${retryAt.toISOString()}`,
			{ cause },
		);
	}
}

// ============================================================================
// StepFailedError
// ============================================================================

/**
 * Thrown when a step has exhausted all retries and permanently failed.
 *
 * The engine catches this and may trigger onFailure / compensation.
 */
export class StepFailedError extends WorkflowError {
	readonly code = "STEP_FAILED" as const;

	constructor(
		/** Name of the failed step. */
		readonly stepName: string,
		/** Total attempts made. */
		readonly attempts: number,
		/** The final error. */
		readonly cause: Error,
	) {
		super(
			`Step "${stepName}" failed permanently after ${attempts} attempt(s): ${cause.message}`,
			{ cause },
		);
	}
}

// ============================================================================
// NonDeterministicError
// ============================================================================

/**
 * Thrown when the replay engine detects a non-deterministic step order.
 *
 * This happens when a workflow's code is modified between executions —
 * steps appear in a different order than what was recorded. This is a
 * serious error: the workflow instance is marked as "failed" and requires
 * manual intervention.
 *
 * @example
 * ```ts
 * // If original execution ran: stepA → stepB → stepC
 * // But modified code now runs: stepA → stepC → stepB
 * // → NonDeterministicError at step "stepC" (expected "stepB" at index 1)
 * ```
 */
export class NonDeterministicError extends WorkflowError {
	readonly code = "NON_DETERMINISTIC" as const;

	constructor(
		/** Step name encountered during replay. */
		readonly stepName: string,
		/** Expected step name at this position (from cached execution order). */
		readonly expectedStepName: string,
		/** Position in the execution order (0-indexed). */
		readonly index: number,
	) {
		super(
			`Non-deterministic step order: step "${stepName}" at index ${index}, ` +
				`but expected "${expectedStepName}". The workflow code may have been modified ` +
				`between executions. This instance requires manual intervention.`,
		);
	}
}

// ============================================================================
// WorkflowTimeoutError
// ============================================================================

/**
 * Thrown when a workflow instance exceeds its configured timeout.
 *
 * The maintenance job detects timed-out instances and transitions them
 * to "timed_out" status. This error is attached for diagnostic purposes.
 */
export class WorkflowTimeoutError extends WorkflowError {
	readonly code = "WORKFLOW_TIMEOUT" as const;

	constructor(
		/** Instance ID of the timed-out workflow. */
		readonly instanceId: string,
		/** The configured timeout that was exceeded. */
		readonly timeout: string,
	) {
		super(`Workflow instance "${instanceId}" exceeded timeout of ${timeout}`);
	}
}
