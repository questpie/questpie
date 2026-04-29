/**
 * Step Execution Context
 *
 * Implements `WorkflowStepContext` — the durable step primitives available
 * inside a workflow handler.
 *
 * Core replay model:
 * 1. On entry, the engine loads all existing step records into a cache map
 * 2. Each `step.*()` call checks the cache first — completed steps return
 *    cached results without re-executing
 * 3. New steps execute their function, persist the result, then return
 * 4. Suspending steps (sleep, waitForEvent, invoke) persist and throw
 *    `StepSuspendError` to pause execution
 * 5. Step execution order is tracked for non-determinism detection
 */

import type {
	Duration,
	InvokeOptions,
	SendEventOptions,
	StepRunOptions,
	WaitForEventOptions,
	WorkflowStepContext,
} from "../workflow/types.js";
import { parseDuration, resolveDate } from "./duration.js";
import { NonDeterministicError, StepSuspendError } from "./errors.js";
import type { EventPersistence, ResumeWaiterFn } from "./events.js";
import { checkRetroactiveMatch, dispatchEvent } from "./events.js";
import { computeMatchHash } from "./match-hash.js";

// ============================================================================
// Types
// ============================================================================

/** Step type discriminant — matches the step.type column. */
export type StepType =
	| "run"
	| "sleep"
	| "sleepUntil"
	| "waitForEvent"
	| "invoke"
	| "sendEvent";

/** Step status — matches the step.status column. */
export type StepStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "sleeping"
	| "waiting";

/**
 * A cached step record — loaded from the database at the start of execution.
 */
export interface CachedStep {
	name: string;
	type: StepType;
	status: StepStatus;
	result: unknown | null;
	error: unknown | null;
	attempt: number;
	scheduledAt: Date | null;
	hasCompensation: boolean;
}

/**
 * Persistence operations required by the step context.
 *
 * This is the "port" that the engine layer depends on — the actual
 * implementation is provided by the wf-execute job using the QUESTPIE
 * collection API.
 */
export interface StepPersistence {
	/**
	 * Create a new step record.
	 */
	createStep(step: {
		instanceId: string;
		name: string;
		type: StepType;
		status: StepStatus;
		result?: unknown;
		error?: unknown;
		scheduledAt?: Date;
		eventName?: string;
		matchCriteria?: unknown;
		/** Deterministic hash of matchCriteria for O(1) event lookup. */
		matchHash?: string;
		childInstanceId?: string;
		hasCompensation: boolean;
		maxAttempts: number;
	}): Promise<{ id: string }>;

	/**
	 * Update an existing step's status and result.
	 */
	updateStep(
		instanceId: string,
		name: string,
		update: {
			status: StepStatus;
			result?: unknown;
			error?: unknown;
			scheduledAt?: Date;
			attempt?: number;
			childInstanceId?: string;
		},
	): Promise<void>;
}

/**
 * Callback to trigger a child workflow.
 * Returns the child instance ID.
 */
export type TriggerChildFn = (
	workflowName: string,
	input: unknown,
	options: {
		parentInstanceId: string;
		parentStepName: string;
		timeout?: string;
	},
) => Promise<{ instanceId: string }>;

// ============================================================================
// StepExecutionContext
// ============================================================================

/**
 * Implements the durable step primitives with replay-from-cache semantics.
 *
 * Each step call follows the pattern:
 * 1. Validate step name (no duplicates within one execution)
 * 2. Check execution order (non-determinism detection during replay)
 * 3. Check cache — if completed, return cached result
 * 4. Execute the step's logic
 * 5. Persist the result
 * 6. Return the result (or throw StepSuspendError for suspend steps)
 */
export class StepExecutionContext implements WorkflowStepContext {
	/** Tracks the order of step calls in this execution. */
	private readonly executionOrder: string[] = [];

	/** Steps that have registered compensation callbacks. */
	private readonly compensations: Array<{
		name: string;
		fn: (result: unknown) => Promise<void>;
		result: unknown;
	}> = [];

	constructor(
		private readonly instanceId: string,
		private readonly cachedSteps: Map<string, CachedStep>,
		private readonly cachedExecutionOrder: string[],
		private readonly persistence: StepPersistence,
		private readonly defaultRetry?: {
			maxAttempts?: number;
		},
		private readonly eventPersistence?: EventPersistence,
		private readonly resumeWaiter?: ResumeWaiterFn,
		private readonly triggerChild?: TriggerChildFn,
	) {}

	// ── Public API ──────────────────────────────────────────

	async run<T>(
		name: string,
		fnOrOpts: (() => Promise<T>) | StepRunOptions,
		maybeFn?: () => Promise<T>,
	): Promise<T> {
		// Parse overloads
		let fn: () => Promise<T>;
		let opts: StepRunOptions | undefined;
		if (typeof fnOrOpts === "function") {
			fn = fnOrOpts;
		} else {
			opts = fnOrOpts;
			fn = maybeFn!;
		}

		this.trackStep(name);

		// Check cache
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			// Register compensation if provided (for failure rollback later)
			if (opts?.compensate) {
				this.compensations.push({
					name,
					fn: opts.compensate,
					result: cached.result,
				});
			}
			return cached.result as T;
		}

		// Execute the function (with optional step-level timeout)
		const maxAttempts =
			opts?.retry?.maxAttempts ?? this.defaultRetry?.maxAttempts ?? 1;

		try {
			let result: T;

			if (opts?.timeout) {
				const timeoutMs = parseDuration(opts.timeout);
				result = await Promise.race([
					fn(),
					new Promise<never>((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error(`Step "${name}" timed out after ${opts!.timeout}`),
								),
							timeoutMs,
						),
					),
				]);
			} else {
				result = await fn();
			}

			// Persist completed step
			if (cached) {
				await this.persistence.updateStep(this.instanceId, name, {
					status: "completed",
					result,
				});
			} else {
				await this.persistence.createStep({
					instanceId: this.instanceId,
					name,
					type: "run",
					status: "completed",
					result,
					hasCompensation: !!opts?.compensate,
					maxAttempts,
				});
			}

			// Register compensation
			if (opts?.compensate) {
				this.compensations.push({
					name,
					fn: opts.compensate,
					result,
				});
			}

			return result;
		} catch (error) {
			// Persist failed step
			const errData =
				error instanceof Error
					? { message: error.message, stack: error.stack }
					: { message: String(error) };

			if (cached) {
				await this.persistence.updateStep(this.instanceId, name, {
					status: "failed",
					error: errData,
				});
			} else {
				await this.persistence.createStep({
					instanceId: this.instanceId,
					name,
					type: "run",
					status: "failed",
					error: errData,
					hasCompensation: !!opts?.compensate,
					maxAttempts,
				});
			}

			throw error;
		}
	}

	async sleep(name: string, duration: Duration): Promise<void> {
		this.trackStep(name);

		// Check cache — if completed (i.e., resumed), return
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			return;
		}

		// Calculate resume time
		const resumeAt = resolveDate(duration);

		// Persist sleeping step
		if (!cached) {
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "sleep",
				status: "sleeping",
				scheduledAt: resumeAt,
				hasCompensation: false,
				maxAttempts: 1,
			});
		}

		// Suspend execution
		throw new StepSuspendError("sleep", name, resumeAt);
	}

	async sleepUntil(name: string, date: Date): Promise<void> {
		this.trackStep(name);

		// Check cache — if completed (i.e., resumed), return
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			return;
		}

		// Persist sleeping step
		if (!cached) {
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "sleepUntil",
				status: "sleeping",
				scheduledAt: date,
				hasCompensation: false,
				maxAttempts: 1,
			});
		}

		// Suspend execution
		throw new StepSuspendError("sleepUntil", name, date);
	}

	async waitForEvent<T = unknown>(
		name: string,
		opts: WaitForEventOptions,
	): Promise<T | null> {
		this.trackStep(name);

		// Check cache — if completed, return the matched event data
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			return cached.result as T | null;
		}

		// Compute match hash for O(1) event lookup
		const matchHash = computeMatchHash(opts.match);

		// Retroactive check — see if a matching event was already sent
		if (this.eventPersistence && !cached) {
			const retroMatch = await checkRetroactiveMatch(
				opts.event,
				opts.match,
				this.eventPersistence,
			);
			if (retroMatch) {
				// Event already exists — complete immediately
				await this.persistence.createStep({
					instanceId: this.instanceId,
					name,
					type: "waitForEvent",
					status: "completed",
					result: retroMatch.data,
					eventName: opts.event,
					matchCriteria: opts.match,
					matchHash,
					hasCompensation: false,
					maxAttempts: 1,
				});
				return retroMatch.data as T | null;
			}
		}

		// Calculate timeout
		const scheduledAt = opts.timeout ? resolveDate(opts.timeout) : undefined;

		// Persist waiting step
		if (!cached) {
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "waitForEvent",
				status: "waiting",
				scheduledAt,
				eventName: opts.event,
				matchCriteria: opts.match,
				matchHash,
				hasCompensation: false,
				maxAttempts: 1,
			});
		}

		// Suspend execution — the event matching engine will resume this
		throw new StepSuspendError("waitForEvent", name, scheduledAt);
	}

	async invoke<T>(name: string, opts: InvokeOptions): Promise<T> {
		this.trackStep(name);

		// Check cache — if completed, return the child's output
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			return cached.result as T;
		}

		// If we have a failed cached step for this invoke, propagate the error
		if (cached?.status === "failed") {
			const errMsg =
				typeof cached.error === "object" &&
				cached.error !== null &&
				"message" in cached.error
					? (cached.error as { message: string }).message
					: "Child workflow failed";
			throw new Error(`Child workflow "${opts.workflow}" failed: ${errMsg}`);
		}

		// Calculate timeout
		const scheduledAt = opts.timeout ? resolveDate(opts.timeout) : undefined;

		// Trigger child workflow if we have the triggerChild function and no cached step
		if (this.triggerChild && !cached) {
			const child = await this.triggerChild(opts.workflow, opts.input, {
				parentInstanceId: this.instanceId,
				parentStepName: name,
				timeout: opts.timeout,
			});

			// Persist invoke step with child instance ID
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "invoke",
				status: "waiting",
				scheduledAt,
				childInstanceId: child.instanceId,
				hasCompensation: false,
				maxAttempts: 1,
			});
		} else if (!cached) {
			// No triggerChild — just persist the step (tests or stub mode)
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "invoke",
				status: "waiting",
				scheduledAt,
				hasCompensation: false,
				maxAttempts: 1,
			});
		}

		// Suspend execution — the child workflow completion will resume this
		throw new StepSuspendError("invoke", name, scheduledAt);
	}

	async sendEvent(name: string, opts: SendEventOptions): Promise<void> {
		this.trackStep(name);

		// Check cache — if already sent, skip
		const cached = this.cachedSteps.get(name);
		if (cached?.status === "completed") {
			return;
		}

		// Create event and match waiters if event persistence is available
		if (this.eventPersistence && this.resumeWaiter) {
			await dispatchEvent(
				{
					name: opts.event,
					data: opts.data,
					match: opts.match,
					sourceType: "workflow",
					sourceInstanceId: this.instanceId,
					sourceStepName: name,
				},
				this.eventPersistence,
				this.resumeWaiter,
			);
		}

		// Persist the event step as completed (sendEvent is fire-and-forget)
		if (cached) {
			await this.persistence.updateStep(this.instanceId, name, {
				status: "completed",
				result: { event: opts.event, data: opts.data, match: opts.match },
			});
		} else {
			await this.persistence.createStep({
				instanceId: this.instanceId,
				name,
				type: "sendEvent",
				status: "completed",
				result: { event: opts.event, data: opts.data, match: opts.match },
				eventName: opts.event,
				matchCriteria: opts.match,
				hasCompensation: false,
				maxAttempts: 1,
			});
		}
	}

	// ── Accessors (for engine layer) ────────────────────────

	/**
	 * Get the execution order of steps in this run.
	 */
	getExecutionOrder(): readonly string[] {
		return this.executionOrder;
	}

	/**
	 * Get registered compensations (in order of execution).
	 * The engine will run these in reverse order on failure.
	 */
	getCompensations(): ReadonlyArray<{
		name: string;
		fn: (result: unknown) => Promise<void>;
		result: unknown;
	}> {
		return this.compensations;
	}

	// ── Internal ──────────────────────────────────────────────

	/**
	 * Track a step in the execution order and validate non-determinism.
	 *
	 * During replay, the order of step calls must match the order from
	 * the previous execution. If a mismatch is detected, it means the
	 * workflow code was modified between executions.
	 */
	private trackStep(name: string): void {
		const index = this.executionOrder.length;

		// Check for duplicate step names in this execution
		if (this.executionOrder.includes(name)) {
			throw new Error(
				`Duplicate step name: "${name}". Step names must be unique within a workflow execution.`,
			);
		}

		// Non-determinism detection: if we have a cached execution order,
		// verify the step at this index matches
		if (index < this.cachedExecutionOrder.length) {
			const expected = this.cachedExecutionOrder[index];
			if (expected !== name) {
				throw new NonDeterministicError(name, expected, index);
			}
		}

		this.executionOrder.push(name);
	}
}
