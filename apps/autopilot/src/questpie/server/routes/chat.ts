import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import { mergeRecords, relationId } from "../lib/records";
import { workflowsFromContext } from "../lib/workflows";

const attachmentSchema = z
	.object({
		type: z.string().optional(),
		source: z.string().optional(),
		label: z.string().optional(),
		name: z.string().optional(),
		refType: z.string().optional(),
		refId: z.string().optional(),
		content: z.string().optional(),
		mimeType: z.string().optional(),
		size: z.number().optional(),
		url: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const chatSchema = z
	.object({
		chatSessionId: z.string().optional(),
		projectId: z.string().optional(),
		taskId: z.string().optional(),
		modelId: z.string().optional(),
		content: z.string().optional().default(""),
		attachments: z.array(attachmentSchema).max(20).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((value) => value.content.trim() || value.attachments?.length, {
		message: "content or attachments are required",
	});

function titleFromContent(content: string): string {
	const title = content.replace(/\s+/g, " ").trim().slice(0, 80);
	return title || "New chat";
}

export default route()
	.post()
	.schema(chatSchema)
	.handler(async (ctx) => {
		const { input, collections } = ctx;
		const existingSession = input.chatSessionId
			? await collections.chat_sessions.findOne({
					where: { id: input.chatSessionId },
				})
			: null;
		if (input.chatSessionId && !existingSession) {
			throw ApiError.notFound("Chat session", input.chatSessionId);
		}

		const session =
			existingSession ??
			(await collections.chat_sessions.create({
				title: titleFromContent(input.content),
				status: "active",
				scopeType: input.projectId ? "project" : "company",
				project: input.projectId,
				task: input.taskId,
				metadata: input.metadata as any,
			}));

		const message = await collections.chat_messages.create({
			chatSession: session.id,
			role: "user",
			content: input.content,
			model: input.modelId,
			metadata: mergeRecords(
				input.metadata,
				input.attachments?.length ? { attachments: input.attachments } : null,
			) as any,
		});

		const runtime = await ctx.services.providerRuntime.resolve({
			modelId: input.modelId,
			projectId: input.projectId ?? relationId(session.project),
		});
		const run = await collections.runs.create({
			task: input.taskId ?? relationId(session.task) ?? undefined,
			project: input.projectId ?? relationId(session.project) ?? undefined,
			status: "pending",
			runtime: runtime.runtime,
			provider: runtime.providerId ?? undefined,
			model: runtime.modelId ?? undefined,
			initiatedBy: "chat",
			instructions: input.content,
			preferredWorker: relationId(session.preferredWorker) ?? undefined,
			runtimeSessionRef: session.runtimeSessionRef ?? undefined,
			targeting: {
				chatSessionId: session.id,
				messageId: message.id,
				toolPolicy: runtime.toolPolicy,
				contextRefs: runtime.contextRefs,
				attachments: input.attachments ?? [],
				promptRefs: runtime.promptRefs,
				runtimeHints: runtime.runtimeHints,
			} as any,
		});

		await collections.chat_messages.updateById({
			id: message.id,
			data: {
				run: run.id,
				runStatus: "pending",
				model: runtime.modelId ?? undefined,
				provider: runtime.providerId ?? undefined,
			},
		});

		const workflow = await workflowsFromContext(ctx).trigger(
			"chat-query",
			{
				chatSessionId: session.id,
				messageId: message.id,
				runId: run.id,
				prompt: input.content,
				projectId: input.projectId ?? null,
				taskId: input.taskId ?? null,
				modelId: input.modelId ?? null,
			},
			{ idempotencyKey: `chat-query:${message.id}` },
		);

		return {
			session,
			message,
			run,
			runId: run.id,
			workflowInstanceId: workflow.instanceId,
			existingWorkflow: workflow.existing,
		};
	});
