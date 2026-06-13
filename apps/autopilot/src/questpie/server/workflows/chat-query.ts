import { z } from "zod";

import { workflow } from "@questpie/workflows";

import { createAiRunLink } from "../lib/ai-run-links";
import { injectMemoriesIntoInstructions } from "../lib/memory-injection";
import { runReflectionStep } from "../lib/memory-reflect-step";
import { projectWorkspacePath } from "../lib/project-workspace";
import {
	mergeRecords,
	relationId,
} from "../lib/records";
import type { RunCompletion } from "../lib/run-completion";
import { resolveRuntimeSelection } from "../lib/runtime-selection";
import { linkScheduleExecutionRun } from "../lib/schedule-run-links";
import { buildSkillsSystemPrompt } from "../lib/skill-discovery";

function responseContent(completion: RunCompletion | null) {
	if (completion?.status === "completed") {
		return completion.summary?.trim() || "Done.";
	}
	if (completion?.status === "cancelled") {
		return "The run was cancelled.";
	}
	return completion?.error?.trim() || "The run failed.";
}

export default workflow({
	name: "chat-query",
	schema: z.object({
		chatSessionId: z.string(),
		messageId: z.string(),
		runId: z.string().optional(),
		prompt: z.string(),
		projectId: z.string().nullable().optional(),
		taskId: z.string().nullable().optional(),
		modelId: z.string().nullable().optional(),
		scheduleExecutionId: z.string().optional(),
	}),
	timeout: "7d",
	handler: async ({ input, step, ctx, log }) => {
		const session = await step.run("load-chat-session", async () => {
			return ctx.collections.chat_sessions.findOne({
				where: { id: input.chatSessionId },
			});
		});
		if (!session) {
			throw new Error(`Chat session not found: ${input.chatSessionId}`);
		}

		// Handler-scope active scope (used by run-start recall + end-of-run
		// reflection). The chat session carries the project/task it belongs to;
		// `input` may override the project.
		const scopeProjectId = input.projectId ?? relationId(session.project);
		const scopeTaskId = input.taskId ?? relationId(session.task);

		const run = await step.run("resolve-chat-run", async () => {
			if (input.runId) {
				const existing = await ctx.collections.run_links.findOne({
					where: { id: input.runId },
				});
				if (!existing) throw new Error(`Run not found: ${input.runId}`);
				return existing;
			}

			const projectId = scopeProjectId;
			const runtime = await resolveRuntimeSelection(ctx, {
				modelId: input.modelId,
				projectId,
			});
			// Run-start progressive disclosure (§8.3): the published-skills L1 block
			// now rides the run's `systemPrompt` channel (system-level context, not
			// the user turn) instead of being prepended to the prompt. Drafts are
			// excluded; descriptions stay delimited DATA (§8.7). Empty when nothing
			// is published.
			const skillsSystemPrompt = await buildSkillsSystemPrompt(
				ctx.collections,
				{ projectId },
			);
			// Run-start memory RECALL: prepend the scoped active-memory DATA block to
			// the user prompt so the agent recalls lessons from past runs. Injected as
			// DELIMITED DATA, never instructions (untrusted / self-poisoning channel).
			// Best-effort: degrades to `input.prompt` if no semantic-search backend is
			// configured or recall errors.
			const instructions = await injectMemoriesIntoInstructions(
				{
					search: ctx.search,
					collections: ctx.collections,
					projectId,
					taskId: scopeTaskId,
				},
				input.prompt,
				input.prompt,
			);
			const cwd = await projectWorkspacePath(ctx.collections, projectId);
			return createAiRunLink({
				ctx,
				runtime,
				taskId: scopeTaskId,
				projectId,
				initiatedBy: "chat",
				instructions,
				systemPrompt: skillsSystemPrompt || undefined,
				chatSessionId: input.chatSessionId,
				chatMessageId: input.messageId,
				scheduleExecutionId: input.scheduleExecutionId,
				runtimeSessionRef: session.runtimeSessionRef,
				spawnMetadata: cwd ? { cwd } : undefined,
				linkMetadata: {},
			});
		});

		await step.run("link-schedule-execution", async () => {
			await linkScheduleExecutionRun({
				ctx,
				scheduleExecutionId: input.scheduleExecutionId,
				runId: run.id,
			});
		});

		await step.run("link-user-message", async () => {
			await ctx.collections.chat_messages.updateById({
				id: input.messageId,
				data: {
					run: run.id,
					runStatus: "pending",
					model: relationId(run.model) ?? undefined,
					provider: relationId(run.provider) ?? undefined,
				},
			});
		});

		await step.waitForEvent("wait-run-claimed", {
			event: "run.claimed",
			match: { runId: run.id },
			timeout: "3d",
		});

		const completion = await step.waitForEvent<RunCompletion>(
			"wait-run-completed",
			{
				event: "run.completed",
				match: { runId: run.id },
				timeout: "3d",
			},
		);

		const finalRun = await step.run("load-final-run", async () => {
			return ctx.collections.run_links.findOne({ where: { id: run.id } });
		});

		const assistantMessage = await step.run(
			"create-assistant-message",
			async () => {
				return ctx.collections.chat_messages.create({
					chatSession: input.chatSessionId,
					role: "assistant",
					content: responseContent(completion),
					run: run.id,
					runStatus: completion?.status ?? "failed",
					model: relationId(finalRun?.model ?? run.model) ?? undefined,
					provider: relationId(finalRun?.provider ?? run.provider) ?? undefined,
					metadata: {
						workflow: "chat-query",
						knowledgeResourceIds: completion?.knowledgeResourceIds ?? [],
					},
				});
			},
		);

		await step.run("update-chat-state", async () => {
			await ctx.collections.chat_messages.updateById({
				id: input.messageId,
				data: { runStatus: completion?.status ?? "failed" },
			});
			await ctx.collections.chat_sessions.updateById({
				id: input.chatSessionId,
				data: {
					runtimeSessionRef:
						finalRun?.runtimeSessionRef ??
						session.runtimeSessionRef ??
						undefined,
					metadata: mergeRecords(session.metadata, {
						lastRunId: run.id,
						lastMessageId: assistantMessage.id,
						lastRunStatus: completion?.status ?? "failed",
					}),
				},
			});
			await ctx.collections.activity.create({
				actor: "workflow:chat-query",
				type: "chat.response",
				summary: `Chat response created for session ${input.chatSessionId}`,
				run: run.id,
				task: input.taskId ?? relationId(session.task) ?? undefined,
				project: input.projectId ?? relationId(session.project) ?? undefined,
				details: {
					chatSessionId: input.chatSessionId,
					messageId: assistantMessage.id,
					status: completion?.status ?? "failed",
					knowledgeResourceIds: completion?.knowledgeResourceIds ?? [],
				},
			});
		});

		// Memory WRITE (Reflexion, §9.2): async reflection AFTER the run completes.
		// Off-path — never changes the chat result; failure is logged + swallowed.
		// Gated by the per-scope toggle inside `runReflectionStep`. The model boundary
		// is not wired to a live LLM yet (writes nothing today; full path is tested).
		await step.run("memory-reflection", async () => {
			await runReflectionStep(ctx.collections, {
				runId: run.id,
				input: {
					instructions: input.prompt,
					summary: completion?.summary ?? null,
					outcome:
						completion?.status === "completed"
							? "completed"
							: completion?.status === "cancelled"
								? "cancelled"
								: "failed",
					error: completion?.error ?? null,
					scope: { projectId: scopeProjectId, taskId: scopeTaskId },
				},
				scope: { projectId: scopeProjectId, taskId: scopeTaskId },
				log,
			});
		});

		log.info("Chat query completed", {
			chatSessionId: input.chatSessionId,
			runId: run.id,
			status: completion?.status ?? "failed",
		});

		return {
			chatSessionId: input.chatSessionId,
			runId: run.id,
			messageId: assistantMessage.id,
			status: completion?.status ?? "failed",
		};
	},
});
