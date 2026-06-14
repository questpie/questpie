/**
 * Chat turn BACKGROUND PRODUCER (architecture B).
 *
 * Runs a HarnessAgent turn in a background job, writing UIMessage SSE chunks
 * into the QUESTPIE-KV resumable sink so the HTTP route can stream them to
 * the client without holding a long-lived request open.
 *
 * Flow:
 *   1. Load chat session + resolve runtime/instructions/skills
 *   2. createHarnessAgent → resumeOrCreateSession (harness session id = chat session id)
 *   3. agent.stream → pipe toUIMessages into the resumable KV sink (activeStreamId)
 *   4. On completion: persist final UIMessages + harness resume state (detachAndPersist)
 *   5. Clear activeStreamId, update chat session status
 */

import { job } from "questpie/services";
import { z } from "zod";

import {
	createHarnessAgent,
	resumeOrCreateSession,
	toUIMessages,
	ResumableUIMessageStore,
	createQuestpieResumableStreamStore,
} from "@questpie/ai/harness-core";

import { injectMemoriesIntoInstructions } from "../lib/memory-injection";
import { projectWorkspacePath } from "../lib/project-workspace";
import { relationId } from "../lib/records";
import { resolveRuntimeSelection } from "../lib/runtime-selection";
import { buildSkillsSystemPrompt } from "../lib/skill-discovery";

const chatTurnSchema = z.object({
	chatSessionId: z.string(),
	messageId: z.string(),
	streamId: z.string(),
	prompt: z.string(),
	projectId: z.string().nullable().optional(),
	taskId: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	attachments: z
		.array(z.record(z.string(), z.unknown()))
		.optional()
		.default([]),
});

export default job({
	name: "chat-turn-producer",
	schema: chatTurnSchema,
	options: {
		retryLimit: 0,
	},
	handler: async (ctx) => {
		const { payload, collections, kv, logger } = ctx;

		// ── 1. Load chat session ──────────────────────────────────
		const session = await collections.chat_sessions.findOne({
			where: { id: payload.chatSessionId },
		});
		if (!session) {
			throw new Error(`Chat session not found: ${payload.chatSessionId}`);
		}

		const scopeProjectId = payload.projectId ?? relationId(session.project);
		const scopeTaskId = payload.taskId ?? relationId(session.task);

		// ── 2. Resolve runtime + instructions ─────────────────────
		const runtime = await resolveRuntimeSelection(
			{ collections } as any,
			{ modelId: payload.modelId, projectId: scopeProjectId },
		);
		const cwd = await projectWorkspacePath(collections as any, scopeProjectId);
		const skillsSystemPrompt = await buildSkillsSystemPrompt(
			collections as any,
			{ projectId: scopeProjectId },
		);
		const instructions = await injectMemoriesIntoInstructions(
			{
				search: ctx.search,
				collections: collections as any,
				projectId: scopeProjectId,
				taskId: scopeTaskId,
			},
			payload.prompt,
			payload.prompt,
			logger,
		);

		// ── 3. Create harness agent ───────────────────────────────
		const agent = createHarnessAgent({
			runtime: "claude-code",
			workRoot: cwd ?? process.cwd(),
			instructions: [skillsSystemPrompt, instructions]
				.filter(Boolean)
				.join("\n\n"),
			permissionMode: "allow-all",
		});

		// ── 4. Resume or create harness session ───────────────────
		const harnessSessionId =
			typeof session.harnessSessionId === "string" &&
			session.harnessSessionId.trim()
				? session.harnessSessionId
				: payload.chatSessionId;

		const resumed = await resumeOrCreateSession({
			agent,
			id: harnessSessionId,
			loadResumeState: async () => {
				if (
					session.harnessResumeState &&
					typeof session.harnessResumeState === "object"
				) {
					return session.harnessResumeState as any;
				}
				return null;
			},
		});

		// ── 5. Set up resumable sink ──────────────────────────────
		const streamStore = createQuestpieResumableStreamStore({ kv });
		const resumableStore = new ResumableUIMessageStore(streamStore);
		const sink = resumableStore.createSink(payload.streamId);

		// ── 6. Stream the turn ────────────────────────────────────
		try {
			// Update message status to running
			await collections.chat_messages.updateById({
				id: payload.messageId,
				data: { runStatus: "running" },
			});

			const result = await agent.stream({
				session: resumed.session,
				prompt: payload.prompt,
			});

			// Pipe UIMessage chunks into the resumable sink
			const uiStream = toUIMessages(result as any);
			await sink({ stream: uiStream as any });

			// ── 7. Persist harness resume state ─────────────────────
			const resumeState = await resumed.detachAndPersist();

			// ── 8. Collect final text from the stream result ────────
			const finalText =
				typeof (result as any).text === "string"
					? (result as any).text
					: "Done.";

			// ── 9. Create assistant message with the final content ──
			await collections.chat_messages.create({
				chatSession: payload.chatSessionId,
				role: "assistant",
				content: finalText,
				runStatus: "completed",
				model: runtime.modelId ?? undefined,
				provider: runtime.providerId ?? undefined,
				metadata: {
					producer: "chat-turn-producer",
					streamId: payload.streamId,
				},
			});

			// ── 10. Update user message + session state ─────────────
			await collections.chat_messages.updateById({
				id: payload.messageId,
				data: { runStatus: "completed" },
			});

			await collections.chat_sessions.updateById({
				id: payload.chatSessionId,
				data: {
					harnessSessionId,
					harnessResumeState: resumeState as any,
					activeStreamId: null as any,
					metadata: {
						...(typeof session.metadata === "object" && session.metadata !== null
							? session.metadata
							: {}),
						lastStreamId: payload.streamId,
						lastMessageId: payload.messageId,
						lastStatus: "completed",
					},
				},
			});

			logger.info("Chat turn completed", {
				chatSessionId: payload.chatSessionId,
				streamId: payload.streamId,
			});

			return { status: "completed", streamId: payload.streamId };
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			logger.error?.("Chat turn failed", {
				chatSessionId: payload.chatSessionId,
				streamId: payload.streamId,
				error: errorMessage,
			});

			// Mark the stream as finished so clients stop waiting
			try {
				await streamStore.finish(payload.streamId);
			} catch {
				// best-effort
			}

			// Create error assistant message
			await collections.chat_messages.create({
				chatSession: payload.chatSessionId,
				role: "assistant",
				content: `The run failed: ${errorMessage}`,
				runStatus: "failed",
				metadata: {
					producer: "chat-turn-producer",
					streamId: payload.streamId,
					error: errorMessage,
				},
			});

			// Update user message + session
			await collections.chat_messages.updateById({
				id: payload.messageId,
				data: { runStatus: "failed" },
			});

			await collections.chat_sessions.updateById({
				id: payload.chatSessionId,
				data: {
					activeStreamId: null as any,
					metadata: {
						...(typeof session.metadata === "object" &&
						session.metadata !== null
							? session.metadata
							: {}),
						lastStreamId: payload.streamId,
						lastStatus: "failed",
						lastError: errorMessage,
					},
				},
			});

			return { status: "failed", error: errorMessage };
		}
	},
});
