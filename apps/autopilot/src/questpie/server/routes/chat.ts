import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import { createAiRunLink } from "../lib/ai-run-links";
import { injectMemoriesIntoInstructions } from "../lib/memory-injection";
import { projectWorkspacePath } from "../lib/project-workspace";
import { mergeRecords, relationId } from "../lib/records";
import { sessionOnly } from "../lib/route-access";
import { resolveRuntimeSelection } from "../lib/runtime-selection";
import { buildSkillsSystemPrompt } from "../lib/skill-discovery";
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
	.access(sessionOnly)
	.schema(chatSchema)
	.handler(async (ctx) => {
		const { input, collections } = ctx;
		const inputProject = input.projectId
			? await collections.projects.findOne({ where: { id: input.projectId } })
			: null;
		if (input.projectId && !inputProject) {
			throw ApiError.notFound("Project", input.projectId);
		}

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

		const projectId = input.projectId ?? relationId(session.project);
		const taskId = input.taskId ?? relationId(session.task);
		const runtime = await resolveRuntimeSelection(ctx, {
			modelId: input.modelId,
			projectId,
		});
		const cwd = await projectWorkspacePath(collections, projectId);
		const skillsSystemPrompt = await buildSkillsSystemPrompt(collections, {
			projectId,
		});
		const instructions = await injectMemoriesIntoInstructions(
			{
				search: ctx.search,
				collections,
				projectId,
				taskId,
			},
			input.content,
			input.content,
			ctx.logger,
		);
		const run = await createAiRunLink({
			ctx,
			runtime,
			taskId,
			projectId,
			initiatedBy: "chat",
			instructions,
			systemPrompt: skillsSystemPrompt || undefined,
			chatSessionId: session.id,
			chatMessageId: message.id,
			runtimeSessionRef: session.runtimeSessionRef,
			spawnMetadata: {
				attachments: input.attachments ?? [],
				...(cwd ? { cwd } : {}),
			},
			linkMetadata: { attachments: input.attachments ?? [] },
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
				projectId: projectId ?? null,
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
