import { sql } from "drizzle-orm";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export type TerminalRunStatus = "completed" | "failed" | "cancelled";

interface RunLinksFinalizeCollection {
	update(args: {
		where: unknown;
		data: Record<string, unknown>;
	}): Promise<unknown>;
}

interface ChatMessagesCollection {
	create(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * Injected dependencies. The latch CAS + stream-seal are generic (run_links +
 * the KV store); the kind side-effects (workflows / knowledge / chat_messages)
 * are autopilot concerns supplied by the worker entrypoint from its
 * system-context — packages/ai never imports them. Loosely typed so packages/ai
 * stays free of autopilot collection types.
 */
export interface FinalizeRunDeps {
	collections: {
		run_links: RunLinksFinalizeCollection;
		chat_messages?: ChatMessagesCollection;
	};
	/** Backing resumable-stream store (has finish()) — seals the stream. */
	streamStore: { finish(streamId: string): Promise<void> };
	workflows?: {
		sendEvent(
			event: string,
			data: unknown,
			match: unknown,
		): Promise<unknown> | void;
	};
	knowledgeResource?: {
		createRunOutputs(input: {
			runId: string;
			summary?: string;
			source?: string;
		}): Promise<Array<{ id: string }>>;
	};
}

export interface FinalizeRunInput {
	runId: string;
	kind?: string | null;
	terminal: TerminalRunStatus;
	/** producerLease.epoch the worker holds — the writer fence. */
	epoch: number;
	summary?: string | null;
	error?: string | null;
	tokensInput?: number;
	tokensOutput?: number;
	cost?: number;
	uiMessages?: unknown;
	messageId?: string;
	resumeState?: unknown;
	chatSessionId?: string | null;
	/** Stream id to seal; falls back to the latch-update's returned row. */
	activeStreamId?: string;
}

/**
 * The SINGLE terminal path for worker-success / worker-failure / reaper.
 *
 * Latch (the exactly-once gate): an UPDATE whose WHERE asserts `finalizedAt IS
 * NULL` ∧ the producerLease.epoch (RAW jsonb predicate — `where:{producerLease:
 * {epoch}}` silently no-ops on a json column) ∧ `status NOT IN (terminal)`.
 * `update()` returns the winning-rows array, re-asserted under FOR UPDATE row
 * locks; `length === 1` ⟺ this caller is the sole finalizer. Only then are the
 * stream-seal + `run.completed` + kind side-effects performed — so a zombie with
 * a stale epoch, a same-epoch zombie racing the reaper (blocked by finalizedAt),
 * and a finalize after `/cancel` (blocked by status NOT IN terminal) all no-op.
 */
export async function finalizeRun(
	deps: FinalizeRunDeps,
	input: FinalizeRunInput,
): Promise<{ finalized: boolean }> {
	const { collections, streamStore, workflows, knowledgeResource } = deps;
	const now = new Date();

	const data: Record<string, unknown> = {
		status: input.terminal,
		endedAt: now,
		finalizedAt: now,
	};
	if (input.summary !== undefined) data.summary = input.summary ?? undefined;
	if (input.error !== undefined) data.error = input.error ?? undefined;
	if (input.tokensInput !== undefined) data.tokensInput = input.tokensInput;
	if (input.tokensOutput !== undefined) data.tokensOutput = input.tokensOutput;
	if (input.cost !== undefined) data.cost = input.cost;
	if (input.uiMessages !== undefined) data.uiMessages = input.uiMessages;
	if (input.resumeState !== undefined) {
		data.harnessResumeState = input.resumeState;
	}

	const updated = await collections.run_links.update({
		where: {
			id: input.runId,
			finalizedAt: null,
			status: { notIn: TERMINAL_STATUSES },
			RAW: ({ table }: { table: Record<string, unknown> }) =>
				sql`(${table.producerLease} ->> 'epoch')::int = ${input.epoch}`,
		},
		data,
	});
	const rows = Array.isArray(updated)
		? (updated as Array<Record<string, unknown>>)
		: [];
	if (rows.length === 0) {
		// Latch lost: already finalized, epoch bumped (re-claimed), or already
		// terminal (e.g. cancelled). No terminal write, no side-effects.
		return { finalized: false };
	}
	const row = rows[0];

	// ── Latch won — exactly-once side-effects (best-effort, isolated). ──
	const activeStreamId =
		input.activeStreamId ??
		(typeof row.activeStreamId === "string" ? row.activeStreamId : undefined);
	if (activeStreamId) {
		await streamStore.finish(activeStreamId).catch(() => {});
	}

	let knowledgeResourceIds: string[] = [];
	if (input.kind === "task" && knowledgeResource?.createRunOutputs) {
		try {
			const resources = await knowledgeResource.createRunOutputs({
				runId: input.runId,
				summary: input.summary ?? undefined,
				source: "worker",
			});
			knowledgeResourceIds = resources.map((resource) => resource.id);
		} catch {
			// best-effort: knowledge creation never blocks the terminal outcome
		}
	}

	if (input.kind === "chat" && collections.chat_messages?.create) {
		// The assistant row MUST carry `run` or mirrorChatRunStatus's where:{run}
		// can't propagate runStatus. chat_messages.chatSession is required().
		const chatSession =
			input.chatSessionId ??
			(typeof row.chatSession === "string" ? row.chatSession : undefined);
		if (chatSession) {
			try {
				await collections.chat_messages.create({
					chatSession,
					role: "assistant",
					content: input.summary ?? "",
					runStatus: input.terminal,
					run: input.runId,
					uiMessageId: input.messageId ?? undefined,
					uiMessage: input.uiMessages ?? undefined,
				});
			} catch {
				// best-effort
			}
		}
	}

	if (workflows?.sendEvent) {
		await Promise.resolve(
			workflows.sendEvent(
				"run.completed",
				{
					runId: input.runId,
					status: input.terminal,
					summary: input.summary ?? null,
					error: input.error ?? null,
					knowledgeResourceIds,
				},
				{ runId: input.runId },
			),
		).catch(() => {});
	}

	return { finalized: true };
}
