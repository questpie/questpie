/**
 * POST /api/chat — create a chat turn.
 *
 * Consolidated run model: validates input, creates/finds the chat session,
 * persists the user message, and mints the `run_links` row (kind="chat") that
 * IS the execution record — the fleet worker claims it, runs the harness turn,
 * and streams into resumable-KV. Returns `{ session, message, runId, streamId }`
 * synchronously — the client then attaches to `GET /api/runs/{runId}/stream`
 * (or resumes via `GET /api/chat/{chatId}/stream`).
 */

import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import { createAiRunLink } from "../lib/ai-run-links";
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
		// Stable client-minted UIMessage id (§4.5): stored as the user row's
		// uiMessageId so the optimistic echo, the persisted row, and a retry
		// (regenerate) all reconcile to ONE message identity.
		clientMessageId: z.string().max(64).optional(),
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
		// find-or-create by (chatSession, uiMessageId): a retry/regenerate of the
		// same turn re-sends the same clientMessageId and must NOT duplicate the
		// user row — the new run simply links to the existing message.
		const existingMessage = input.clientMessageId
			? await collections.chat_messages.findOne({
					where: {
						chatSession: session.id,
						uiMessageId: input.clientMessageId,
						role: "user",
					},
				})
			: null;
		const message =
			existingMessage ??
			(await collections.chat_messages.create({
				chatSession: session.id,
				role: "user",
				content: input.content,
				model: input.modelId,
				runStatus: "pending",
				uiMessageId: input.clientMessageId,
				metadata: mergeRecords(
					input.metadata,
					input.attachments?.length ? { attachments: input.attachments } : null,
				) as any,
			}));

		const projectId = input.projectId ?? relationId(session.project);
		const taskId = input.taskId ?? relationId(session.task);

		// ── Single-flight (§3.10) ───────────────────────────────
		// Reject a second concurrent turn while the session already holds a
		// non-terminal run.
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

		// The run_links row IS the execution record: the fleet worker claims it,
		// runs the harness turn, and streams into resumable-KV.
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

		// The stream tail resolves chat_sessions.activeRun → run_links
		// .activeStreamId, so persist the run-link's own stream id
		// (`run-stream:…`).
		await collections.chat_sessions.updateById({
			id: session.id,
			data: { activeRun: row.id, activeStreamId: row.activeStreamId },
		});

		return { session, message, runId: row.id, streamId: row.activeStreamId };
	});
