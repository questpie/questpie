/**
 * Scheduled Transition Job
 *
 * Background job that transitions a collection record or global
 * to a target workflow stage at a scheduled time.
 *
 * @example
 * ```ts
 * // Schedule a publish transition for 2 hours from now
 * await app.queue.scheduledTransition.publish({
 *   type: 'collection',
 *   collection: 'posts',
 *   recordId: '123',
 *   stage: 'published',
 * });
 * ```
 */

import { z } from "zod";

import { ApiError } from "#questpie/server/errors/base.js";
import { job } from "../integrated/queue/job.js";

/**
 * Schema for scheduled transition job payload
 */
const SCHEDULED_TRANSITION_JOB_KEY = "scheduledTransition" as const;
const SCHEDULED_TRANSITION_JOB_NAME = "scheduled-transition" as const;

const scheduledTransitionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("collection"),
		collection: z.string(),
		recordId: z.string(),
		stage: z.string(),
	}),
	z.object({
		type: z.literal("global"),
		global: z.string(),
		stage: z.string(),
	}),
]);

type ScheduledTransitionPayload = z.infer<
	typeof scheduledTransitionSchema
>;

/**
 * Scheduled transition job definition
 *
 * Transitions a record or global to a target workflow stage.
 * Runs in system access mode (no user session).
 */
const scheduledTransitionJob = job({
	name: SCHEDULED_TRANSITION_JOB_NAME,
	schema: scheduledTransitionSchema,
	options: {
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
	},
	handler: async (ctx) => {
		// Core-internal: cast to access services populated by extractAppServices at runtime
		const { payload } = ctx;
		const collections = (ctx as any).collections as
			| Record<string, any>
			| undefined;
		const globals = (ctx as any).globals as Record<string, any> | undefined;

		if (payload.type === "collection") {
			const crud = collections?.[payload.collection];
			if (!crud) {
				throw ApiError.notFound("Collection", payload.collection);
			}
			await crud.transitionStage(
				{ id: payload.recordId, stage: payload.stage },
				{ accessMode: "system" },
			);
		} else {
			const globalCrud = globals?.[payload.global];
			if (!globalCrud) {
				throw ApiError.notFound("Global", payload.global);
			}
			await globalCrud.transitionStage(
				{ stage: payload.stage },
				{ accessMode: "system" },
			);
		}
	},
});

export {
	SCHEDULED_TRANSITION_JOB_KEY,
	SCHEDULED_TRANSITION_JOB_NAME,
	scheduledTransitionJob,
	scheduledTransitionSchema,
	type ScheduledTransitionPayload,
};
export default scheduledTransitionJob;
