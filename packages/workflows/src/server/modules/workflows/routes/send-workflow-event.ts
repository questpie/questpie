import { route } from "questpie";
import { z } from "zod";

import type { EventPersistence } from "../../../engine/events.js";
import { findWaitingSteps } from "../../../engine/waiting-steps.js";
import { workflowRouteAccess } from "./_access.js";
import { getCollections, getQueue } from "./_helpers.js";

export default route()
	.post()
	.access(workflowRouteAccess("sendEvent"))
	.schema(
		z.object({
			event: z.string(),
			data: z.unknown().optional(),
			match: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
		const { events, steps } = getCollections(ctx);
		const resumeQueue = getQueue(ctx, "questpie-wf-resume");

		const { dispatchEvent } = await import("../../../engine/events.js");

		// Build event persistence from collections
		const eventPersistence: EventPersistence = {
			async createEvent(ev) {
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
			findWaitingSteps(eventName, matchData) {
				return findWaitingSteps(steps, eventName, matchData);
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
				await resumeQueue.publish(
					{
						instanceId,
						stepName,
						result: eventResult,
					},
					{ singletonKey: `${instanceId}:${stepName}` },
				);
			},
		);

		return { matchedCount: result.matchedCount };
	});
