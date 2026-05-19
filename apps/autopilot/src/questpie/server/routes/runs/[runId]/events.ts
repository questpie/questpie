import { route } from "questpie/services";
import { z } from "zod";

import { mergeRecords, relationId } from "../../../lib/records";
import {
	authenticatedRunWorker,
	authorizeWorkerOrSession,
} from "../../../lib/worker-auth";
import { workflowsFromContext } from "../../../lib/workflows";

const eventSchema = z.object({
	type: z.string().min(1),
	level: z.enum(["debug", "info", "warn", "error", "system"]).default("info"),
	summary: z.string().optional(),
	sequence: z.number().int().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

function json(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

async function parseJson(request: Request) {
	const text = await request.text();
	return text ? JSON.parse(text) : {};
}

export default route()
	.get()
	.post()
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => {
		if (ctx.request.method === "GET") {
			await authorizeWorkerOrSession(ctx);
			const url = new URL(ctx.request.url);
			const limit = Number(url.searchParams.get("limit") ?? 100);
			const run = await ctx.collections.run_links.findOne({
				where: { id: ctx.params.runId },
			});
			if (!run) return json([]);

			const aiRunId = relationId(run.aiRun);
			if (!aiRunId) return json([]);

			const events = await ctx.collections.ai_run_events.find({
				where: { run: aiRunId },
				limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
				orderBy: { createdAt: "asc" },
			});
			return json(
				events.docs.map((event: Record<string, unknown>) => ({
					...event,
					run: ctx.params.runId,
					aiRun: aiRunId,
					metadata: event.meta,
				})),
			);
		}

		const input = eventSchema.parse(await parseJson(ctx.request));
		const { worker, run } = await authenticatedRunWorker(ctx, ctx.params.runId);

		if (run.status === "claimed" && input.type === "started") {
			await ctx.collections.runs.updateById({
				id: run.id,
				data: { status: "running", startedAt: new Date() },
			});
			const runLink = await ctx.collections.run_links.findOne({
				where: { id: ctx.params.runId },
			});
			if (runLink) {
				await ctx.collections.run_links.updateById({
					id: ctx.params.runId,
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
			run: ctx.params.runId,
			type: input.type,
			level: input.level,
			summary: input.summary,
			sequence: input.sequence,
			metadata: {
				...(input.metadata ?? {}),
				workerId: worker.id,
			},
		});

		await workflowsFromContext(ctx).sendEvent(
			"run.event",
			{
				runId: ctx.params.runId,
				type: input.type,
				level: input.level,
				summary: input.summary ?? null,
				metadata: input.metadata ?? null,
			},
			{ runId: ctx.params.runId },
		);

		return json({ ok: true, event_id: event.id, eventId: event.id });
	});
