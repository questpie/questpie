/**
 * Workflow Client
 *
 * Public API for triggering and managing workflow instances.
 *
 * Created by the workflow service factory — available at `ctx.workflows` in
 * handlers, jobs, and functions.
 *
 * @example
 * ```ts
 * // In a function handler:
 * const { instanceId } = await ctx.workflows.trigger("user-onboarding", {
 *   userId: "abc",
 * });
 * ```
 */

import { parseDuration } from "./engine/duration.js";
import type { EventPersistence, ResumeWaiterFn } from "./engine/events.js";
import { dispatchEvent } from "./engine/events.js";
import type {
	WorkflowDefinition,
	WorkflowEventRecord,
	WorkflowInstance,
	WorkflowLogRecord,
	WorkflowStepRecord,
} from "./workflow/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A collection API compatible interface.
 *
 * This abstracts the QUESTPIE collection CRUD so the client doesn't
 * directly depend on the core package types.
 */
export type SystemAccessContext = {
	accessMode: "system";
};

export type WorkflowCollectionDocument = {
	id: string;
} & Record<string, unknown>;

export type CollectionFindResult<TDocument> = {
	docs: TDocument[];
	totalDocs?: number;
	page?: number;
	limit?: number;
};

export interface CollectionCrud<
	TDocument extends { id: string } = WorkflowCollectionDocument,
> {
	create(
		input: Record<string, unknown>,
		context?: SystemAccessContext,
	): Promise<TDocument>;
	findOne(
		options?: Record<string, unknown>,
		context?: SystemAccessContext,
	): Promise<TDocument | null>;
	find(
		options?: Record<string, unknown>,
		context?: SystemAccessContext,
	): Promise<CollectionFindResult<TDocument>>;
	count?(
		options?: Record<string, unknown>,
		context?: SystemAccessContext,
	): Promise<number | { totalDocs: number }>;
	updateById(
		params: { id: string; data: Record<string, unknown> },
		context?: SystemAccessContext,
	): Promise<TDocument>;
	deleteById?(
		params: { id: string },
		context?: SystemAccessContext,
	): Promise<TDocument>;
}

/**
 * Queue publish interface — matches the QUESTPIE QueueClient per-job API.
 */
export type QueuePublishOptions = {
	priority?: number;
	startAfter?: number | string | Date;
};

export interface QueuePublish {
	publish(
		payload: Record<string, unknown>,
		options?: QueuePublishOptions,
	): Promise<unknown>;
}

export type WorkflowSystemCollections = {
	wf_instance: CollectionCrud<WorkflowInstance>;
	wf_step: CollectionCrud<WorkflowStepRecord>;
	wf_event: CollectionCrud<WorkflowEventRecord>;
	wf_log: CollectionCrud<WorkflowLogRecord>;
};

/**
 * Dependencies injected into the workflow client.
 */
export interface WorkflowClientDeps {
	/** wf_instance collection CRUD. */
	instances: CollectionCrud<WorkflowInstance>;
	/** wf_step collection CRUD. */
	steps: CollectionCrud<WorkflowStepRecord>;
	/** wf_event collection CRUD. */
	events: CollectionCrud<WorkflowEventRecord>;
	/** Queue publish for the execute job. */
	publishExecute: QueuePublish;
	/** Queue publish for the resume job. */
	publishResume?: QueuePublish;
}

/**
 * Result from triggering a workflow.
 */
export interface TriggerResult {
	/** ID of the created workflow instance. */
	instanceId: string;
	/** Whether an existing instance was returned (idempotency). */
	existing: boolean;
}

/**
 * Typed workflow client — available at `ctx.workflows`.
 *
 * @template TWorkflows - Record of workflow name → definition
 */
export interface WorkflowClient<
	TWorkflows extends Record<string, WorkflowDefinition> = Record<
		string,
		WorkflowDefinition
	>,
> {
	/**
	 * Trigger a new workflow instance.
	 */
	trigger<K extends keyof TWorkflows & string>(
		name: K,
		input: TWorkflows[K] extends WorkflowDefinition<infer I, unknown, string>
			? I
			: unknown,
		options?: {
			idempotencyKey?: string;
			delay?: string;
			startAt?: Date;
			parentInstanceId?: string;
			parentStepName?: string;
		},
	): Promise<TriggerResult>;

	/**
	 * Cancel a running or suspended workflow instance.
	 * Uses CAS (Compare-And-Swap) — only cancels if currently active.
	 */
	cancel(instanceId: string): Promise<{ success: boolean }>;

	/**
	 * Get a workflow instance by ID.
	 */
	getInstance(instanceId: string): Promise<WorkflowInstance | null>;

	/**
	 * Get step history for a workflow instance.
	 */
	getHistory(instanceId: string): Promise<WorkflowStepRecord[]>;

	/**
	 * Send an event to be matched against waiting workflows.
	 */
	sendEvent(
		event: string,
		data?: unknown,
		match?: Record<string, unknown>,
	): Promise<void>;

	/**
	 * Cancel all active instances of a given workflow name.
	 * Returns the number of instances cancelled.
	 */
	cancelAll(workflowName: string): Promise<{ cancelledCount: number }>;

	/**
	 * Retry all failed/timed_out instances of a given workflow name.
	 * Returns the number of instances re-queued.
	 */
	retryAll(workflowName: string): Promise<{ retriedCount: number }>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a WorkflowClient backed by collection CRUD and queue operations.
 *
 * @param definitions - All registered workflow definitions
 * @param deps - Collection CRUD and queue publish interfaces
 */
export function createWorkflowClient<
	TWorkflows extends Record<string, WorkflowDefinition>,
>(
	definitions: TWorkflows,
	deps: WorkflowClientDeps,
): WorkflowClient<TWorkflows> {
	return {
		async trigger(name, input, options) {
			const def = definitions[name];
			if (!def) {
				throw new Error(`Unknown workflow: "${name}"`);
			}

			// Validate input against schema
			const validated = def.schema.parse(input);

			// Check idempotency
			if (options?.idempotencyKey) {
				const existing = await deps.instances.findOne(
					{
						where: {
							name,
							idempotencyKey: options.idempotencyKey,
						},
					},
					{ accessMode: "system" },
				);
				if (existing) {
					return { instanceId: existing.id, existing: true };
				}
			}

			// Calculate timeout
			let timeoutAt: Date | undefined;
			if (def.timeout) {
				timeoutAt = new Date(Date.now() + parseDuration(def.timeout));
			}

			// Calculate start delay
			let startAfter: Date | undefined;
			if (options?.startAt) {
				startAfter = options.startAt;
			} else if (options?.delay) {
				startAfter = new Date(Date.now() + parseDuration(options.delay));
			}

			// Create instance
			const instance = await deps.instances.create(
				{
					name,
					status: "pending",
					input: validated,
					output: null,
					error: null,
					attempt: 0,
					parentInstanceId: options?.parentInstanceId ?? null,
					parentStepName: options?.parentStepName ?? null,
					idempotencyKey: options?.idempotencyKey ?? null,
					timeoutAt: timeoutAt ?? null,
					startedAt: null,
					suspendedAt: null,
					completedAt: null,
				},
				{ accessMode: "system" },
			);

			// Publish execute job
			await deps.publishExecute.publish(
				{ instanceId: instance.id, workflowName: name },
				startAfter ? { startAfter } : undefined,
			);

			return { instanceId: instance.id, existing: false };
		},

		async cancel(instanceId) {
			const instance = await deps.instances.findOne(
				{ where: { id: instanceId } },
				{ accessMode: "system" },
			);

			if (!instance) {
				return { success: false };
			}

			// CAS: only cancel if currently active
			const activeStatuses = ["pending", "running", "suspended"];
			if (!activeStatuses.includes(instance.status)) {
				return { success: false };
			}

			await deps.instances.updateById(
				{
					id: instanceId,
					data: {
						status: "cancelled",
						completedAt: new Date(),
					},
				},
				{ accessMode: "system" },
			);

			return { success: true };
		},

		async getInstance(instanceId) {
			return deps.instances.findOne(
				{ where: { id: instanceId } },
				{ accessMode: "system" },
			);
		},

		async getHistory(instanceId) {
			const result = await deps.steps.find(
				{
					where: { instanceId },
					sort: { createdAt: "asc" },
					limit: 1000,
				},
				{ accessMode: "system" },
			);
			return result.docs;
		},

		async cancelAll(workflowName) {
			const activeStatuses = ["pending", "running", "suspended"];
			const result = await deps.instances.find(
				{
					where: {
						name: workflowName,
						status: { in: activeStatuses },
					},
					limit: 1000,
				},
				{ accessMode: "system" },
			);

			let cancelledCount = 0;
			const now = new Date();
			for (const instance of result.docs) {
				try {
					await deps.instances.updateById(
						{
							id: instance.id,
							data: {
								status: "cancelled",
								completedAt: now,
							},
						},
						{ accessMode: "system" },
					);
					cancelledCount++;
				} catch {
					// Best-effort — skip on error
				}
			}

			return { cancelledCount };
		},

		async retryAll(workflowName) {
			const result = await deps.instances.find(
				{
					where: {
						name: workflowName,
						status: { in: ["failed", "timed_out"] },
					},
					limit: 1000,
				},
				{ accessMode: "system" },
			);

			let retriedCount = 0;
			for (const instance of result.docs) {
				try {
					await deps.instances.updateById(
						{
							id: instance.id,
							data: {
								status: "pending",
								error: null,
								completedAt: null,
							},
						},
						{ accessMode: "system" },
					);

					await deps.publishExecute.publish({
						instanceId: instance.id,
						workflowName: instance.name,
					});

					retriedCount++;
				} catch {
					// Best-effort — skip on error
				}
			}

			return { retriedCount };
		},

		async sendEvent(event, data, match) {
			// Build EventPersistence from collection CRUD
			const eventPersistence: EventPersistence = {
				async createEvent(ev) {
					const created = await deps.events.create(
						{
							eventName: ev.eventName,
							data: ev.data ?? null,
							matchCriteria: ev.matchCriteria ?? null,
							sourceType: ev.sourceType,
							sourceInstanceId: ev.sourceInstanceId ?? null,
							sourceStepName: ev.sourceStepName ?? null,
							consumedCount: 0,
						},
						{ accessMode: "system" },
					);
					return { id: created.id };
				},
				async findMatchingEvent() {
					// Not needed for sendEvent dispatch
					return null;
				},
				async findWaitingSteps(eventName, _matchData) {
					const result = await deps.steps.find(
						{
							where: {
								type: "waitForEvent",
								status: "waiting",
								eventName,
							},
							limit: 1000,
						},
						{ accessMode: "system" },
					);
					return result.docs.map((s) => ({
						instanceId: s.instanceId,
						stepName: s.name,
						matchCriteria:
							typeof s.matchCriteria === "object" &&
							s.matchCriteria !== null &&
							!Array.isArray(s.matchCriteria)
								? (s.matchCriteria as Record<string, unknown>)
								: null,
					}));
				},
				async markEventConsumed(eventId) {
					// Increment consumed count — best-effort
					const ev = await deps.events.findOne(
						{ where: { id: eventId } },
						{ accessMode: "system" },
					);
					if (ev) {
						await deps.events.updateById(
							{
								id: eventId,
								data: { consumedCount: (ev.consumedCount ?? 0) + 1 },
							},
							{ accessMode: "system" },
						);
					}
				},
			};

			// Build resume callback
			const resumeWaiter: ResumeWaiterFn = async (
				instanceId,
				stepName,
				result,
			) => {
				if (deps.publishResume) {
					await deps.publishResume.publish({
						instanceId,
						stepName,
						result,
					});
				}
			};

			await dispatchEvent(
				{
					name: event,
					data,
					match,
					sourceType: "external",
				},
				eventPersistence,
				resumeWaiter,
			);
		},
	};
}
