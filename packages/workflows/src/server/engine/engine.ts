/**
 * Workflow Execution Engine
 *
 * Top-level orchestrator that runs a workflow handler with replay semantics.
 *
 * The engine:
 * 1. Loads the instance and its cached steps
 * 2. Creates a `StepExecutionContext` with the cache
 * 3. Invokes the workflow handler
 * 4. Handles outcomes: completion, suspension, or failure
 * 5. On failure: runs compensations → onFailure handler → persists
 * 6. Flushes logs
 *
 * This module is decoupled from the QUESTPIE collection API — it operates
 * through the `EngineContext` port interface, which is implemented by the
 * wf-execute job.
 */

import type { WorkflowDefinition } from "../workflow/types.js";
import type { CompensationEntry } from "./compensation.js";
import { createCompletedStepsMap, runCompensations } from "./compensation.js";
import { StepSuspendError } from "./errors.js";
import type { EventPersistence, ResumeWaiterFn } from "./events.js";
import type { FlushCallback } from "./logger.js";
import { WorkflowLoggerImpl } from "./logger.js";
import {
	type CachedStep,
	StepExecutionContext,
	type StepPersistence,
	type TriggerChildFn,
} from "./step-context.js";

// ============================================================================
// Types
// ============================================================================

/** Instance data loaded from the database. */
export interface InstanceData {
	id: string;
	name: string;
	status: string;
	input: unknown;
	attempt: number;
}

/**
 * Port interface for engine operations.
 *
 * Implemented by the wf-execute job layer, which bridges these calls
 * to the QUESTPIE collection API for wf_instance, wf_step, wf_log.
 */
export interface EngineContext {
	/** Load the workflow instance by ID. */
	loadInstance(instanceId: string): Promise<InstanceData | null>;

	/** Load all steps for an instance, ordered by creation time. */
	loadSteps(instanceId: string): Promise<CachedStep[]>;

	/** Step persistence operations. */
	persistence: StepPersistence;

	/** Update instance status and metadata. */
	updateInstance(
		instanceId: string,
		update: {
			status: string;
			output?: unknown;
			error?: unknown;
			attempt?: number;
			startedAt?: Date;
			suspendedAt?: Date;
			completedAt?: Date;
		},
	): Promise<void>;

	/** Log flush callback — persists accumulated log entries. */
	flushLogs: FlushCallback;

	/** Optional external logger for dual output. */
	externalLogger?: {
		debug(message: string, data?: Record<string, unknown>): void;
		info(message: string, data?: Record<string, unknown>): void;
		warn(message: string, data?: Record<string, unknown>): void;
		error(message: string, data?: Record<string, unknown>): void;
	};

	/** App context passed to the workflow handler. */
	appContext: Record<string, any>;

	/** Event persistence operations (optional — for event matching). */
	eventPersistence?: EventPersistence;

	/** Resume waiter callback (optional — for event matching). */
	resumeWaiter?: ResumeWaiterFn;

	/** Trigger child workflow callback (optional — for step.invoke). */
	triggerChild?: TriggerChildFn;
}

/** Result of executing a workflow handler. */
export type ExecutionResult =
	| { status: "completed"; output: unknown }
	| { status: "suspended"; stepName: string; resumeAt?: Date }
	| {
			status: "failed";
			error: Error;
			compensationErrors?: Array<{ stepName: string; error: string }>;
	  };

// ============================================================================
// Engine
// ============================================================================

/**
 * Execute a workflow handler with replay semantics.
 *
 * @param definition - The workflow definition to execute
 * @param instanceId - ID of the workflow instance
 * @param engineCtx - Engine context with persistence operations
 * @returns Execution result (completed, suspended, or failed)
 */
export async function executeWorkflowHandler(
	definition: WorkflowDefinition,
	instanceId: string,
	engineCtx: EngineContext,
): Promise<ExecutionResult> {
	// 1. Load instance
	const instance = await engineCtx.loadInstance(instanceId);
	if (!instance) {
		throw new Error(`Workflow instance not found: ${instanceId}`);
	}

	// 2. Load cached steps and build the cache map + execution order
	const stepRecords = await engineCtx.loadSteps(instanceId);
	const cachedSteps = new Map<string, CachedStep>();
	const cachedExecutionOrder: string[] = [];

	for (const step of stepRecords) {
		cachedSteps.set(step.name, step);
		cachedExecutionOrder.push(step.name);
	}

	// 3. Create logger
	const logger = new WorkflowLoggerImpl(instanceId, {
		logLevel: definition.logLevel,
		externalLogger: engineCtx.externalLogger,
		prefix: `[wf:${definition.name}:${instanceId.slice(0, 8)}]`,
	});

	// 4. Create step context
	const stepContext = new StepExecutionContext(
		instanceId,
		cachedSteps,
		cachedExecutionOrder,
		engineCtx.persistence,
		definition.retryPolicy
			? { maxAttempts: definition.retryPolicy.maxAttempts }
			: undefined,
		engineCtx.eventPersistence,
		engineCtx.resumeWaiter,
		engineCtx.triggerChild,
	);

	// 5. Update instance to running
	await engineCtx.updateInstance(instanceId, {
		status: "running",
		startedAt: new Date(),
		attempt: instance.attempt + 1,
	});

	logger.info("Workflow execution started", {
		attempt: instance.attempt + 1,
		cachedSteps: cachedSteps.size,
	});

	// 6. Execute the handler
	let result: ExecutionResult;

	try {
		const output = await definition.handler({
			input: instance.input,
			step: stepContext,
			log: logger,
			ctx: engineCtx.appContext,
		});

		// Success — update to completed
		await engineCtx.updateInstance(instanceId, {
			status: "completed",
			output,
			completedAt: new Date(),
		});

		logger.info("Workflow completed successfully");
		result = { status: "completed", output };
	} catch (error) {
		if (error instanceof StepSuspendError) {
			// Suspension — update to suspended
			await engineCtx.updateInstance(instanceId, {
				status: "suspended",
				suspendedAt: new Date(),
			});

			logger.info(`Workflow suspended at step "${error.stepName}"`, {
				reason: error.reason,
				resumeAt: error.resumeAt?.toISOString(),
			});

			result = {
				status: "suspended",
				stepName: error.stepName,
				resumeAt: error.resumeAt,
			};
		} else {
			// Failure — run compensations, then onFailure, then update status
			const err = error instanceof Error ? error : new Error(String(error));

			logger.error(`Workflow failed: ${err.message}`);

			// Run compensations (reverse LIFO order)
			const compensations =
				stepContext.getCompensations() as CompensationEntry[];
			let compensationErrors:
				| Array<{ stepName: string; error: string }>
				| undefined;

			if (compensations.length > 0) {
				await engineCtx.updateInstance(instanceId, {
					status: "failing",
				});

				const compensationResult = await runCompensations(
					compensations,
					logger,
				);
				if (compensationResult.errors.length > 0) {
					compensationErrors = compensationResult.errors;
				}
			}

			// Run onFailure handler if defined
			if (definition.onFailure) {
				try {
					// Build completed steps map from cached steps
					const completedEntries = Array.from(cachedSteps.entries())
						.filter(([, s]) => s.status === "completed")
						.map(([name, s]) => ({ name, result: s.result }));

					// Also add steps that completed in this execution
					for (const comp of compensations) {
						if (!completedEntries.some((e) => e.name === comp.name)) {
							completedEntries.push({
								name: comp.name,
								result: comp.result,
							});
						}
					}

					const completedSteps = createCompletedStepsMap(completedEntries);

					await definition.onFailure({
						input: instance.input,
						error: err,
						step: stepContext,
						completedSteps,
						log: logger,
						ctx: engineCtx.appContext,
					});

					logger.info("onFailure handler completed");
				} catch (onFailureErr) {
					logger.error(
						`onFailure handler threw: ${onFailureErr instanceof Error ? onFailureErr.message : String(onFailureErr)}`,
					);
				}
			}

			// Persist failure
			const errData = {
				message: err.message,
				stack: err.stack,
				name: err.name,
				...(compensationErrors ? { compensationErrors } : {}),
			};

			await engineCtx.updateInstance(instanceId, {
				status: "failed",
				error: errData,
				completedAt: new Date(),
			});

			result = { status: "failed", error: err, compensationErrors };
		}
	}

	// 7. Flush logs (always, regardless of outcome)
	try {
		await logger.flush(engineCtx.flushLogs);
	} catch (flushErr) {
		// Log flush failure should not mask the execution result
		engineCtx.externalLogger?.error(
			`Failed to flush workflow logs for ${instanceId}`,
			{
				error: flushErr instanceof Error ? flushErr.message : String(flushErr),
			},
		);
	}

	return result;
}
