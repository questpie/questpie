import { route } from "questpie";
import { z } from "zod";
import { getCollections } from "./_helpers.js";

export default route()
	.post()
	.schema(
		z.object({
			event: z.string(),
			data: z.unknown().optional(),
			match: z.record(z.string(), z.unknown()).optional(),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
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
	});
