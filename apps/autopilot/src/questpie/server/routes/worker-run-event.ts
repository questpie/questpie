import { route } from "questpie/services";
import { z } from "zod";

import { mergeRecords } from "../lib/records";
import { authenticatedWorker } from "../lib/worker-auth";
import { workflowsFromContext } from "../lib/workflows";

const eventSchema = z.object({
	runId: z.string(),
	type: z.string().min(1),
	level: z.enum(["debug", "info", "warn", "error", "system"]).default("info"),
	summary: z.string().optional(),
	sequence: z.number().int().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export default route()
	.post()
	.schema(eventSchema)
	.handler(async (ctx) => {
		const worker = await authenticatedWorker(ctx);
		const { run } = await ctx.services.workerManager.requireActiveLease(
			worker.id,
			ctx.input.runId,
		);

		if (run.status === "claimed" && ctx.input.type === "started") {
			await ctx.collections.runs.updateById({
				id: run.id,
				data: { status: "running", startedAt: new Date() },
			});
			const runLink = await ctx.collections.run_links.findOne({
				where: { id: ctx.input.runId },
			});
			if (runLink) {
				await ctx.collections.run_links.updateById({
					id: ctx.input.runId,
					data: {
						status: "running",
						startedAt: new Date(),
						metadata: mergeRecords(runLink.metadata, {
							workerId: worker.id,
						}) as any,
					},
				});
			}
		}

		const event = await ctx.collections.run_events.create({
			run: ctx.input.runId,
			type: ctx.input.type,
			level: ctx.input.level,
			summary: ctx.input.summary,
			sequence: ctx.input.sequence,
			metadata: {
				...(ctx.input.metadata ?? {}),
				workerId: worker.id,
			},
		});

		await workflowsFromContext(ctx).sendEvent(
			"run.event",
			{
				runId: ctx.input.runId,
				type: ctx.input.type,
				level: ctx.input.level,
				summary: ctx.input.summary ?? null,
				metadata: ctx.input.metadata ?? null,
			},
			{ runId: ctx.input.runId },
		);

		return { ok: true, eventId: event.id };
	});
