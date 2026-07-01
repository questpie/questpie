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

import { createAiRunLink } from "../lib/ai-run-links";
import { isSingleModel } from "../lib/flags";
import { activeRunStatus } from "../lib/legacy-run-artifacts";
import { injectMemoriesIntoInstructions } from "../lib/memory-injection";
import { mergeRecords, relationId } from "../lib/records";
import { sessionOnly } from "../lib/route-access";
import { resolveRuntimeSelection } from "../lib/runtime-selection";

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

		const projectId = input.projectId ?? relationId(session.project);
		const taskId = input.taskId ?? relationId(session.task);

		// ── Consolidated single-model path (flag ON) ────────────
		// The run_links row IS the execution record: the fleet worker claims it,
		// runs the harness turn, and streams into resumable-KV. Flag OFF keeps the
		// legacy background-producer body verbatim — the in-process fleet is not
		// started on boot, so a bare publish-removal would strand the row — until
		// T9 flips the flag with the standalone worker running.
		if (isSingleModel()) {
			// Single-flight (§3.10): reject a second concurrent turn while the
			// session already holds a non-terminal run.
			const activeRunId = relationId(session.activeRun);
			if (activeRunId) {
				const activeRun = await collections.run_links.findOne({
					where: { id: activeRunId },
				});
				if (activeRun && activeRunStatus(activeRun.status)) {
					throw ApiError.conflict(
						"A run is already active for this chat session",
					);
				}
			}

			const runtime = await resolveRuntimeSelection({ collections } as never, {
				modelId: input.modelId,
				projectId: projectId ?? undefined,
			});
			// Per-turn memory recall (mirrors the task path): the recalled DATA
			// block is prepended to the prompt the harness passes every turn.
			const instructions = await injectMemoriesIntoInstructions(
				{
					search: (ctx as { search?: unknown }).search,
					collections: collections as never,
					projectId: projectId ?? undefined,
					taskId: taskId ?? undefined,
				} as never,
				input.content,
				input.content,
			);

			const row = await createAiRunLink({
				ctx: ctx as never,
				runtime,
				initiatedBy: "chat",
				kind: "chat",
				chatSessionId: session.id,
				chatMessageId: message.id,
				instructions,
				projectId,
				taskId,
				linkMetadata: {
					modelId: input.modelId ?? null,
					attachments: input.attachments ?? [],
				},
			});

			// The T6 stream tail resolves chat_sessions.activeRun → run_links
			// .activeStreamId, so persist the run-link's own stream id
			// (`run-stream:…`), NOT the legacy `chat-stream:` id.
			await collections.chat_sessions.updateById({
				id: session.id,
				data: { activeRun: row.id, activeStreamId: row.activeStreamId },
			});

			return { session, message, runId: row.id, streamId: row.activeStreamId };
		}

		// ── Legacy background producer (flag OFF) ───────────────
		const streamId = `chat-stream:${session.id}:${randomUUID()}`;

		await collections.chat_sessions.updateById({
			id: session.id,
			data: { activeStreamId: streamId },
		});

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
