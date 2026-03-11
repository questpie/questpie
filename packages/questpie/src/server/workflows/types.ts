import type { z } from "zod";
import type { AppContext } from "#questpie/server/config/app-context.js";

// ============================================================================
// Workflow Definition — what workflow() accepts
// ============================================================================

/**
 * Durable workflow definition.
 *
 * Workflows are long-running, crash-resilient processes that use
 * replay-based execution. Completed steps return cached results on replay.
 *
 * @template TName - Workflow name (literal string type)
 * @template TInput - Validated input payload type
 * @template TOutput - Handler return type
 *
 * @example
 * ```ts
 * import { workflow } from "questpie";
 * import { z } from "zod";
 *
 * export default workflow({
 *   name: "order-processing",
 *   schema: z.object({ orderId: z.string() }),
 *   handler: async ({ step, input }) => {
 *     const order = await step.run("fetch-order", async () => {
 *       return db.select().from(orders).where(eq(orders.id, input.orderId));
 *     });
 *     await step.sleep("wait-processing", "1h");
 *     await step.run("send-confirmation", async () => {
 *       await sendEmail(order.email, "Your order is ready!");
 *     });
 *     return { status: "completed" };
 *   },
 * });
 * ```
 */
export interface WorkflowDefinition<
	TName extends string = string,
	TInput = any,
	TOutput = any,
> {
	/** Unique workflow name (kebab-case). Used as identifier in the registry. */
	name: TName;

	/** Zod schema for input validation. */
	schema: z.ZodSchema<TInput>;

	/** The workflow handler — receives step toolbox + validated input. */
	handler: (ctx: WorkflowHandlerContext<TInput>) => Promise<TOutput>;

	/** Optional workflow configuration. */
	options?: WorkflowHandlerOptions;
}

// ============================================================================
// Workflow Handler Context
// ============================================================================

/**
 * Context passed to the workflow handler function.
 * Extends AppContext with workflow-specific properties.
 */
export interface WorkflowHandlerContext<TInput = any> extends AppContext {
	/** Validated workflow input payload. */
	input: TInput;

	/** Step toolbox — replay-aware step primitives. */
	step: StepToolbox;

	/** Workflow instance ID. */
	instanceId: string;

	/** Current attempt number (1-based). */
	attempt: number;

	/** Structured workflow logger (dual output: DB + external). */
	log: WorkflowLogger;
}

// ============================================================================
// Step Toolbox
// ============================================================================

/**
 * Replay-aware step primitives.
 *
 * On first execution, steps execute their function and cache the result.
 * On replay (after crash/restart), completed steps return cached results
 * instantly without re-executing.
 *
 * Sleep steps suspend workflow execution and schedule a timed resume.
 */
export interface StepToolbox {
	/**
	 * Execute a named step. On replay, returns cached result.
	 *
	 * @param name - Unique step name within this workflow (deterministic)
	 * @param fn - The async function to execute
	 * @returns The step result (cached on replay)
	 */
	run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;

	/**
	 * Sleep for a duration string.
	 * Suspends the workflow and schedules a resume after the duration.
	 *
	 * @param name - Unique step name within this workflow
	 * @param duration - Duration string (e.g. "5s", "30m", "2h", "3d")
	 */
	sleep: (name: string, duration: string) => Promise<void>;

	/**
	 * Sleep until an absolute timestamp.
	 * Suspends the workflow and schedules a resume at the given date.
	 *
	 * @param name - Unique step name within this workflow
	 * @param until - Absolute date/time to resume
	 */
	sleepUntil: (name: string, until: Date) => Promise<void>;
}

// ============================================================================
// Workflow Options
// ============================================================================

/**
 * Optional workflow configuration.
 */
export interface WorkflowHandlerOptions {
	/** Maximum execution time in seconds before timeout. @default 86400 (24h) */
	timeoutSeconds?: number;

	/** Number of retry attempts on handler failure. @default 3 */
	retryLimit?: number;

	/** Delay between retries in seconds. @default 60 */
	retryDelay?: number;

	/** Use exponential backoff for retries. @default true */
	retryBackoff?: boolean;
}

// ============================================================================
// Workflow Logger
// ============================================================================

/**
 * Structured workflow logger with dual output.
 * Writes to both the wf_log collection (queryable in admin) and the
 * external logger (Datadog, Grafana, etc.).
 */
export interface WorkflowLogger {
	debug: (message: string, data?: unknown) => void;
	info: (message: string, data?: unknown) => void;
	warn: (message: string, data?: unknown) => void;
	error: (message: string, data?: unknown) => void;
}

// ============================================================================
// Type Helpers
// ============================================================================

/** Infer the input type from a workflow definition. */
export type InferWorkflowInput<T> =
	T extends WorkflowDefinition<any, infer I, any> ? I : never;

/** Infer the output type from a workflow definition. */
export type InferWorkflowOutput<T> =
	T extends WorkflowDefinition<any, any, infer O> ? O : never;

/** Infer the name from a workflow definition. */
export type InferWorkflowName<T> =
	T extends WorkflowDefinition<infer N, any, any> ? N : never;

// ============================================================================
// Workflow Instance Status
// ============================================================================

/** Possible workflow instance statuses. */
export type WorkflowInstanceStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "suspended"
	| "cancelled"
	| "timed_out";

/** Possible workflow step statuses. */
export type WorkflowStepStatus = "completed" | "sleeping" | "failed";

/** Possible workflow event types. */
export type WorkflowEventType =
	| "triggered"
	| "step_completed"
	| "step_failed"
	| "suspended"
	| "resumed"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed_out";

/** Possible log levels. */
export type WorkflowLogLevel = "debug" | "info" | "warn" | "error";

// ============================================================================
// Trigger Options
// ============================================================================

/**
 * Options for triggering a workflow.
 */
export interface WorkflowTriggerOptions {
	/** Idempotency key — prevents duplicate workflow instances. */
	idempotencyKey?: string;

	/** Delay before starting the workflow (e.g. "5m", "2h"). */
	delay?: string;

	/** Absolute date/time to start the workflow. */
	startAt?: Date;
}
