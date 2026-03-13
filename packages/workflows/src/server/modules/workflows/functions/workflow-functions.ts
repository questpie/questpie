/**
 * Workflow API Functions
 *
 * RPC functions for managing workflow instances, definitions, and events.
 * Registered in the module definition, accessible at /api/rpc/workflows/*.
 */

import { fn } from "questpie";
import { z } from "zod";
import type { CollectionCrud } from "../../../client.js";

// ── Helpers ────────────────────────────────────────────────

function getCollections(ctx: any) {
	const collections = ctx.collections as
		| Record<string, CollectionCrud>
		| undefined;
	const instances = collections?.wf_instance;
	const steps = collections?.wf_step;
	const events = collections?.wf_event;
	const logs = collections?.wf_log;

	if (!instances || !steps || !events || !logs) {
		throw new Error(
			"Workflow system collections not found. Is workflowsModule registered?",
		);
	}

	return { instances, steps, events, logs };
}

// ── Functions ──────────────────────────────────────────────

/**
 * List workflow instances with filters and pagination.
 */
const listInstances = fn({
	type: "query",
	schema: z.object({
		status: z.string().optional(),
		name: z.string().optional(),
		limit: z.number().min(1).max(250).default(50),
		page: z.number().min(1).default(1),
	}),
	handler: async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);

		const where: Record<string, any> = {};
		if (input.status) where.status = input.status;
		if (input.name) where.name = input.name;

		const result = await instances.find(
			{
				where,
				sort: { createdAt: "desc" },
				limit: input.limit,
				page: input.page,
			},
			{ accessMode: "system" },
		);

		return {
			docs: result.docs,
			totalDocs: (result as any).totalDocs ?? result.docs.length,
			page: input.page,
			limit: input.limit,
		};
	},
});

/**
 * Get a workflow instance with its steps and logs.
 */
const getInstance = fn({
	type: "query",
	schema: z.object({
		id: z.string(),
		includeSteps: z.boolean().default(true),
		includeLogs: z.boolean().default(false),
	}),
	handler: async ({ input, ...ctx }) => {
		const { instances, steps, logs } = getCollections(ctx);

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		let stepDocs: any[] = [];
		if (input.includeSteps) {
			const stepResult = await steps.find(
				{
					where: { instanceId: input.id },
					sort: { createdAt: "asc" },
					limit: 10_000,
				},
				{ accessMode: "system" },
			);
			stepDocs = stepResult.docs;
		}

		let logDocs: any[] = [];
		if (input.includeLogs) {
			const logResult = await logs.find(
				{
					where: { instanceId: input.id },
					sort: { createdAt: "asc" },
					limit: 10_000,
				},
				{ accessMode: "system" },
			);
			logDocs = logResult.docs;
		}

		return {
			instance,
			steps: stepDocs,
			logs: logDocs,
		};
	},
});

/**
 * Cancel a running or suspended workflow instance.
 */
const cancelInstance = fn({
	type: "mutation",
	schema: z.object({
		id: z.string(),
	}),
	handler: async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		const activeStatuses = ["pending", "running", "suspended"];
		if (!activeStatuses.includes(instance.status)) {
			return { success: false, reason: `Instance is ${instance.status}` };
		}

		await instances.updateById(
			{
				id: input.id,
				data: {
					status: "cancelled",
					completedAt: new Date(),
				},
			},
			{ accessMode: "system" },
		);

		return { success: true };
	},
});

/**
 * Retry a failed workflow instance by resetting and re-queuing.
 */
const retryInstance = fn({
	type: "mutation",
	schema: z.object({
		id: z.string(),
	}),
	handler: async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);
		const queue = (ctx as any).queue as any;

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		if (instance.status !== "failed" && instance.status !== "timed_out") {
			return {
				success: false,
				reason: `Can only retry failed/timed_out instances, current: ${instance.status}`,
			};
		}

		// Reset to pending
		await instances.updateById(
			{
				id: input.id,
				data: {
					status: "pending",
					error: null,
					completedAt: null,
				},
			},
			{ accessMode: "system" },
		);

		// Re-queue execution
		await queue["questpie-wf-execute"].publish({
			instanceId: input.id,
			workflowName: instance.name,
		});

		return { success: true };
	},
});

/**
 * List registered workflow definitions.
 */
const listDefinitions = fn({
	type: "query",
	schema: z.object({}),
	handler: async ({ ...ctx }) => {
		const app = (ctx as any).app as any;
		const workflows = (app?.state?.workflows ?? {}) as Record<string, any>;

		return {
			definitions: Object.entries(workflows).map(
				([name, def]: [string, any]) => ({
					name,
					timeout: def.timeout ?? null,
					cron: def.cron ?? null,
					hasOnFailure: !!def.onFailure,
					logLevel: def.logLevel ?? "info",
				}),
			),
		};
	},
});

/**
 * Trigger a new workflow instance.
 */
const triggerWorkflow = fn({
	type: "mutation",
	schema: z.object({
		name: z.string(),
		input: z.unknown().default({}),
		idempotencyKey: z.string().optional(),
	}),
	handler: async ({ input, ...ctx }) => {
		const app = (ctx as any).app as any;
		const workflows = (app?.state?.workflows ?? {}) as Record<string, any>;
		const definition = workflows[input.name];

		if (!definition) {
			throw new Error(`Unknown workflow: "${input.name}"`);
		}

		const { instances } = getCollections(ctx);
		const queue = (ctx as any).queue as any;

		// Validate workflow input against schema
		const validated = definition.schema.parse(input.input);

		// Check idempotency
		if (input.idempotencyKey) {
			const existing = await instances.findOne(
				{
					where: {
						name: input.name,
						idempotencyKey: input.idempotencyKey,
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
		if (definition.timeout) {
			const { parseDuration } = await import("../../../engine/duration.js");
			timeoutAt = new Date(Date.now() + parseDuration(definition.timeout));
		}

		// Create instance
		const instance = await instances.create(
			{
				name: input.name,
				status: "pending",
				input: validated,
				output: null,
				error: null,
				attempt: 0,
				parentInstanceId: null,
				parentStepName: null,
				idempotencyKey: input.idempotencyKey ?? null,
				timeoutAt: timeoutAt ?? null,
				startedAt: null,
				suspendedAt: null,
				completedAt: null,
			},
			{ accessMode: "system" },
		);

		// Queue execution
		await queue["questpie-wf-execute"].publish({
			instanceId: instance.id,
			workflowName: input.name,
		});

		return { instanceId: instance.id, existing: false };
	},
});

/**
 * Send an event to match against waiting workflows.
 */
const sendEvent = fn({
	type: "mutation",
	schema: z.object({
		event: z.string(),
		data: z.unknown().optional(),
		match: z.record(z.string(), z.unknown()).optional(),
	}),
	handler: async ({ input, ...ctx }) => {
		const { events, steps } = getCollections(ctx);
		const queue = (ctx as any).queue as any;

		const { dispatchEvent } = await import("../../../engine/events.js");

		// Build event persistence from collections
		const eventPersistence = {
			async createEvent(ev: any) {
				const created = await events.create(
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
				return null; // Not needed for forward dispatch
			},
			async findWaitingSteps(eventName: string) {
				const result = await steps.find(
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
				return result.docs.map((s: any) => ({
					instanceId: s.instanceId,
					stepName: s.name,
					matchCriteria: s.matchCriteria,
				}));
			},
			async markEventConsumed() {
				// Not needed for forward dispatch
			},
		};

		const result = await dispatchEvent(
			{
				name: input.event,
				data: input.data,
				match: input.match,
				sourceType: "external",
			},
			eventPersistence,
			async (instanceId, stepName, eventResult) => {
				await queue["questpie-wf-resume"].publish({
					instanceId,
					stepName,
					result: eventResult,
				});
			},
		);

		return { matchedCount: result.matchedCount };
	},
});

// ── Exports ────────────────────────────────────────────────

export const workflowFunctions = {
	listWorkflowInstances: listInstances,
	getWorkflowInstance: getInstance,
	cancelWorkflowInstance: cancelInstance,
	retryWorkflowInstance: retryInstance,
	listWorkflowDefinitions: listDefinitions,
	triggerWorkflow,
	sendWorkflowEvent: sendEvent,
} as const;
