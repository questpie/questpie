import { route } from "questpie/services";
import { z } from "zod";

import { authenticatedWorker } from "../lib/worker-auth";
import { workflowsFromContext } from "../lib/workflows";

const artifactSchema = z
	.object({
		title: z.string().optional(),
		path: z.string().optional(),
		kind: z.string().optional(),
		body: z.string().optional(),
		content: z.string().optional(),
		contentType: z.string().optional(),
		mimeType: z.string().optional(),
		renderer: z.string().optional(),
		refKind: z.string().optional(),
		refValue: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const completionSchema = z.object({
	runId: z.string(),
	status: z.enum(["completed", "failed", "cancelled"]),
	summary: z.string().optional(),
	error: z.string().optional(),
	tokens: z
		.object({
			input: z.number().int().nonnegative().optional(),
			output: z.number().int().nonnegative().optional(),
		})
		.optional(),
	tokensInput: z.number().int().nonnegative().optional(),
	tokensOutput: z.number().int().nonnegative().optional(),
	runtimeSessionRef: z.string().optional(),
	runtime_session_ref: z.string().optional(),
	resumable: z.boolean().optional(),
	outputs: z.unknown().optional(),
	artifacts: z.array(artifactSchema).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

function terminalTaskStatus(status: "completed" | "failed" | "cancelled") {
	if (status === "completed") return "review";
	if (status === "cancelled") return "cancelled";
	return "failed";
}

export default route()
	.post()
	.schema(completionSchema)
	.handler(async (ctx) => {
		const worker = await authenticatedWorker(ctx);
		const { run } = await ctx.services.workerManager.requireActiveLease(
			worker.id,
			ctx.input.runId,
		);
		const status = ctx.input.status;
		const runtimeSessionRef =
			ctx.input.runtimeSessionRef ?? ctx.input.runtime_session_ref;
		const updated = await ctx.collections.runs.updateById({
			id: ctx.input.runId,
			data: {
				status,
				summary: ctx.input.summary,
				error: ctx.input.error,
				tokensInput: ctx.input.tokensInput ?? ctx.input.tokens?.input,
				tokensOutput: ctx.input.tokensOutput ?? ctx.input.tokens?.output,
				endedAt: new Date(),
				runtimeSessionRef,
				resumable: ctx.input.resumable ?? false,
				metadata: {
					...(typeof run.metadata === "object" && run.metadata
						? run.metadata
						: {}),
					...(ctx.input.metadata ?? {}),
				},
			},
		});

		const resources = await ctx.services.knowledgeResource.createRunOutputs({
			runId: ctx.input.runId,
			summary: ctx.input.summary,
			outputs: ctx.input.outputs,
			artifacts: ctx.input.artifacts,
			source: "worker",
		});

		await ctx.collections.run_events.create({
			run: ctx.input.runId,
			type: "completed",
			level: status === "failed" ? "error" : "info",
			summary: ctx.input.summary ?? ctx.input.error,
			metadata: {
				workerId: worker.id,
				status,
				knowledgeResourceIds: resources.map(
					(resource: { id: string }) => resource.id,
				),
			},
		});

		await ctx.services.workerManager.releaseLease({
			workerId: worker.id,
			runId: ctx.input.runId,
			status: status === "completed" ? "completed" : "released",
		});

		if (run.task) {
			await ctx.collections.tasks.updateById({
				id: typeof run.task === "string" ? run.task : run.task.id,
				data: { status: terminalTaskStatus(status) },
			});
		}

		await workflowsFromContext(ctx).sendEvent(
			"run.completed",
			{
				runId: ctx.input.runId,
				status,
				summary: ctx.input.summary ?? null,
				error: ctx.input.error ?? null,
				knowledgeResourceIds: resources.map(
					(resource: { id: string }) => resource.id,
				),
			},
			{ runId: ctx.input.runId },
		);

		return {
			ok: true,
			run: updated,
			knowledgeResourceIds: resources.map(
				(resource: { id: string }) => resource.id,
			),
		};
	});
