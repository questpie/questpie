import type { StepToolbox, WorkflowLogger } from "questpie";
import { durationFromNow } from "./duration.js";
import { NonDeterministicError, StepSuspendError } from "./errors.js";

/** Cached step record loaded from DB on replay. */
export interface CachedStep {
	stepName: string;
	stepIndex: number;
	status: string;
	result: unknown;
}

/**
 * Create a replay-aware StepToolbox.
 *
 * On replay, completed steps return their cached results instantly.
 * New steps execute their function, persist the result, and continue.
 * Sleep steps throw StepSuspendError to pause the workflow.
 *
 * @param instanceId - Workflow instance ID
 * @param completedSteps - Steps already completed (loaded from wf_step)
 * @param persistStep - Callback to persist a new step result to DB
 * @param logger - Workflow logger for step-level logging
 */
export function createStepToolbox(
	instanceId: string,
	completedSteps: CachedStep[],
	persistStep: (step: {
		instanceId: string;
		stepName: string;
		stepIndex: number;
		status: string;
		result?: unknown;
		error?: string;
		sleepUntil?: Date;
		completedAt?: Date;
	}) => Promise<void>,
	recordEvent: (event: {
		instanceId: string;
		type: string;
		stepName?: string;
		data?: unknown;
	}) => Promise<void>,
	logger: WorkflowLogger,
): StepToolbox {
	// Build ordered cache from completed steps
	const stepCache = new Map<string, CachedStep>();
	for (const step of completedSteps) {
		stepCache.set(step.stepName, step);
	}

	// Track execution order for non-determinism detection
	let nextStepIndex = 0;
	const executedStepNames = new Set<string>();

	const validateStepOrder = (stepName: string): void => {
		// Check for duplicate step names in the same execution
		if (executedStepNames.has(stepName)) {
			throw new Error(
				`Duplicate step name "${stepName}" in workflow instance "${instanceId}". ` +
					"Each step must have a unique name within a workflow handler.",
			);
		}
		executedStepNames.add(stepName);

		// Check non-determinism: if we have cached steps, the order must match
		const cachedAtIndex = completedSteps[nextStepIndex];
		if (cachedAtIndex && cachedAtIndex.stepName !== stepName) {
			throw new NonDeterministicError(
				cachedAtIndex.stepName,
				stepName,
				nextStepIndex,
			);
		}

		nextStepIndex++;
	};

	const run: StepToolbox["run"] = async <T>(
		name: string,
		fn: () => Promise<T>,
	): Promise<T> => {
		validateStepOrder(name);

		// Check cache — return memoized result on replay
		const cached = stepCache.get(name);
		if (cached && cached.status === "completed") {
			logger.debug(`Step "${name}" replayed from cache`);
			return cached.result as T;
		}

		// Execute the step function
		logger.info(`Step "${name}" executing`);
		const startedAt = new Date();
		let result: T;

		try {
			result = await fn();
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : String(error);
			await persistStep({
				instanceId,
				stepName: name,
				stepIndex: nextStepIndex - 1,
				status: "failed",
				error: errorMsg,
			});
			await recordEvent({
				instanceId,
				type: "step_failed",
				stepName: name,
				data: { error: errorMsg },
			});
			logger.error(`Step "${name}" failed: ${errorMsg}`);
			throw error;
		}

		// Persist the result
		await persistStep({
			instanceId,
			stepName: name,
			stepIndex: nextStepIndex - 1,
			status: "completed",
			result,
			completedAt: new Date(),
		});
		await recordEvent({
			instanceId,
			type: "step_completed",
			stepName: name,
			data: {
				durationMs: Date.now() - startedAt.getTime(),
			},
		});

		logger.info(`Step "${name}" completed`);
		return result;
	};

	const sleep: StepToolbox["sleep"] = async (
		name: string,
		duration: string,
	): Promise<void> => {
		validateStepOrder(name);

		// Check cache — if already completed (resumed), skip
		const cached = stepCache.get(name);
		if (cached && cached.status === "completed") {
			logger.debug(`Sleep step "${name}" already completed, skipping`);
			return;
		}

		// Parse duration and suspend
		const sleepUntil = durationFromNow(duration);
		logger.info(
			`Step "${name}" sleeping until ${sleepUntil.toISOString()} (${duration})`,
		);

		await persistStep({
			instanceId,
			stepName: name,
			stepIndex: nextStepIndex - 1,
			status: "sleeping",
			sleepUntil,
		});

		throw new StepSuspendError(name, sleepUntil);
	};

	const sleepUntil: StepToolbox["sleepUntil"] = async (
		name: string,
		until: Date,
	): Promise<void> => {
		validateStepOrder(name);

		// Check cache — if already completed (resumed), skip
		const cached = stepCache.get(name);
		if (cached && cached.status === "completed") {
			logger.debug(
				`Sleep step "${name}" already completed, skipping`,
			);
			return;
		}

		logger.info(`Step "${name}" sleeping until ${until.toISOString()}`);

		await persistStep({
			instanceId,
			stepName: name,
			stepIndex: nextStepIndex - 1,
			status: "sleeping",
			sleepUntil: until,
		});

		throw new StepSuspendError(name, until);
	};

	return { run, sleep, sleepUntil };
}
