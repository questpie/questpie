import type { z } from "zod";

// ============================================================================
// Duration
// ============================================================================

/**
 * Duration string — human-readable time span.
 *
 * Syntax: `"<number><unit>"` where unit is one of:
 * - `s` — seconds
 * - `m` — minutes
 * - `h` — hours
 * - `d` — days
 * - `w` — weeks
 *
 * @example "5s" | "3m" | "1h" | "3d" | "1w" | "30d"
 */
export type Duration = string;

// ============================================================================
// Cron Overlap Policy
// ============================================================================

/**
 * Strategy for handling overlapping cron-triggered instances.
 *
 * - `"skip"` — Skip the new trigger if there's already a running instance (default).
 * - `"allow"` — Always create a new instance, even if one is running.
 * - `"cancel-previous"` — Cancel the existing running instance and start a new one.
 */
export type CronOverlapPolicy = "skip" | "allow" | "cancel-previous";

// ============================================================================
// Retention Policy
// ============================================================================

/**
 * Retention configuration for automatic cleanup of old workflow data.
 *
 * After the specified duration, completed/failed/cancelled/timed_out instances
 * and their associated steps, events, and logs are permanently deleted.
 */
export interface RetentionPolicy {
	/** Duration after which completed instances are deleted. Default: "30d". */
	completedAfter?: Duration;
	/** Duration after which failed instances are deleted. Default: no cleanup. */
	failedAfter?: Duration;
	/** Duration after which cancelled instances are deleted. Default: no cleanup. */
	cancelledAfter?: Duration;
	/** Duration after which unconsumed events are deleted. Default: "7d". */
	eventsAfter?: Duration;
}

// ============================================================================
// Retry Policy
// ============================================================================

/**
 * Retry configuration for steps and workflow-level retries.
 */
export interface StepRetryPolicy {
	/** Maximum number of retry attempts (default: 3). */
	maxAttempts?: number;
	/** Delay between retries (default: "5s"). */
	delay?: Duration;
	/** Backoff strategy (default: "exponential"). */
	backoff?: "fixed" | "linear" | "exponential";
	/** Maximum delay cap (default: "5m"). */
	maxDelay?: Duration;
}

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Complete workflow definition.
 *
 * This is the value returned by `workflow()` — an identity function that
 * passes it through unchanged. The definition exists purely for TypeScript
 * type inference and runtime registration.
 *
 * @template TInput - Input payload type (inferred from `schema`)
 * @template TOutput - Handler return type
 * @template TName - Workflow name as a literal string type
 */
export interface WorkflowDefinition<
	TInput = any,
	TOutput = any,
	TName extends string = string,
> {
	/** Unique workflow name — used as the registration key. */
	name: TName;
	/** Zod schema for input validation. */
	schema: z.ZodSchema<TInput>;
	/** Workflow-level timeout. Instance is timed out if not completed within this duration. */
	timeout?: Duration;
	/** Minimum log level written to `wf_log`. Default: "info". */
	logLevel?: "debug" | "info" | "warn" | "error" | "none";
	/** Default retry policy for steps that don't specify their own. */
	retryPolicy?: StepRetryPolicy;
	/** Cron expression for recurring execution. */
	cron?: string;
	/** Strategy for handling overlapping cron-triggered instances. Default: "skip". */
	cronOverlap?: CronOverlapPolicy;
	/** Retention policy for automatic cleanup of old instances. */
	retention?: RetentionPolicy;
	/** Called when the handler throws (after step retries are exhausted). */
	onFailure?: (args: WorkflowFailureArgs<TInput>) => Promise<void>;
	/** Main workflow handler. */
	handler: (args: WorkflowHandlerArgs<TInput>) => Promise<TOutput>;
}

// ============================================================================
// Step Context
// ============================================================================

/**
 * Step execution primitives available inside a workflow handler.
 *
 * Each method is a durable primitive — on replay, completed steps return
 * cached results without re-executing. Suspending steps (sleep, waitForEvent,
 * invoke) throw `StepSuspendError` to pause execution.
 */
export interface WorkflowStepContext {
	/**
	 * Execute a function with result caching.
	 * On replay, returns the cached result without calling `fn`.
	 */
	run<T>(name: string, fn: () => Promise<T>): Promise<T>;
	/**
	 * Execute a function with result caching and step-level options
	 * (retry, timeout, compensate).
	 */
	run<T>(name: string, opts: StepRunOptions, fn: () => Promise<T>): Promise<T>;

	/**
	 * Durable sleep — persists to DB, survives process restarts.
	 * Resumes after the specified duration.
	 */
	sleep(name: string, duration: Duration): Promise<void>;

	/**
	 * Durable sleep until an absolute timestamp.
	 * Resumes at or after the specified date.
	 */
	sleepUntil(name: string, date: Date): Promise<void>;

	/**
	 * Wait for an external event matching the given criteria.
	 * Returns event data on match, or `null` on timeout.
	 * Checks retroactively for already-sent events before suspending.
	 */
	waitForEvent<T = unknown>(
		name: string,
		opts: WaitForEventOptions,
	): Promise<T | null>;

	/**
	 * Invoke a child workflow and wait for its result.
	 * Child receives a cascading timeout: `min(child timeout, parent remaining)`.
	 */
	invoke<T>(name: string, opts: InvokeOptions): Promise<T>;

	/**
	 * Emit an event that matches waiting workflows.
	 * Matched waiters are resumed immediately.
	 */
	sendEvent(name: string, opts: SendEventOptions): Promise<void>;
}

// ============================================================================
// Logger
// ============================================================================

/**
 * Structured logger available inside workflow handlers.
 *
 * Dual output: every entry goes to the `wf_log` collection (queryable in
 * admin UI) AND to the external logger (pino, etc.) if configured.
 */
export interface WorkflowLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

// ============================================================================
// Handler Args
// ============================================================================

/**
 * Arguments passed to the workflow `handler`.
 *
 * Extends the app context with workflow-specific properties.
 *
 * @template TInput - Validated input type (from `schema`)
 */
export interface WorkflowHandlerArgs<TInput = any> {
	/** Validated input payload. */
	input: TInput;
	/** Durable step primitives. */
	step: WorkflowStepContext;
	/** Structured workflow logger. */
	log: WorkflowLogger;
	/** Full app context (db, queue, collections, etc.). Populated at runtime. */
	ctx: Record<string, any>;
}

/**
 * Arguments passed to the `onFailure` handler.
 *
 * @template TInput - Validated input type (from `schema`)
 */
export interface WorkflowFailureArgs<TInput = any> {
	/** Validated input payload. */
	input: TInput;
	/** The error that caused the failure. */
	error: Error;
	/** Durable step primitives (can run compensating steps). */
	step: WorkflowStepContext;
	/** Map of completed steps for inspection. */
	completedSteps: CompletedStepsMap;
	/** Structured workflow logger. */
	log: WorkflowLogger;
	/** Full app context. */
	ctx: Record<string, any>;
}

// ============================================================================
// Step Options
// ============================================================================

/**
 * Options for `step.run()`.
 */
export interface StepRunOptions {
	/** Step-level retry policy (overrides workflow default). */
	retry?: StepRetryPolicy;
	/** Step-level timeout. Wraps `fn()` in `Promise.race`. */
	timeout?: Duration;
	/** Inline compensation callback — runs in reverse order on failure. */
	compensate?: (result: any) => Promise<void>;
}

/**
 * Options for `step.waitForEvent()`.
 */
export interface WaitForEventOptions {
	/** Event name to match. */
	event: string;
	/** JSONB containment match criteria. Null/undefined = match any. */
	match?: Record<string, any>;
	/** Timeout — returns `null` if no event arrives within this duration. */
	timeout?: Duration;
}

/**
 * Options for `step.invoke()`.
 */
export interface InvokeOptions {
	/** Name of the child workflow to invoke. */
	workflow: string;
	/** Input payload for the child workflow. */
	input: unknown;
	/** Timeout for the child workflow (cascaded with parent remaining). */
	timeout?: Duration;
}

/**
 * Options for `step.sendEvent()`.
 */
export interface SendEventOptions {
	/** Event name. */
	event: string;
	/** Event data payload. */
	data?: unknown;
	/** Match criteria for targeting specific waiters. */
	match?: Record<string, any>;
}

// ============================================================================
// Trigger + Client Types
// ============================================================================

/**
 * Options for triggering a workflow instance.
 */
export interface WorkflowTriggerOptions {
	/** Idempotency key — prevents duplicate instances. */
	idempotencyKey?: string;
	/** Delay before starting execution. */
	delay?: Duration;
	/** Absolute start time. */
	startAt?: Date;
}

/**
 * Runtime representation of a workflow instance.
 */
export interface WorkflowInstance {
	id: string;
	name: string;
	status:
		| "pending"
		| "running"
		| "suspended"
		| "completed"
		| "failed"
		| "cancelled"
		| "timed_out";
	input: unknown;
	output: unknown | null;
	error: unknown | null;
	attempt: number;
	parentInstanceId: string | null;
	parentStepName: string | null;
	idempotencyKey: string | null;
	timeoutAt: Date | null;
	startedAt: Date | null;
	suspendedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Runtime representation of a workflow step record.
 */
export interface WorkflowStepRecord {
	id: string;
	instanceId: string;
	name: string;
	type:
		| "run"
		| "sleep"
		| "sleepUntil"
		| "waitForEvent"
		| "invoke"
		| "sendEvent";
	status:
		| "pending"
		| "running"
		| "completed"
		| "failed"
		| "sleeping"
		| "waiting";
	result: unknown | null;
	error: unknown | null;
	attempt: number;
	maxAttempts: number;
	scheduledAt: Date | null;
	eventName: string | null;
	matchCriteria: unknown | null;
	childInstanceId: string | null;
	hasCompensation: boolean;
	startedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

// ============================================================================
// Completed Steps Map
// ============================================================================

/**
 * Map of completed steps — used in `onFailure` handler for inspection.
 */
export interface CompletedStepsMap {
	/** Check if a step with the given name completed successfully. */
	has(name: string): boolean;
	/** Get the result of a completed step, or undefined. */
	get<T = unknown>(name: string): T | undefined;
	/** Iterate over all completed step entries. */
	entries(): IterableIterator<[string, unknown]>;
}

// ============================================================================
// Inference Utilities
// ============================================================================

/**
 * Infer the input type from a workflow definition.
 */
export type InferWorkflowInput<T> =
	T extends WorkflowDefinition<infer I, any, any> ? I : never;

/**
 * Infer the output type from a workflow definition.
 */
export type InferWorkflowOutput<T> =
	T extends WorkflowDefinition<any, infer O, any> ? O : never;
