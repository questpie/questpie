import { randomUUID } from "node:crypto";

import { readUIMessageStream, type UIMessage } from "ai";
import { sql } from "drizzle-orm";

import {
	createHarnessAgent,
	resumeOrCreateSession,
	toUIMessages,
} from "../modules/ai/lib/harness-core.js";
import {
	createQuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "../modules/ai/lib/questpie-resumable-streams.js";
import { ResumableUIMessageStore } from "../modules/ai/lib/resumable-uimessage-store.js";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

/**
 * Collection json fields validate PURE JSON — properties holding `undefined`
 * (e.g. UIMessage.metadata, part.providerMetadata from the SDK's snapshots)
 * fail validation. Round-trip drops them.
 */
function toPlainJson<T>(value: T): T | null {
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return null;
	}
}
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_LEASE_MS = 90_000; // 6× heartbeat
const DEFAULT_CANCEL_POLL_MS = 2_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;

export interface ProducerLease {
	epoch: number;
	workerId?: string;
	leaseId?: string;
	expiresAt?: string;
	heartbeatAt?: string;
}

export interface RunHarnessRow {
	id: string;
	activeStreamId: string;
	runtime: string;
	instructions: string;
	harnessSessionId?: string | null;
	harnessResumeState?: unknown;
	producerLease?: ProducerLease | null;
	metadata?: { cwd?: string | null } | null;
}

interface RunLinksUpdateCollection {
	update(args: {
		where: unknown;
		data: Record<string, unknown>;
	}): Promise<unknown>;
	findOne(args: {
		where: unknown;
	}): Promise<Record<string, unknown> | null | undefined>;
}

export interface RunHarnessOptions {
	run: RunHarnessRow;
	collections: { run_links: RunLinksUpdateCollection };
	kv: QuestpieKVLike;
	/** cwd fallback when run.metadata.cwd is unset. */
	workerDir: string;
	skills?: unknown[];
	mcpServers?: unknown[];
	/**
	 * Local-host sandbox settings (e.g. `{ passthroughHomeForAuth: true }` for a
	 * personal-machine worker whose claude-code bridge reads ~/.claude auth).
	 */
	sandbox?: Parameters<typeof createHarnessAgent>[0]["sandbox"];
	heartbeatMs?: number;
	leaseMs?: number;
	cancelPollMs?: number;
	runTimeoutMs?: number;
	/** Test seam: override agent construction (defaults to createHarnessAgent). */
	createAgent?: typeof createHarnessAgent;
}

export interface RunHarnessResult {
	messageId: string;
	summary: string | null;
	tokensInput: number;
	tokensOutput: number;
	resumeState: unknown;
	/** Final UIMessage(s) of the turn (parts JSON) — persisted by finalizeRun
	 * to run_links.uiMessages + chat_messages.uiMessage (§4.2 hydration, T10). */
	uiMessages: UIMessage[];
}

/**
 * The single streaming-execution core a worker runs for one run_links turn:
 * createHarnessAgent + resumeOrCreateSession, stream toUIMessages chunk-objects
 * into the resumable-KV sink (JSONL, framed once at the route edge in T6),
 * heartbeat the lease (loop-driven), cancel-poll, and persist resume state once
 * at end-of-turn. It does NOT write the terminal status / run.completed / kind
 * side-effects — that is finalizeRun (T5).
 *
 * The epoch fence lives on run_links.producerLease.epoch (the only place CAS
 * exists). Because `producerLease` is a json column whose where-operators are
 * basic-eq only, the epoch guard is expressed as a RAW jsonb predicate; a
 * zero-row update means another producer re-claimed (bumped epoch) → superseded.
 *
 * No periodic mid-run checkpoint: the harness session is destroyed by detach(),
 * so harnessResumeState can only be persisted once, after the turn completes.
 */
export async function runHarnessRun(
	options: RunHarnessOptions,
): Promise<RunHarnessResult> {
	const {
		run,
		collections,
		kv,
		workerDir,
		skills,
		mcpServers,
		sandbox,
		heartbeatMs = DEFAULT_HEARTBEAT_MS,
		leaseMs = DEFAULT_LEASE_MS,
		cancelPollMs = DEFAULT_CANCEL_POLL_MS,
		runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS,
		createAgent = createHarnessAgent,
	} = options;

	const runId = run.id;
	const epoch = run.producerLease?.epoch ?? 0;
	const lease: ProducerLease = { ...run.producerLease, epoch };
	const harnessSessionId =
		typeof run.harnessSessionId === "string" && run.harnessSessionId
			? run.harnessSessionId
			: runId;
	const cwd = run.metadata?.cwd || workerDir;
	const messageId = randomUUID();

	const abort = new AbortController();
	const signal = abort.signal;

	// Epoch-guarded CAS. NOTE: `where: { producerLease: { epoch } }` silently
	// no-ops on a json column (its where-operators are basic-eq only), so the
	// fence is a RAW jsonb predicate. Zero rows ⇒ re-claimed (epoch bumped).
	// The collection layer stores json values DOUBLE-ENCODED (a jsonb string,
	// not an object — live-verified), so peel via `#>> '{}'` first; the form
	// also matches plain objects, so it survives an encoding fix.
	const epochWhere = {
		id: runId,
		RAW: ({ table }: { table: Record<string, unknown> }) =>
			sql`((${table.producerLease} #>> '{}')::jsonb ->> 'epoch')::int = ${epoch}`,
	};
	async function casUpdate(data: Record<string, unknown>): Promise<boolean> {
		const updated = await collections.run_links.update({
			where: epochWhere,
			data,
		});
		return Array.isArray(updated) && updated.length > 0;
	}
	function bumpedLease(): Record<string, unknown> {
		const now = Date.now();
		return {
			...lease,
			heartbeatAt: new Date(now).toISOString(),
			expiresAt: new Date(now + leaseMs).toISOString(),
		};
	}

	// Timers start BEFORE agent/session creation: a slow or hung harness boot
	// (bridge spawn, model spin-up) must stay heartbeated — else the lease
	// expires on a healthy-but-slow boot and the reaper kills it — and must
	// remain cancellable via the cancel-poll → abort signal.
	const timers: ReturnType<typeof setInterval>[] = [];
	const runTimeout = setTimeout(() => abort.abort(), runTimeoutMs);

	// cancel-poll: an external cancel flips run_links.status → abort the harness.
	timers.push(
		setInterval(() => {
			void collections.run_links
				.findOne({ where: { id: runId } })
				.then((row) => {
					if (row && TERMINAL_STATUSES.includes(String(row.status))) {
						abort.abort();
					}
				})
				.catch(() => {});
		}, cancelPollMs),
	);

	// heartbeat: loop-driven (NOT chunk-driven) so a turn blocked > lease on a
	// single tool call with zero chunks isn't reaped. Superseded ⇒ abort.
	timers.push(
		setInterval(() => {
			void casUpdate({ producerLease: bumpedLease() })
				.then((ok) => {
					if (!ok) abort.abort();
				})
				.catch(() => {});
		}, heartbeatMs),
	);

	let summaryText = "";
	try {
		const agent = createAgent({
			runtime: run.runtime as "claude-code",
			workRoot: cwd,
			instructions: run.instructions,
			skills: skills as never,
			mcpServers,
			permissionMode: "allow-all",
			sandbox,
		});

		const resumed = await resumeOrCreateSession({
			agent,
			id: harnessSessionId,
			abortSignal: signal,
			loadResumeState: async () =>
				run.harnessResumeState && typeof run.harnessResumeState === "object"
					? (run.harnessResumeState as never)
					: null,
			// The single end-of-turn detachAndPersist() writes harnessResumeState
			// epoch-guarded through here.
			saveResumeState: async (_id, state) => {
				await casUpdate({
					harnessResumeState: toPlainJson(state) as Record<string, unknown>,
				});
			},
		});
		const result = await agent.stream({
			session: resumed.session,
			prompt: run.instructions,
			abortSignal: signal,
		});

		const store = new ResumableUIMessageStore(
			createQuestpieResumableStreamStore({ kv }),
		);
		// onBeforeFirstAppend = the epoch-guarded lease-touch fence (§3.6): if the
		// epoch changed (re-claimed), the sink aborts with zero appends and no seal.
		const sink = store.createSink(run.activeStreamId, {
			onBeforeFirstAppend: async () => casUpdate({ producerLease: bumpedLease() }),
		});

		let firstErrorText: string | null = null;
		let sawFinish = false;
		const uiStream = (
			toUIMessages(result as never, {
				generateMessageId: () => messageId,
			}) as ReadableStream<{
				type?: string;
				delta?: unknown;
				text?: unknown;
				errorText?: unknown;
				messageId?: unknown;
			}>
		).pipeThrough(
			new TransformStream({
				transform(chunk, controller) {
					// WIRE GUARANTEE: every `start` chunk carries THE turn's messageId.
					// The REAL harness stream emits start without one (unlike
					// streamText, which honors generateMessageId) — the FE then keeps
					// its client-generated id, the persisted row gets the worker id,
					// and hydration renders the turn TWICE (live-found duplication).
					if (chunk && chunk.type === "start" && chunk.messageId !== messageId) {
						controller.enqueue({ ...chunk, messageId });
						return;
					}
					if (chunk && chunk.type === "text-delta") {
						summaryText +=
							typeof chunk.delta === "string"
								? chunk.delta
								: typeof chunk.text === "string"
									? chunk.text
									: "";
					}
					if (chunk && chunk.type === "error" && firstErrorText === null) {
						firstErrorText =
							typeof chunk.errorText === "string"
								? chunk.errorText
								: "harness stream error";
					}
					if (chunk && chunk.type === "finish") sawFinish = true;
					controller.enqueue(chunk);
				},
			}),
		);

		// Tee: one branch feeds the KV sink, the other accumulates the final
		// UIMessage snapshot (readUIMessageStream consumes eagerly — no
		// backpressure coupling). Accumulation is best-effort and never fails
		// the turn.
		const [sinkStream, accumulateStream] = (
			uiStream as ReadableStream<unknown>
		).tee();
		let finalMessage: UIMessage | null = null;
		const accumulated = (async () => {
			try {
				for await (const snapshot of readUIMessageStream({
					// Seed the accumulator with the turn's message identity — without
					// it a stream whose start lacks messageId persists id: "".
					message: {
						id: messageId,
						role: "assistant",
						parts: [],
					} as never,
					stream: accumulateStream as never,
				})) {
					finalMessage = snapshot;
				}
			} catch {
				// best effort — a malformed chunk must not fail the turn
			}
		})();

		// The sink seals the stream on normal completion (append rejects post-seal).
		await sink({ stream: sinkStream });
		await accumulated;

		// A stream that carried an error and never reached finish is a FAILED
		// turn — throw so executeRun finalizes failed (not a bogus "completed"
		// with an empty summary). A mid-stream error followed by a normal finish
		// stays a success.
		if (firstErrorText !== null && !sawFinish) {
			throw new Error(firstErrorText);
		}

		const usage = (await Promise.resolve(result.usage).catch(() => ({}))) as {
			inputTokens?: number;
			outputTokens?: number;
		};
		// The single resume-state persist: the turn is complete, so detach() is
		// legitimate; saveResumeState writes harnessResumeState epoch-guarded.
		const resumeState = await resumed
			.detachAndPersist()
			.catch(() => run.harnessResumeState ?? null);

		const plainMessage = finalMessage ? toPlainJson(finalMessage) : null;
		return {
			messageId,
			summary: summaryText.trim() || null,
			tokensInput: usage.inputTokens ?? 0,
			tokensOutput: usage.outputTokens ?? 0,
			resumeState: toPlainJson(resumeState),
			uiMessages: plainMessage ? [plainMessage] : [],
		};
	} finally {
		clearTimeout(runTimeout);
		for (const timer of timers) clearInterval(timer);
	}
}
