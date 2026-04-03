/**
 * Core module: scheduled transition dispatch utility.
 *
 * Extracted from CRUD generators to remove hardcoded job name strings.
 * The actual job definition lives in modules/core/jobs/scheduled-transition.ts.
 */

import { ApiError } from "#questpie/server/errors/base.js";

/**
 * Thrown by the scheduledTransitionHook's beforeTransition to signal
 * that the transition was scheduled for a future date and the
 * CRUD generator should return the existing record unchanged.
 */
export class TransitionScheduledError extends Error {
	constructor() {
		super("Transition scheduled for future execution");
		this.name = "TransitionScheduledError";
	}
}

export interface ScheduleCollectionTransitionParams {
	collection: string;
	recordId: string;
	stage: string;
	scheduledAt: Date;
}

export interface ScheduleGlobalTransitionParams {
	global: string;
	stage: string;
	scheduledAt: Date;
}

const JOB_NAME = "scheduled-transition";

function getScheduledTransitionPublish(
	queue: any,
): ((payload: any, options?: any) => Promise<void>) | null {
	return queue?.[JOB_NAME]?.publish ?? null;
}

/**
 * Schedule a collection record transition via queue job.
 * Throws if queue adapter is not configured.
 */
export async function scheduleCollectionTransition(
	queue: any,
	params: ScheduleCollectionTransitionParams,
): Promise<void> {
	const publish = getScheduledTransitionPublish(queue);
	if (!publish) {
		throw ApiError.badRequest(
			"Scheduled transitions require a queue adapter with the scheduled-transition job registered",
		);
	}
	await publish(
		{
			type: "collection" as const,
			collection: params.collection,
			recordId: params.recordId,
			stage: params.stage,
		},
		{ startAfter: params.scheduledAt },
	);
}

/**
 * Schedule a global transition via queue job.
 * Throws if queue adapter is not configured.
 */
export async function scheduleGlobalTransition(
	queue: any,
	params: ScheduleGlobalTransitionParams,
): Promise<void> {
	const publish = getScheduledTransitionPublish(queue);
	if (!publish) {
		throw ApiError.badRequest(
			"Scheduled transitions require a queue adapter with the scheduled-transition job registered",
		);
	}
	await publish(
		{
			type: "global" as const,
			global: params.global,
			stage: params.stage,
		},
		{ startAfter: params.scheduledAt },
	);
}
