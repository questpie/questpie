import { route } from "questpie/services";
import { z } from "zod";

import { relationId } from "../../../lib/records";
import { authenticatedRunWorker } from "../../../lib/worker-auth";
import { workflowsFromContext } from "../../../lib/workflows";

const artifactSchema = z
	.object({
		title: z.string().optional(),
		path: z.string().optional(),
		kind: z.string().optional(),
		body: z.string().optional(),
		content: z.string().optional(),
		contentType: z.string().optional(),
		content_type: z.string().optional(),
		mimeType: z.string().optional(),
		mime_type: z.string().optional(),
		renderer: z.string().optional(),
		refKind: z.string().optional(),
		ref_kind: z.string().optional(),
		refValue: z.string().optional(),
		ref_value: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const completionSchema = z.object({
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
	tokens_input: z.number().int().nonnegative().optional(),
	tokens_output: z.number().int().nonnegative().optional(),
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

function normalizeArtifact(artifact: z.infer<typeof artifactSchema>) {
	return {
		...artifact,
		contentType: artifact.contentType ?? artifact.content_type,
		mimeType: artifact.mimeType ?? artifact.mime_type,
		refKind: artifact.refKind ?? artifact.ref_kind,
		refValue: artifact.refValue ?? artifact.ref_value,
	};
}

export default route()
	.post()
	.params<{ runId: string }>()
	.schema(completionSchema)
	.handler(async (ctx) => {
		const { worker, run } = await authenticatedRunWorker(ctx, ctx.params.runId);
		const status = ctx.input.status;
		const runtimeSessionRef =
			ctx.input.runtimeSessionRef ?? ctx.input.runtime_session_ref;

		const updated = await ctx.collections.runs.updateById({
			id: ctx.params.runId,
			data: {
				status,
				summary: ctx.input.summary,
				error: ctx.input.error,
				tokensInput:
					ctx.input.tokensInput ??
					ctx.input.tokens_input ??
					ctx.input.tokens?.input,
				tokensOutput:
					ctx.input.tokensOutput ??
					ctx.input.tokens_output ??
					ctx.input.tokens?.output,
				endedAt: new Date(),
				runtimeSessionRef,
				resumable: ctx.input.resumable ?? false,
				metadata: {
					...(typeof run.metadata === "object" && run.metadata
						? run.metadata
						: {}),
					...(ctx.input.metadata ?? {}),
				} as any,
			},
		});

		const resources = await ctx.services.knowledgeResource.createRunOutputs({
			runId: ctx.params.runId,
			summary: ctx.input.summary,
			outputs: ctx.input.outputs,
			artifacts: ctx.input.artifacts?.map(normalizeArtifact),
			source: "worker",
		});

		await ctx.collections.run_events.create({
			run: ctx.params.runId,
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

		if (worker.id !== "local-dev") {
			await ctx.services.workerManager.releaseLease({
				workerId: worker.id,
				runId: ctx.params.runId,
				status: status === "completed" ? "completed" : "released",
			});
		}

		const taskId = relationId(run.task);
		if (taskId) {
			await ctx.collections.tasks.updateById({
				id: taskId,
				data: { status: terminalTaskStatus(status) },
			});
		}

		await workflowsFromContext(ctx).sendEvent(
			"run.completed",
			{
				runId: ctx.params.runId,
				status,
				summary: ctx.input.summary ?? null,
				error: ctx.input.error ?? null,
				knowledgeResourceIds: resources.map(
					(resource: { id: string }) => resource.id,
				),
			},
			{ runId: ctx.params.runId },
		);

		return {
			ok: true,
			run: updated,
			knowledge_resource_ids: resources.map(
				(resource: { id: string }) => resource.id,
			),
			knowledgeResourceIds: resources.map(
				(resource: { id: string }) => resource.id,
			),
		};
	});
