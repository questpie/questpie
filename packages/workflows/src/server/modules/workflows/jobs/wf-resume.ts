/**
 * wf-resume Job
 *
 * Resumes a suspended workflow by marking a sleeping/waiting step as completed,
 * then re-queuing the execute job.
 *
 * This job is published by the maintenance cron (for sleeping steps whose
 * scheduledAt has passed) and by the event matching engine (for waitForEvent
 * steps that receive a matching event).
 */

import { job } from "questpie";
import { z } from "zod";

import { getCollections, getQueue } from "../routes/_helpers.js";

const wfResumeSchema = z.object({
	instanceId: z.string(),
	stepName: z.string(),
	/** Optional result to store on the step (e.g., matched event data). */
	result: z.unknown().optional(),
});

export const wfResumeJob = job({
	name: "questpie-wf-resume",
	schema: wfResumeSchema,
	options: {
		retryLimit: 3,
		retryDelay: 5,
		retryBackoff: true,
	},
	handler: async (ctx) => {
		const { payload } = ctx;
		const { instances: instancesCrud, steps: stepsCrud } = getCollections(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");

		// Find the step to resume
		const step = await stepsCrud.findOne(
			{
				where: {
					instanceId: payload.instanceId,
					name: payload.stepName,
				},
			},
			{ accessMode: "system" },
		);

		if (!step) {
			throw new Error(
				`Step not found: instance=${payload.instanceId}, name=${payload.stepName}`,
			);
		}

		// Only resume sleeping or waiting steps
		if (step.status !== "sleeping" && step.status !== "waiting") {
			// Step already completed or failed — skip
			return;
		}

		// Mark step as completed
		await stepsCrud.updateById(
			{
				id: step.id,
				data: {
					status: "completed",
					result: payload.result ?? null,
					completedAt: new Date(),
				},
			},
			{ accessMode: "system" },
		);

		// Load instance to get workflow name
		const instance = await instancesCrud.findOne(
			{ where: { id: payload.instanceId } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Instance not found: ${payload.instanceId}`);
		}

		// Re-queue the execute job to replay from the resumed step
		await executeQueue.publish({
			instanceId: payload.instanceId,
			workflowName: instance.name,
		});
	},
});

export default wfResumeJob;
