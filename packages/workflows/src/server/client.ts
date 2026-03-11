import type {
	WorkflowDefinition,
	WorkflowTriggerOptions,
} from "questpie";
import { durationFromNow } from "./engine/duration.js";
import { createWorkflowLogger } from "./engine/logger.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Typed client for a single workflow.
 * Provides trigger, getInstance, getHistory, and cancel operations.
 */
export interface WorkflowHandle<TInput = any> {
	/** Start a new workflow instance. Returns the instance ID. */
	trigger: (input: TInput, opts?: WorkflowTriggerOptions) => Promise<string>;

	/** Get the current state of a workflow instance. */
	getInstance: (instanceId: string) => Promise<any | null>;

	/** Get the event history for a workflow instance. */
	getHistory: (instanceId: string) => Promise<any[]>;

	/** Cancel a running or suspended workflow instance. */
	cancel: (instanceId: string) => Promise<void>;
}

/**
 * Full workflow client — a map of workflow name → WorkflowHandle.
 */
export type WorkflowClient<
	TDefs extends Record<string, WorkflowDefinition> = Record<
		string,
		WorkflowDefinition
	>,
> = {
	[K in keyof TDefs]: TDefs[K] extends WorkflowDefinition<any, infer TInput>
		? WorkflowHandle<TInput>
		: never;
} & {
	/** Send an event to match waiting workflows (Phase 2). */
	sendEvent?: (type: string, data?: unknown) => Promise<void>;
};

// ============================================================================
// App-like interface (same as replay engine)
// ============================================================================

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
// createWorkflowClient
// ============================================================================

/**
 * Create a typed workflow client from registered workflow definitions.
 *
 * The client provides `trigger()`, `getInstance()`, `getHistory()`,
 * and `cancel()` for each registered workflow.
 *
 * @param workflowDefs - Map of registration key → workflow definition
 * @param app - App-like instance (Questpie or minimal interface)
 */
export function createWorkflowClient(
	workflowDefs: Record<string, WorkflowDefinition>,
	app: AppLike,
): WorkflowClient {
	const client: Record<string, WorkflowHandle> = {};

	for (const [key, def] of Object.entries(workflowDefs)) {
		client[key] = createHandle(def, app);
	}

	return client as WorkflowClient;
}

// ============================================================================
// Handle factory
// ============================================================================

function createHandle(
	def: WorkflowDefinition,
	app: AppLike,
): WorkflowHandle {
	const collections = () => app.api.collections;
	const DEFAULT_TIMEOUT_SECONDS = 86_400;

	return {
		async trigger(input, opts) {
			const col = collections();
			const log = createWorkflowLogger("trigger", app);

			// 1. Validate input
			const validated = def.schema.parse(input);

			// 2. Idempotency check
			if (opts?.idempotencyKey) {
				const existing = await col.wf_instance.findOne(
					{
						where: {
							idempotencyKey: { eq: opts.idempotencyKey },
							workflowName: { eq: def.name },
							status: {
								in: [
									"pending",
									"running",
									"suspended",
								],
							},
						},
					},
					{ accessMode: "system" },
				);

				if (existing) {
					log.info(
						`Idempotent hit: returning existing instance "${existing.id}" for key "${opts.idempotencyKey}"`,
					);
					return existing.id;
				}
			}

			// 3. Compute start time
			let startAfter: Date | null = null;
			if (opts?.startAt) {
				startAfter = opts.startAt;
			} else if (opts?.delay) {
				startAfter = durationFromNow(opts.delay);
			}

			// 4. Compute timeout
			const timeoutSeconds =
				def.options?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
			const baseTime = startAfter ?? new Date();
			const timeoutAt = new Date(
				baseTime.getTime() + timeoutSeconds * 1000,
			);

			// 5. Create instance
			const instance = await col.wf_instance.create(
				{
					workflowName: def.name,
					status: "pending",
					input: validated,
					attempt: 1,
					maxAttempts: def.options?.retryLimit ?? 3,
					timeoutAt,
					idempotencyKey: opts?.idempotencyKey ?? null,
					startAfter,
				},
				{ accessMode: "system" },
			);

			// 6. Record triggered event
			await col.wf_event.create(
				{
					instanceId: instance.id,
					type: "triggered",
					data: { input: validated },
				},
				{ accessMode: "system" },
			);

			// 7. Publish execution job
			const queue = app.queue as Record<string, any>;
			const jobClient = queue["wf-execute"];
			if (!jobClient?.publish) {
				throw new Error(
					"Cannot publish wf-execute job: job not found in queue. " +
						"Ensure the workflowsModule is included in your modules.",
				);
			}

			await jobClient.publish(
				{ instanceId: instance.id },
				{
					singletonKey: `wf-exec-${instance.id}`,
					...(startAfter ? { startAfter } : {}),
				},
			);

			log.info(
				`Workflow "${def.name}" triggered as instance "${instance.id}"${startAfter ? ` (delayed until ${startAfter.toISOString()})` : ""}`,
			);

			return instance.id;
		},

		async getInstance(instanceId) {
			return collections().wf_instance.findOne(
				{ where: { id: { eq: instanceId } } },
				{ accessMode: "system" },
			);
		},

		async getHistory(instanceId) {
			const result = await collections().wf_event.find(
				{
					where: { instanceId: { eq: instanceId } },
					orderBy: { createdAt: "asc" },
					limit: 1000,
				},
				{ accessMode: "system" },
			);
			return result.docs;
		},

		async cancel(instanceId) {
			const col = collections();
			const log = createWorkflowLogger(instanceId, app);

			const instance = await col.wf_instance.findOne(
				{ where: { id: { eq: instanceId } } },
				{ accessMode: "system" },
			);

			if (!instance) {
				throw new Error(`Workflow instance "${instanceId}" not found`);
			}

			const cancellable = ["pending", "running", "suspended"];
			if (!cancellable.includes(instance.status)) {
				throw new Error(
					`Cannot cancel instance "${instanceId}" with status "${instance.status}"`,
				);
			}

			await col.wf_instance.updateById(
				{
					id: instanceId,
					data: {
						status: "cancelled",
						completedAt: new Date(),
					},
				},
				{ accessMode: "system" },
			);

			await col.wf_event.create(
				{
					instanceId,
					type: "cancelled",
				},
				{ accessMode: "system" },
			);

			log.info("Workflow cancelled");
		},
	};
}
