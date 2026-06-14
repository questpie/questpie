/**
 * POST /api/chat — create a chat turn.
 *
 * Architecture B (background producer): validates input, creates/finds the
 * chat session, persists the user message, sets `activeStreamId` on the
 * session, and enqueues the `chat-turn-producer` job. Returns the session +
 * message + streamId synchronously — the client then GETs
 * `/api/chat/{chatId}/stream` to consume the resumable SSE.
 */

import { randomUUID } from "node:crypto";

import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import { mergeRecords, relationId } from "../lib/records";
import { sessionOnly } from "../lib/route-access";

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
		const { input, collections, queue } = ctx;

		// ── Validate project ────────────────────────────────────
		const inputProject = input.projectId
			? await collections.projects.findOne({ where: { id: input.projectId } })
			: null;
		if (input.projectId && !inputProject) {
			throw ApiError.notFound("Project", input.projectId);
		}

		// ── Find or create chat session ─────────────────────────
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

		// ── Create user message ─────────────────────────────────
		const message = await collections.chat_messages.create({
			chatSession: session.id,
			role: "user",
			content: input.content,
			model: input.modelId,
			runStatus: "pending",
			metadata: mergeRecords(
				input.metadata,
				input.attachments?.length ? { attachments: input.attachments } : null,
			) as any,
		});

		// ── Generate stream ID + set active on session ──────────
		const streamId = `chat-stream:${session.id}:${randomUUID()}`;
		const projectId = input.projectId ?? relationId(session.project);
		const taskId = input.taskId ?? relationId(session.task);

		await collections.chat_sessions.updateById({
			id: session.id,
			data: { activeStreamId: streamId },
		});

		// ── Enqueue background producer ─────────────────────────
		await (queue as any).chatTurnProducer.publish({
			chatSessionId: session.id,
			messageId: message.id,
			streamId,
			prompt: input.content,
			projectId: projectId ?? null,
			taskId: taskId ?? null,
			modelId: input.modelId ?? null,
			attachments: input.attachments ?? [],
		});

		return {
			session,
			message,
			streamId,
		};
	});
