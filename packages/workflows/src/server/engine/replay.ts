import {
	type WorkflowDefinition,
	type WorkflowHandlerContext,
	type WorkflowInstanceStatus,
	extractAppServices,
} from "questpie";
import { StepSuspendError } from "./errors.js";
import { createWorkflowLogger } from "./logger.js";
import { type CachedStep, createStepToolbox } from "./step-toolbox.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal app interface used by the replay engine.
 * Avoids direct dependency on the full Questpie class.
 */
interface AppLike {
	api: {
		collections: Record<string, any>;
	};
	queue: Record<string, any>;
	logger: any;
	db: any;
	state?: Record<string, unknown>;
	extensions: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_SECONDS = 86_400; // 24 hours
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY = 60; // seconds
const DEFAULT_RETRY_BACKOFF = true;

// ============================================================================
// executeWorkflow — main replay entry point
// ============================================================================

/**
 * Execute (or replay) a workflow instance.
 *
 * 1. Loads the instance and validates its status.
 * 2. Loads completed steps from `wf_step`.
 * 3. Creates a StepToolbox with the step cache.
 * 4. Calls the workflow handler.
 * 5. Handles completion, suspension (sleep), or failure.
 *
 * Called by the `wf-execute` job.
 */
export async function executeWorkflow(
	instanceId: string,
	app: AppLike,
): Promise<void> {
	const collections = app.api.collections;
	const log = createWorkflowLogger(instanceId, app);

	// 1. Load instance
	const instance = await collections.wf_instance.findOne(
		{ where: { id: { eq: instanceId } } },
		{ accessMode: "system" },
	);

	if (!instance) {
		log.error(`Instance "${instanceId}" not found`);
		return;
	}

	// 2. Validate status — only pending or running instances can be executed
	const validStatuses: WorkflowInstanceStatus[] = ["pending", "running"];
	if (!validStatuses.includes(instance.status)) {
		log.warn(
			`Instance "${instanceId}" has status "${instance.status}", skipping execution`,
		);
		return;
	}

	// 3. CAS update: mark as running
	await collections.wf_instance.updateById(
		{
			id: instanceId,
			data: { status: "running" },
		},
		{ accessMode: "system" },
	);

	// 4. Look up the workflow definition
	const workflowDefs =
		(app.state?.workflows as Record<string, WorkflowDefinition>) ?? {};
	const workflowDef = Object.values(workflowDefs).find(
		(def) => def.name === instance.workflowName,
	);

	if (!workflowDef) {
		log.error(
			`Workflow definition "${instance.workflowName}" not found in registry`,
		);
		await failInstance(collections, instanceId, log, {
			error: `Workflow definition "${instance.workflowName}" not found`,
			attempt: instance.attempt,
		});
		return;
	}

	// 5. Load completed steps for replay cache
	const completedSteps = await loadCompletedSteps(collections, instanceId);

	// 6. Create step toolbox with cache + persistence callbacks
	const persistStep = async (step: any) => {
		await collections.wf_step.create(step, { accessMode: "system" });
	};
	const recordEvent = async (event: any) => {
		await collections.wf_event.create(event, { accessMode: "system" });
	};

	const stepToolbox = createStepToolbox(
		instanceId,
		completedSteps,
		persistStep,
		recordEvent,
		log,
	);

	// 7. Build handler context
	const appServices = extractAppServices(app as any, {
		db: app.db,
	});

	const handlerCtx: WorkflowHandlerContext = {
		...appServices,
		input: instance.input,
		step: stepToolbox,
		instanceId,
		attempt: instance.attempt ?? 1,
		log,
	} as WorkflowHandlerContext;

	// 8. Execute the handler
	try {
		const output = await workflowDef.handler(handlerCtx);

		// Success — mark completed
		await collections.wf_instance.updateById(
			{
				id: instanceId,
				data: {
					status: "completed" as const,
					output,
					completedAt: new Date(),
				},
			},
			{ accessMode: "system" },
		);
		await recordEvent({
			instanceId,
			type: "completed",
			data: { output },
		});
		log.info("Workflow completed successfully");
	} catch (error) {
		if (error instanceof StepSuspendError) {
			// Suspend — workflow is sleeping
			await collections.wf_instance.updateById(
				{
					id: instanceId,
					data: {
						status: "suspended" as const,
						suspendedUntil: error.sleepUntil,
					},
				},
				{ accessMode: "system" },
			);
			await recordEvent({
				instanceId,
				type: "suspended",
				stepName: error.stepName,
				data: { sleepUntil: error.sleepUntil.toISOString() },
			});

			// Schedule resume job
			await publishResumeJob(app, instanceId, error.sleepUntil);
			log.info(
				`Workflow suspended at step "${error.stepName}" until ${error.sleepUntil.toISOString()}`,
			);
		} else {
			// Real error — apply retry logic
			await handleFailure(
				collections,
				app,
				instanceId,
				instance,
				workflowDef,
				error,
				log,
			);
		}
	}
}

// ============================================================================
// resumeWorkflow — resume after sleep
// ============================================================================

/**
 * Resume a suspended workflow after a sleep step completes.
 *
 * 1. Validates the instance is in "suspended" state.
 * 2. Marks the sleeping step as "completed".
 * 3. Re-executes the workflow (replay engine skips completed steps).
 *
 * Called by the `wf-resume` job.
 */
export async function resumeWorkflow(
	instanceId: string,
	app: AppLike,
): Promise<void> {
	const collections = app.api.collections;
	const log = createWorkflowLogger(instanceId, app);

	// 1. Load and validate instance
	const instance = await collections.wf_instance.findOne(
		{ where: { id: { eq: instanceId } } },
		{ accessMode: "system" },
	);

	if (!instance) {
		log.error(`Instance "${instanceId}" not found for resume`);
		return;
	}

	if (instance.status !== "suspended") {
		log.warn(
			`Instance "${instanceId}" has status "${instance.status}", expected "suspended"`,
		);
		return;
	}

	// 2. Find and complete the sleeping step
	const sleepingSteps = await collections.wf_step.find(
		{
			where: {
				instanceId: { eq: instanceId },
				status: { eq: "sleeping" },
			},
		},
		{ accessMode: "system" },
	);

	for (const step of sleepingSteps.docs) {
		await collections.wf_step.updateById(
			{
				id: step.id,
				data: {
					status: "completed",
					completedAt: new Date(),
				},
			},
			{ accessMode: "system" },
		);
	}

	// 3. Record resume event
	await collections.wf_event.create(
		{
			instanceId,
			type: "resumed",
		},
		{ accessMode: "system" },
	);

	log.info("Workflow resuming after sleep");

	// 4. Mark as running and re-execute
	await collections.wf_instance.updateById(
		{
			id: instanceId,
			data: {
				status: "running" as const,
				suspendedUntil: null,
			},
		},
		{ accessMode: "system" },
	);

	await executeWorkflow(instanceId, app);
}

// ============================================================================
// runMaintenance — periodic cleanup and recovery
// ============================================================================

/**
 * Run maintenance tasks.
 *
 * Called by the `wf-maintenance` cron job (every 5 minutes).
 *
 * Tasks:
 * 1. Timeout detection: running instances past their deadline.
 * 2. Stuck resume recovery: suspended instances past their resume time.
 * 3. Retention cleanup: delete old step/event/log data.
 */
export async function runMaintenance(app: AppLike): Promise<void> {
	const collections = app.api.collections;
	const log = createWorkflowLogger("maintenance", app);

	const now = new Date();

	// 1. Timeout detection
	const timedOut = await collections.wf_instance.find(
		{
			where: {
				status: { eq: "running" },
				timeoutAt: { lt: now },
			},
		},
		{ accessMode: "system" },
	);

	for (const instance of timedOut.docs) {
		await collections.wf_instance.updateById(
			{
				id: instance.id,
				data: {
					status: "timed_out",
					completedAt: now,
					error: `Workflow timed out after ${instance.timeoutAt ? Math.round((instance.timeoutAt.getTime() - instance.createdAt.getTime()) / 1000) : "?"}s`,
				},
			},
			{ accessMode: "system" },
		);
		await collections.wf_event.create(
			{
				instanceId: instance.id,
				type: "timed_out",
			},
			{ accessMode: "system" },
		);
		log.info(`Instance "${instance.id}" timed out`);
	}

	// 2. Stuck resume recovery (suspended past resume time + 60s grace)
	const graceTime = new Date(now.getTime() - 60_000);
	const stuckSuspended = await collections.wf_instance.find(
		{
			where: {
				status: { eq: "suspended" },
				suspendedUntil: { lt: graceTime },
			},
		},
		{ accessMode: "system" },
	);

	for (const instance of stuckSuspended.docs) {
		log.warn(
			`Instance "${instance.id}" stuck in suspended state, re-publishing resume`,
		);
		await publishResumeJob(app, instance.id);
	}

	if (timedOut.docs.length > 0 || stuckSuspended.docs.length > 0) {
		log.info(
			`Maintenance: ${timedOut.docs.length} timed out, ${stuckSuspended.docs.length} stuck resumed`,
		);
	}
}

// ============================================================================
// Helpers
// ============================================================================

/** Load completed steps from wf_step for replay cache. */
async function loadCompletedSteps(
	collections: Record<string, any>,
	instanceId: string,
): Promise<CachedStep[]> {
	const result = await collections.wf_step.find(
		{
			where: { instanceId: { eq: instanceId } },
			orderBy: { stepIndex: "asc" },
			limit: 1000,
		},
		{ accessMode: "system" },
	);

	return result.docs.map((step: any) => ({
		stepName: step.stepName,
		stepIndex: step.stepIndex,
		status: step.status,
		result: step.result,
	}));
}

/** Handle workflow handler failure with retry logic. */
async function handleFailure(
	collections: Record<string, any>,
	app: AppLike,
	instanceId: string,
	instance: any,
	workflowDef: WorkflowDefinition,
	error: unknown,
	log: ReturnType<typeof createWorkflowLogger>,
): Promise<void> {
	const errorMsg = error instanceof Error ? error.message : String(error);
	const attempt = instance.attempt ?? 1;
	const maxAttempts =
		workflowDef.options?.retryLimit ?? DEFAULT_RETRY_LIMIT;
	const retryDelay = workflowDef.options?.retryDelay ?? DEFAULT_RETRY_DELAY;
	const retryBackoff =
		workflowDef.options?.retryBackoff ?? DEFAULT_RETRY_BACKOFF;

	if (attempt < maxAttempts) {
		// Retry — compute backoff delay
		const delaySeconds = retryBackoff
			? retryDelay * 2 ** (attempt - 1)
			: retryDelay;
		const retryAt = new Date(Date.now() + delaySeconds * 1000);

		await collections.wf_instance.updateById(
			{
				id: instanceId,
				data: {
					status: "pending" as const,
					attempt: attempt + 1,
					error: errorMsg,
				},
			},
			{ accessMode: "system" },
		);
		await collections.wf_event.create(
			{
				instanceId,
				type: "failed",
				data: {
					error: errorMsg,
					attempt,
					retryAt: retryAt.toISOString(),
				},
			},
			{ accessMode: "system" },
		);

		// Schedule retry
		await publishExecuteJob(app, instanceId, retryAt);
		log.warn(
			`Attempt ${attempt}/${maxAttempts} failed: ${errorMsg}. Retrying at ${retryAt.toISOString()}`,
		);
	} else {
		// Exhausted retries — mark as permanently failed
		await failInstance(collections, instanceId, log, {
			error: errorMsg,
			attempt,
		});
	}
}

/** Mark an instance as permanently failed. */
async function failInstance(
	collections: Record<string, any>,
	instanceId: string,
	log: ReturnType<typeof createWorkflowLogger>,
	opts: { error: string; attempt: number },
): Promise<void> {
	await collections.wf_instance.updateById(
		{
			id: instanceId,
			data: {
				status: "failed" as const,
				error: opts.error,
				completedAt: new Date(),
			},
		},
		{ accessMode: "system" },
	);
	await collections.wf_event.create(
		{
			instanceId,
			type: "failed",
			data: { error: opts.error, attempt: opts.attempt, final: true },
		},
		{ accessMode: "system" },
	);
	log.error(`Workflow failed permanently: ${opts.error}`);
}

/** Publish the wf-execute job via the queue. */
async function publishExecuteJob(
	app: AppLike,
	instanceId: string,
	startAfter?: Date,
): Promise<void> {
	const jobClient = getJobClient(app, "wf-execute");
	await jobClient.publish(
		{ instanceId },
		{
			singletonKey: `wf-exec-${instanceId}`,
			...(startAfter ? { startAfter } : {}),
		},
	);
}

/** Publish the wf-resume job via the queue. */
async function publishResumeJob(
	app: AppLike,
	instanceId: string,
	startAfter?: Date,
): Promise<void> {
	const jobClient = getJobClient(app, "wf-resume");
	await jobClient.publish(
		{ instanceId },
		{
			singletonKey: `wf-resume-${instanceId}`,
			...(startAfter ? { startAfter } : {}),
		},
	);
}

/**
 * Get a job client from the queue by registration key.
 * The key matches the module definition: `jobs: { "wf-execute": ... }`.
 */
function getJobClient(
	app: AppLike,
	key: string,
): { publish: (payload: any, opts?: any) => Promise<any> } {
	const queue = app.queue as Record<string, any>;
	const client = queue[key];

	if (!client?.publish) {
		throw new Error(
			`Cannot publish ${key} job: job not found in queue. ` +
				"Ensure the workflowsModule is included in your modules.",
		);
	}

	return client;
}
