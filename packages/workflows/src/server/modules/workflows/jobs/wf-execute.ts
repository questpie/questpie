/**
 * wf-execute Job
 *
 * Executes (or replays) a workflow instance. This is the core job that:
 * 1. Loads the workflow definition from app state
 * 2. Bridges collection CRUD to the engine's EngineContext
 * 3. Calls executeWorkflowHandler()
 *
 * Publish options:
 * - singletonKey: instanceId (prevents duplicate executions)
 * - retryLimit: 0 (the engine has its own retry semantics)
 */

import { job } from "questpie";
import { z } from "zod";

import type { EngineContext } from "../../../engine/engine.js";
import { executeWorkflowHandler } from "../../../engine/engine.js";
import type { EventPersistence } from "../../../engine/events.js";
import { matchesCriteria } from "../../../engine/events.js";
import type {
	CachedStep,
	StepPersistence,
	TriggerChildFn,
} from "../../../engine/step-context.js";
import {
	asMatchCriteria,
	getCollections,
	getLogger,
	getQueue,
	getWorkflowDefinitions,
} from "../routes/_helpers.js";

const wfExecuteSchema = z.object({
	instanceId: z.string(),
	workflowName: z.string(),
});

export const wfExecuteJob = job({
	name: "questpie-wf-execute",
	schema: wfExecuteSchema,
	options: {
		retryLimit: 0,
	},
	handler: async (ctx) => {
		const { payload } = ctx;
		const workflows = getWorkflowDefinitions(ctx);
		const {
			instances: instancesCrud,
			steps: stepsCrud,
			logs: logsCrud,
			events: eventsCrud,
		} = getCollections(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");
		const resumeQueue = getQueue(ctx, "questpie-wf-resume");
		const logger = getLogger(ctx);

		// Look up workflow definition from app state
		const definition = workflows?.[payload.workflowName];
		if (!definition) {
			throw new Error(
				`Workflow definition not found: "${payload.workflowName}"`,
			);
		}

		// Bridge collection CRUD to StepPersistence
		const persistence: StepPersistence = {
			async createStep(step) {
				const created = await stepsCrud.create(
					{
						instanceId: step.instanceId,
						name: step.name,
						type: step.type,
						status: step.status,
						result: step.result ?? null,
						error: step.error ?? null,
						attempt: 1,
						maxAttempts: step.maxAttempts,
						scheduledAt: step.scheduledAt ?? null,
						eventName: step.eventName ?? null,
						matchCriteria: step.matchCriteria ?? null,
						childInstanceId: step.childInstanceId ?? null,
						hasCompensation: step.hasCompensation,
						startedAt: new Date(),
						completedAt: step.status === "completed" ? new Date() : null,
					},
					{ accessMode: "system" },
				);
				return { id: created.id };
			},
			async updateStep(instanceId, name, update) {
				const existing = await stepsCrud.findOne(
					{ where: { instanceId, name } },
					{ accessMode: "system" },
				);
				if (!existing) {
					throw new Error(
						`Step not found: instance=${instanceId}, name=${name}`,
					);
				}
				await stepsCrud.updateById(
					{
						id: existing.id,
						data: {
							...update,
							completedAt:
								update.status === "completed" ? new Date() : undefined,
						},
					},
					{ accessMode: "system" },
				);
			},
		};

		// Bridge EventPersistence (optional — only if wf_event collection exists)
		let eventPersistence: EventPersistence | undefined;
		if (eventsCrud) {
			eventPersistence = {
				async createEvent(ev) {
					const created = await eventsCrud.create(
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
				async findMatchingEvent(eventName, matchCriteria) {
					// Find unconsumed events matching by name
					const result = await eventsCrud.find(
						{
							where: { eventName },
							sort: { createdAt: "asc" },
							limit: 100,
						},
						{ accessMode: "system" },
					);

					// Application-level matching (JSONB @> simulation)
					for (const event of result.docs) {
						if (
							matchesCriteria(
								matchCriteria,
								asMatchCriteria(event.matchCriteria),
							)
						) {
							return { id: event.id, data: event.data };
						}
					}
					return null;
				},
				async findWaitingSteps(eventName, matchData) {
					const result = await stepsCrud.find(
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
						matchCriteria: asMatchCriteria(s.matchCriteria),
					}));
				},
				async markEventConsumed(eventId) {
					const ev = await eventsCrud.findOne(
						{ where: { id: eventId } },
						{ accessMode: "system" },
					);
					if (ev) {
						await eventsCrud.updateById(
							{
								id: eventId,
								data: {
									consumedCount: ((ev.consumedCount as number) ?? 0) + 1,
								},
							},
							{ accessMode: "system" },
						);
					}
				},
			};
		}

		// Bridge triggerChild — triggers a child workflow via the client
		const triggerChild: TriggerChildFn = async (
			workflowName,
			input,
			options,
		) => {
			const childDef = workflows?.[workflowName];
			if (!childDef) {
				throw new Error(
					`Child workflow definition not found: "${workflowName}"`,
				);
			}

			// Validate child input
			const validatedInput = childDef.schema.parse(input);

			// Create child instance
			const childInstance = await instancesCrud.create(
				{
					name: workflowName,
					status: "pending",
					input: validatedInput,
					output: null,
					error: null,
					attempt: 0,
					parentInstanceId: options.parentInstanceId,
					parentStepName: options.parentStepName,
					idempotencyKey: null,
					timeoutAt: options.timeout
						? new Date(
								Date.now() +
									(await import("../../../engine/duration.js")).parseDuration(
										options.timeout,
									),
							)
						: null,
					startedAt: null,
					suspendedAt: null,
					completedAt: null,
				},
				{ accessMode: "system" },
			);

			// Queue execution of the child
			await executeQueue.publish({
				instanceId: childInstance.id,
				workflowName,
			});

			return { instanceId: childInstance.id };
		};

		// Resume waiter callback — publishes a wf-resume job
		const resumeWaiter = async (
			waiterInstanceId: string,
			stepName: string,
			result: unknown,
		) => {
			await resumeQueue.publish({
				instanceId: waiterInstanceId,
				stepName,
				result,
			});
		};

		const engineCtx: EngineContext = {
			async loadInstance(instanceId) {
				const inst = await instancesCrud.findOne(
					{ where: { id: instanceId } },
					{ accessMode: "system" },
				);
				if (!inst) return null;
				return {
					id: inst.id,
					name: inst.name,
					status: inst.status,
					input: inst.input,
					attempt: inst.attempt,
				};
			},
			async loadSteps(instanceId) {
				const result = await stepsCrud.find(
					{
						where: { instanceId },
						sort: { createdAt: "asc" },
						limit: 10_000,
					},
					{ accessMode: "system" },
				);
				return result.docs.map(
					(s): CachedStep => ({
						name: s.name,
						type: s.type,
						status: s.status,
						result: s.result,
						error: s.error,
						attempt: s.attempt,
						scheduledAt: s.scheduledAt ? new Date(s.scheduledAt) : null,
						hasCompensation: s.hasCompensation,
					}),
				);
			},
			persistence,
			async updateInstance(instanceId, update) {
				await instancesCrud.updateById(
					{ id: instanceId, data: update },
					{ accessMode: "system" },
				);
			},
			async flushLogs(instanceId, entries) {
				if (entries.length === 0) return;
				for (const entry of entries) {
					await logsCrud.create(
						{
							instanceId,
							level: entry.level,
							message: entry.message,
							data: entry.data,
							timestamp: entry.timestamp,
						},
						{ accessMode: "system" },
					);
				}
			},
			externalLogger: logger,
			appContext: ctx,
			eventPersistence,
			resumeWaiter,
			triggerChild,
		};

		const result = await executeWorkflowHandler(
			definition,
			payload.instanceId,
			engineCtx,
		);

		// If a child workflow completed, check if it has a parent to resume
		if (result.status === "completed") {
			const instance = await instancesCrud.findOne(
				{ where: { id: payload.instanceId } },
				{ accessMode: "system" },
			);
			if (instance?.parentInstanceId && instance?.parentStepName) {
				// Resume the parent workflow's invoke step
				await resumeQueue.publish({
					instanceId: instance.parentInstanceId,
					stepName: instance.parentStepName,
					result: result.output,
				});
			}
		}

		// If a child workflow failed, propagate to parent
		if (result.status === "failed") {
			const instance = await instancesCrud.findOne(
				{ where: { id: payload.instanceId } },
				{ accessMode: "system" },
			);
			if (instance?.parentInstanceId && instance?.parentStepName) {
				// Update parent's invoke step to failed
				const parentStep = await stepsCrud.findOne(
					{
						where: {
							instanceId: instance.parentInstanceId,
							name: instance.parentStepName,
						},
					},
					{ accessMode: "system" },
				);
				if (parentStep && parentStep.status === "waiting") {
					await stepsCrud.updateById(
						{
							id: parentStep.id,
							data: {
								status: "failed",
								error: {
									message: `Child workflow "${instance.name}" failed: ${result.error.message}`,
								},
								completedAt: new Date(),
							},
						},
						{ accessMode: "system" },
					);
					// Re-queue parent to pick up the failure
					await executeQueue.publish({
						instanceId: instance.parentInstanceId,
						workflowName:
							(
								await instancesCrud.findOne(
									{ where: { id: instance.parentInstanceId } },
									{ accessMode: "system" },
								)
							)?.name ?? "",
					});
				}
			}
		}
	},
});

export default wfExecuteJob;
