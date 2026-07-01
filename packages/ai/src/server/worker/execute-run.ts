import type { ClaimedRun } from "../modules/ai/lib/execution-contract.js";
import {
	createQuestpieResumableStreamStore,
	type QuestpieKVLike,
} from "../modules/ai/lib/questpie-resumable-streams.js";
import { finalizeRun, type FinalizeRunDeps } from "./finalize-run.js";
import { runHarnessRun, type RunHarnessRow } from "./run-harness.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.id === "string") return value.id;
	return null;
}

export interface ExecuteRunDeps {
	collections: {
		run_links: {
			update(args: {
				where: unknown;
				data: Record<string, unknown>;
			}): Promise<unknown>;
			findOne(args: {
				where: unknown;
			}): Promise<Record<string, unknown> | null | undefined>;
		};
		chat_messages?: { create(data: Record<string, unknown>): Promise<unknown> };
	};
	kv: QuestpieKVLike;
	workflows?: FinalizeRunDeps["workflows"];
	knowledgeResource?: FinalizeRunDeps["knowledgeResource"];
	workerDir: string;
	mcpServers?: unknown[];
	/** App-specific (autopilot) harness skill resolver — injected; optional. */
	resolveSkills?: (
		run: Record<string, unknown>,
	) => Promise<unknown[]> | unknown[];
}

function buildRunHarnessRow(row: Record<string, unknown>): RunHarnessRow {
	return {
		id: String(row.id),
		activeStreamId: String(row.activeStreamId ?? ""),
		runtime: String(row.runtime ?? "claude-code"),
		instructions: String(row.instructions ?? ""),
		harnessSessionId:
			typeof row.harnessSessionId === "string" ? row.harnessSessionId : null,
		harnessResumeState: row.harnessResumeState,
		producerLease: isRecord(row.producerLease)
			? (row.producerLease as unknown as RunHarnessRow["producerLease"])
			: null,
		metadata: isRecord(row.metadata)
			? (row.metadata as unknown as RunHarnessRow["metadata"])
			: null,
	};
}

/**
 * Run one claimed run_links turn: runHarnessRun (the streaming core) → the ONE
 * finalizeRun. On a harness throw, finalize as failed. The terminal status /
 * run.completed / kind side-effects all happen exactly once via the finalizeRun
 * latch (fenced on producerLease.epoch).
 */
export async function executeRun(
	deps: ExecuteRunDeps,
	claimed: ClaimedRun,
): Promise<void> {
	const row = claimed.run;
	if (!row) return; // legacy claim without a run_links row — nothing to run

	const runId = String(row.id);
	const epoch =
		claimed.epoch ??
		(isRecord(row.producerLease) && typeof row.producerLease.epoch === "number"
			? row.producerLease.epoch
			: 0);
	const kind = typeof row.kind === "string" ? row.kind : null;

	const streamStore = createQuestpieResumableStreamStore({ kv: deps.kv });
	const finalizeDeps: FinalizeRunDeps = {
		collections: deps.collections,
		streamStore,
		workflows: deps.workflows,
		knowledgeResource: deps.knowledgeResource,
	};

	try {
		const skills = deps.resolveSkills
			? await deps.resolveSkills(row)
			: undefined;
		const result = await runHarnessRun({
			run: buildRunHarnessRow(row),
			collections: { run_links: deps.collections.run_links },
			kv: deps.kv,
			workerDir: deps.workerDir,
			skills,
			mcpServers: deps.mcpServers,
		});
		await finalizeRun(finalizeDeps, {
			runId,
			kind,
			terminal: "completed",
			epoch,
			summary: result.summary,
			tokensInput: result.tokensInput,
			tokensOutput: result.tokensOutput,
			messageId: result.messageId,
			resumeState: result.resumeState,
			chatSessionId: relationId(row.chatSession),
		});
	} catch (error) {
		await finalizeRun(finalizeDeps, {
			runId,
			kind,
			terminal: "failed",
			epoch,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
