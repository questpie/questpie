/**
 * Scheduled Transition Job
 *
 * Background job that transitions a collection record or global
 * to a target workflow stage at a scheduled time.
 *
 * @example
 * ```ts
 * // Schedule a publish transition for 2 hours from now
 * await app.queue['scheduled-transition'].publish({
 *   type: 'collection',
 *   collection: 'posts',
 *   recordId: '123',
 *   stage: 'published',
 * });
 * ```
 */

import { z } from "zod";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { ApiError } from "#questpie/server/errors/base.js";
import { job } from "#questpie/server/integrated/queue/job.js";

/**
 * Schema for scheduled transition job payload
 */
export const scheduledTransitionSchema = z.discriminatedUnion("type", [
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

export type ScheduledTransitionPayload = z.infer<
	typeof scheduledTransitionSchema
>;

/**
 * Scheduled transition job definition
 *
 * Transitions a record or global to a target workflow stage.
 * Runs in system access mode (no user session).
 */
export const scheduledTransitionJob = job({
	name: "scheduled-transition",
	schema: scheduledTransitionSchema,
	options: {
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
	},
	handler: async ({ payload, app: appInstance }) => {
		const app = appInstance as Questpie<any>;

		if (payload.type === "collection") {
			const crud = app.api.collections[payload.collection as any];
			if (!crud) {
				throw ApiError.notFound("Collection", payload.collection);
			}
			await crud.transitionStage(
				{ id: payload.recordId, stage: payload.stage },
				{ accessMode: "system" },
			);
		} else {
			const globalConfig = app.getGlobalConfig(payload.global as any);
			if (!globalConfig) {
				throw ApiError.notFound("Global", payload.global);
			}
			const crud = globalConfig.generateCRUD(app.db, app);
			await crud.transitionStage(
				{ stage: payload.stage },
				{ accessMode: "system" },
			);
		}
	},
});
