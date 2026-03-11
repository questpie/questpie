/**
 * Workflow Engine Errors
 *
 * Special error types used for control flow in the replay engine.
 */

/**
 * Thrown by `step.sleep()` / `step.sleepUntil()` to suspend workflow execution.
 * Caught by the replay engine to transition the instance to "suspended" state
 * and schedule a timed resume via the `wf-resume` job.
 *
 * This is a control-flow mechanism, not an actual error.
 */
export class StepSuspendError extends Error {
	readonly name = "StepSuspendError";

	constructor(
		/** The step name that initiated the sleep. */
		public readonly stepName: string,
		/** When the workflow should resume. */
		public readonly sleepUntil: Date,
	) {
		super(
			`Workflow suspended at step "${stepName}" until ${sleepUntil.toISOString()}`,
		);
	}
}

/**
 * Thrown when the replayed step sequence doesn't match the expected order.
 * Indicates non-deterministic handler code (e.g. step names change between executions).
 */
export class NonDeterministicError extends Error {
	readonly name = "NonDeterministicError";

	constructor(
		/** Expected step name from the cache. */
		public readonly expectedStep: string,
		/** Actual step name encountered during replay. */
		public readonly actualStep: string,
		/** Step index where the mismatch occurred. */
		public readonly stepIndex: number,
	) {
		super(
			`Non-deterministic workflow: expected step "${expectedStep}" at index ${stepIndex}, got "${actualStep}". ` +
				"Step names and order must be deterministic across replays.",
		);
	}
}

/**
 * Thrown when a workflow exceeds its configured timeout.
 */
export class WorkflowTimeoutError extends Error {
	readonly name = "WorkflowTimeoutError";

	constructor(
		public readonly instanceId: string,
		public readonly timeoutSeconds: number,
	) {
		super(
			`Workflow instance "${instanceId}" exceeded timeout of ${timeoutSeconds}s`,
		);
	}
}
