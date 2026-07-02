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
	/**
	 * Backing resumable-stream store. `finish()` seals the stream; `append()` (used
	 * on the failed path to write a real error+finish chunk) no-ops post-seal via
	 * the store's post-finish guard.
	 */
	streamStore: {
		append(streamId: string, data: string): Promise<unknown>;
		finish(streamId: string): Promise<void>;
	};
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
			/**
			 * Worker artifacts persisted alongside the run outputs (e.g. the
			 * kind='log' run transcript). Structurally a subset of the autopilot
			 * service's WorkerArtifactInput — declared loosely here so packages/ai
			 * stays free of autopilot types.
			 */
			artifacts?: Array<{
				title?: string | null;
				path?: string | null;
				kind?: string | null;
				body?: string | null;
				contentType?: string | null;
			}>;
		}): Promise<Array<{ id: string }>>;
	};
}

/**
 * Cap on the serialized `runs/{id}/transcript.json` artifact body. When the
 * uiMessages JSON exceeds it, the OLDEST messages are dropped first and the
 * truncation is recorded inside the stored JSON as `{truncated: true}`.
 */
export const MAX_LOG_ARTIFACT_BYTES = 256 * 1024;

const textEncoder = new TextEncoder();

/**
 * Serialize uiMessages for the kind='log' transcript artifact, keeping the
 * newest suffix that fits under MAX_LOG_ARTIFACT_BYTES (tail-truncation:
 * oldest messages dropped first).
 */
function serializeTranscript(uiMessages: unknown[]): string {
	const full = JSON.stringify(uiMessages);
	if (textEncoder.encode(full).length <= MAX_LOG_ARTIFACT_BYTES) return full;

	// Walk from the newest message backwards to find the oldest one that still
	// fits; everything before it is dropped.
	// Envelope overhead of `{"truncated":true,"messages":[]}`.
	let size = textEncoder.encode(
		JSON.stringify({ truncated: true, messages: [] }),
	).length;
	let cut = uiMessages.length;
	for (let i = uiMessages.length - 1; i >= 0; i--) {
		const entry = JSON.stringify(uiMessages[i]) ?? "null";
		const cost = textEncoder.encode(entry).length + 1; // +1 for the array comma
		if (size + cost > MAX_LOG_ARTIFACT_BYTES) break;
		size += cost;
		cut = i;
	}
	return JSON.stringify({ truncated: true, messages: uiMessages.slice(cut) });
}

/** The run transcript as a kind='log' knowledge artifact; undefined when there
 * is no non-empty uiMessages array to persist. */
function buildLogArtifact(
	runId: string,
	uiMessages: unknown,
):
	| {
			title: string;
			path: string;
			kind: string;
			body: string;
			contentType: string;
	  }
	| undefined {
	if (!Array.isArray(uiMessages) || uiMessages.length === 0) return undefined;
	return {
		title: "Run transcript",
		path: `runs/${runId}/transcript.json`,
		kind: "log",
		body: serializeTranscript(uiMessages),
		contentType: "application/json",
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
			// json values are stored double-encoded (jsonb string) by the
			// collection layer — peel with `#>> '{}'` (also matches plain objects).
			RAW: ({ table }: { table: Record<string, unknown> }) =>
				sql`((${table.producerLease} #>> '{}')::jsonb ->> 'epoch')::int = ${input.epoch}`,
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
		if (input.terminal === "failed" && input.error) {
			// Append a real error UIMessage chunk + finish so processResponseStream +
			// the parts renderer ingest a normal error part (not a bespoke sentinel).
			// No-op if the worker's sink already sealed the stream (post-finish guard),
			// so a mid-stream worker failure does not double-append.
			await streamStore
				.append(
					activeStreamId,
					JSON.stringify({ type: "error", errorText: input.error }),
				)
				.catch(() => {});
			await streamStore
				.append(activeStreamId, JSON.stringify({ type: "finish" }))
				.catch(() => {});
		}
		await streamStore.finish(activeStreamId).catch(() => {});
	}

	// Run transcript → kind='log' knowledge artifact, persisted for EVERY kind
	// when uiMessages is non-empty. Each sink call sits in its own try/catch —
	// a sink failure must never block the terminal outcome.
	const logArtifact = buildLogArtifact(input.runId, input.uiMessages);

	let knowledgeResourceIds: string[] = [];
	if (input.kind === "task" && knowledgeResource?.createRunOutputs) {
		try {
			// ONE invocation carrying summary + the log artifact, preserving the
			// service's runs/{id}/summary.md semantics.
			const resources = await knowledgeResource.createRunOutputs({
				runId: input.runId,
				summary: input.summary ?? undefined,
				source: "worker",
				artifacts: logArtifact ? [logArtifact] : undefined,
			});
			knowledgeResourceIds = resources.map((resource) => resource.id);
		} catch {
			// best-effort: knowledge creation never blocks the terminal outcome
		}
	} else if (logArtifact && knowledgeResource?.createRunOutputs) {
		try {
			await knowledgeResource.createRunOutputs({
				runId: input.runId,
				artifacts: [logArtifact],
				source: "worker",
			});
		} catch {
			// best-effort: the transcript sink never blocks the terminal outcome
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
