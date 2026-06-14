/**
 * Task turn BACKGROUND PRODUCER (harness migration).
 *
 * Runs a task's AI turn via the HarnessAgent in a background job and reports
 * completion back to the durable `task-pipeline` workflow over the workflow
 * engine event bus (`run.claimed` / `run.completed`) — replacing the old
 * ai_runs / worker-claim relay for the task EXECUTION path. The relay
 * (ai-run-mirror + ai_run_events) stays for now; tasks no longer depend on it.
 *
 * Re-homed from ai-run-mirror (the relay no longer fires for producer runs,
 * which never create an ai_runs row):
 *   - run.claimed / run.completed engine events (durable-tasks)
 *   - knowledge-resource creation on successful terminal (mirrorTerminalSideEffects)
 *
 * Robustness:
 *   - Atomic pending->running CAS claim so a workflow-restart re-enqueue (or a
 *     duplicate delivery) can't start a second concurrent harness turn in the
 *     same workspace.
 *   - AbortController wired to a run_links.status poll so a cancellation
 *     (e.g. schedule replacement) aborts the in-flight turn instead of letting
 *     it run to completion.
 *   - Never clobbers a terminal status set during the run.
 *
 * retryLimit: 0 — the WORKFLOW owns retry/backoff. Any thrown error still emits
 * run.completed{failed} so the workflow never hangs to its event timeout.
 */

import { job } from "questpie/services";
import { z } from "zod";

import {
	createHarnessAgent,
	resumeOrCreateSession,
	toUIMessages,
} from "@questpie/ai/harness-core";

import { asRecord } from "../lib/records";
import type { RunCompletion } from "../lib/run-completion";

const taskTurnSchema = z.object({
	runLinkId: z.string(),
	taskId: z.string(),
	projectId: z.string().nullable().optional(),
});

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export default job({
	name: "task-turn-producer",
	schema: taskTurnSchema,
	options: {
		retryLimit: 0,
	},
	handler: async (ctx) => {
		const { payload, collections, logger } = ctx;
		const runId = payload.runLinkId;

		const sendEvent = (event: string, data: Record<string, unknown>) =>
			ctx.workflows.sendEvent(event, { runId, ...data }, { runId });

		// ── 1. Load the run_links row (the single execution record) ──
		const runLink = await collections.run_links.findOne({
			where: { id: runId },
		});
		if (!runLink) {
			throw new Error(`run_link not found: ${runId}`);
		}

		// Idempotency: a workflow restart can re-enqueue this producer. If the run
		// already reached a terminal state, re-emit completion (the waiting step
		// resolves forward or retroactively) instead of re-running the turn.
		if (TERMINAL_STATUSES.includes(String(runLink.status))) {
			await sendEvent("run.completed", {
				status: runLink.status,
				summary: (runLink.summary as string | null) ?? null,
				error: (runLink.error as string | null) ?? null,
				knowledgeResourceIds: [],
			});
			return { status: "noop-already-terminal", runId };
		}

		const meta = asRecord(runLink.metadata);
		const instructions =
			typeof runLink.instructions === "string" ? runLink.instructions : "";
		const systemPrompt =
			typeof meta.systemPrompt === "string" ? meta.systemPrompt : "";
		const cwd =
			typeof meta.cwd === "string" && meta.cwd ? meta.cwd : process.cwd();
		const harnessSessionId =
			typeof runLink.harnessSessionId === "string" &&
			runLink.harnessSessionId.trim()
				? runLink.harnessSessionId
				: runId;

		// ── 2. Atomic claim (pending -> running) ──────────────────
		// Only the invocation that wins this compare-and-swap runs the turn; a
		// workflow-restart re-enqueue (or duplicate delivery) loses it and bails,
		// preventing two concurrent harness turns in the same workspace.
		const updated = await collections.run_links.update({
			where: { id: runId, status: "pending" },
			data: { status: "running", startedAt: new Date(), harnessSessionId },
		});
		const claimedRow = (updated as any)?.[0] as
			| Record<string, unknown>
			| undefined;
		if (!claimedRow) {
			// Lost the claim. If the run is already terminal, re-emit its completion;
			// otherwise the owning invocation is mid-flight and will emit it.
			const current = await collections.run_links.findOne({
				where: { id: runId },
			});
			if (current && TERMINAL_STATUSES.includes(String(current.status))) {
				await sendEvent("run.completed", {
					status: current.status,
					summary: (current.summary as string | null) ?? null,
					error: (current.error as string | null) ?? null,
					knowledgeResourceIds: [],
				});
			}
			return { status: "not-claimed", runId };
		}
		await sendEvent("run.claimed", { workerId: "harness:inline" });

		// Abort the in-flight turn if the run is cancelled while it runs (e.g. a
		// schedule replacement flips run_links.status -> cancelled). Cleared in the
		// `finally` below so the timer never outlives the job.
		const abort = new AbortController();
		const cancelPoll = setInterval(() => {
			void collections.run_links
				.findOne({ where: { id: runId } })
				.then((row) => {
					if (row && TERMINAL_STATUSES.includes(String(row.status))) {
						abort.abort();
					}
				})
				.catch(() => {});
		}, 2000);

		// ── 3. Run the harness turn ────────────────────────────────
		try {
			const agent = createHarnessAgent({
				runtime: "claude-code",
				workRoot: cwd,
				instructions: systemPrompt || undefined,
				permissionMode: "allow-all",
			});

			const resumed = await resumeOrCreateSession({
				agent,
				id: harnessSessionId,
				abortSignal: abort.signal,
				loadResumeState: async () =>
					runLink.harnessResumeState &&
					typeof runLink.harnessResumeState === "object"
						? (runLink.harnessResumeState as any)
						: null,
			});

			const result = await agent.stream({
				session: resumed.session,
				prompt: instructions,
				// The TURN's abort signal — this is what actually interrupts the
				// in-flight harness run (createSession's signal only covers session
				// construction). Wired to the cancellation poll above.
				abortSignal: abort.signal,
			});

			// Drain the UIMessage stream to run the turn to completion, accumulating
			// the assistant text as the run summary. result.text does not aggregate
			// for the harness once result.stream is consumed by toUIMessages.
			let assistantText = "";
			const uiStream = (
				toUIMessages(result as any) as ReadableStream<any>
			).pipeThrough(
				new TransformStream({
					transform(chunk, controller) {
						if (chunk && chunk.type === "text-delta") {
							assistantText +=
								typeof chunk.delta === "string"
									? chunk.delta
									: typeof chunk.text === "string"
										? chunk.text
										: "";
						}
						controller.enqueue(chunk);
					},
				}),
			);
			const reader = uiStream.getReader();
			try {
				while (true) {
					const { done } = await reader.read();
					if (done) break;
				}
			} finally {
				reader.releaseLock();
			}

			// ── 4. Persist resume state + completion ─────────────────
			const resumeState = await resumed.detachAndPersist();
			const summary = assistantText.trim() || null;

			// Respect a terminal status (e.g. a schedule replacement cancelled this
			// run) that landed WHILE the turn was running — never clobber it with
			// "completed". Report the actual final status so the workflow agrees.
			const afterRun = await collections.run_links.findOne({
				where: { id: runId },
			});
			if (afterRun && TERMINAL_STATUSES.includes(String(afterRun.status))) {
				await sendEvent("run.completed", {
					status: afterRun.status,
					summary: (afterRun.summary as string | null) ?? summary,
					error: (afterRun.error as string | null) ?? null,
					knowledgeResourceIds: [],
				});
				return { status: "superseded", runId, finalStatus: afterRun.status };
			}

			// Re-home mirrorTerminalSideEffects: create knowledge resources from the
			// run summary (idempotent — skip if the summary asset already exists).
			// createRunOutputs resolves task/project scope from the run_links row.
			// BEST-EFFORT: a knowledge-write failure must NOT flip a successful turn
			// to "failed", so it is isolated from the run's terminal outcome.
			let knowledgeResourceIds: string[] = [];
			const knowledgeService = (ctx.services as any)?.knowledgeResource;
			if (summary && knowledgeService) {
				try {
					const existing = await collections.assets.findOne({
						where: { run: runId, path: `runs/${runId}/summary.md` },
					});
					const resources = existing
						? [existing]
						: await knowledgeService.createRunOutputs({ runId, summary });
					knowledgeResourceIds = (resources ?? []).map(
						(resource: { id: string }) => resource.id,
					);
				} catch (knowledgeError) {
					logger.warn?.("Knowledge-resource creation failed (best-effort)", {
						runId,
						error:
							knowledgeError instanceof Error
								? knowledgeError.message
								: String(knowledgeError),
					});
				}
			}

			const completion: RunCompletion = {
				status: "completed",
				summary,
				error: null,
				knowledgeResourceIds,
			};

			await collections.run_links.updateById({
				id: runId,
				data: {
					status: "completed",
					summary: summary ?? undefined,
					endedAt: new Date(),
					harnessSessionId,
					harnessResumeState: resumeState as any,
				},
			});
			await sendEvent("run.completed", completion as Record<string, unknown>);

			logger.info("Task turn completed", {
				runId,
				taskId: payload.taskId,
				knowledgeResources: knowledgeResourceIds.length,
			});
			return { status: "completed", runId };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error?.("Task turn failed", { runId, error: message });

			// Don't clobber a terminal status (e.g. cancellation) set during the run.
			const afterError = await collections.run_links
				.findOne({ where: { id: runId } })
				.catch(() => null);
			if (afterError && TERMINAL_STATUSES.includes(String(afterError.status))) {
				await sendEvent("run.completed", {
					status: afterError.status,
					summary: (afterError.summary as string | null) ?? null,
					error: (afterError.error as string | null) ?? message,
					knowledgeResourceIds: [],
				});
				return { status: "superseded", runId, finalStatus: afterError.status };
			}

			await collections.run_links
				.updateById({
					id: runId,
					data: { status: "failed", error: message, endedAt: new Date() },
				})
				.catch(() => {});

			// Always report completion so the workflow never hangs to its timeout.
			await sendEvent("run.completed", {
				status: "failed",
				summary: null,
				error: message,
				knowledgeResourceIds: [],
			});
			return { status: "failed", runId, error: message };
		} finally {
			clearInterval(cancelPoll);
		}
	},
});
