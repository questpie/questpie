import { AgentWorkloadAuthorityError } from "../authority/agent-workload-error.js";
import type { AgentWorkloadPrincipal } from "../authority/agent-workload-types.js";
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
	volumeId: string;
	mcpServers?: unknown[];
	/** Local-host sandbox settings forwarded to runHarnessRun (auth passthrough etc). */
	sandbox?: Parameters<typeof runHarnessRun>[0]["sandbox"];
	/** App-specific (autopilot) harness skill resolver — injected; optional. */
	resolveSkills?: (
		run: Record<string, unknown>,
	) => Promise<unknown[]> | unknown[];
	resolveWorkRoot?: (
		run: Record<string, unknown>,
		authority: { managedRoot: string; currentVolumeId: string },
	) => Promise<string | undefined> | string | undefined;
	/** Explicit Agent-authority gate. When configured, every claim must carry a
	 * sealed workloadAuthority; there is no legacy/system/requester fallback. */
	workloadBoundary?: AgentWorkloadExecutionBoundary;
	/** Narrow test/runtime adapter seam; defaults to the package Harness runner. */
	runHarness?: typeof runHarnessRun;
}

interface AgentWorkloadExecutionRequest {
	readonly authority: string;
	readonly fence: {
		readonly runId: string;
		readonly attemptId: string;
		readonly workerId: string;
		readonly leaseId: string;
		readonly leaseEpoch: number;
	};
}

export interface AgentWorkloadExecutionBoundary {
	start<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: (
			principal: AgentWorkloadPrincipal,
		) => Promise<TResult> | TResult,
	): Promise<TResult>;
	resume<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: (
			principal: AgentWorkloadPrincipal,
		) => Promise<TResult> | TResult,
	): Promise<TResult>;
	handoffResult<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: (
			principal: AgentWorkloadPrincipal,
		) => Promise<TResult> | TResult,
	): Promise<TResult>;
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

function buildWorkloadRequest(
	claimed: ClaimedRun,
	row: Record<string, unknown>,
): AgentWorkloadExecutionRequest | null {
	const workload = claimed.workloadAuthority;
	if (!workload) return null;
	const producerLease = isRecord(row.producerLease) ? row.producerLease : null;
	if (
		typeof workload.authority !== "string" ||
		workload.authority.length === 0 ||
		typeof workload.attemptId !== "string" ||
		workload.attemptId.length === 0 ||
		!producerLease ||
		typeof producerLease.workerId !== "string" ||
		typeof producerLease.leaseId !== "string" ||
		typeof producerLease.epoch !== "number" ||
		!Number.isSafeInteger(producerLease.epoch) ||
		claimed.lease.id !== producerLease.leaseId ||
		claimed.lease.runId !== String(row.id) ||
		claimed.epoch !== producerLease.epoch
	) {
		throw new AgentWorkloadAuthorityError("invalid_principal");
	}
	return {
		authority: workload.authority,
		fence: {
			runId: String(row.id),
			attemptId: workload.attemptId,
			workerId: producerLease.workerId,
			leaseId: producerLease.leaseId,
			leaseEpoch: producerLease.epoch,
		},
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
	if (!row) {
		if (deps.workloadBoundary || claimed.workloadAuthority) {
			throw new AgentWorkloadAuthorityError("invalid_principal");
		}
		return; // explicit generic legacy claim — no Agent-authority path configured
	}

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
	const workloadRequest = buildWorkloadRequest(claimed, row);
	if (Boolean(workloadRequest) !== Boolean(deps.workloadBoundary)) {
		throw new AgentWorkloadAuthorityError(
			workloadRequest ? "invalid_resolver_configuration" : "invalid_principal",
		);
	}
	const runHarness = deps.runHarness ?? runHarnessRun;
	let executionAuthorized = false;
	const handoff = async <TResult>(operation: () => Promise<TResult>) => {
		if (workloadRequest && deps.workloadBoundary) {
			return deps.workloadBoundary.handoffResult(workloadRequest, operation);
		}
		return operation();
	};
	const run = async () => {
		executionAuthorized = true;
		const managedWorkRoot = deps.resolveWorkRoot
			? await deps.resolveWorkRoot(row, {
					managedRoot: deps.workerDir,
					currentVolumeId: deps.volumeId,
				})
			: undefined;
		const skills = deps.resolveSkills
			? await deps.resolveSkills(row)
			: undefined;
		return runHarness({
			run: buildRunHarnessRow(row),
			collections: { run_links: deps.collections.run_links },
			kv: deps.kv,
			workerDir: managedWorkRoot ?? deps.workerDir,
			skills,
			mcpServers: deps.mcpServers,
			sandbox: deps.sandbox,
		});
	};
	let result: Awaited<ReturnType<typeof runHarness>>;
	try {
		const isResume = row.harnessResumeState != null;
		result =
			workloadRequest && deps.workloadBoundary
				? await (
						isResume
							? deps.workloadBoundary.resume
							: deps.workloadBoundary.start
					)(workloadRequest, async () => run())
				: await run();
	} catch (error) {
		if (workloadRequest && !executionAuthorized) throw error;
		await handoff(() =>
			finalizeRun(finalizeDeps, {
				runId,
				kind,
				terminal: "failed",
				epoch,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return;
	}

	await handoff(() =>
		finalizeRun(finalizeDeps, {
			runId,
			kind,
			terminal: "completed",
			epoch,
			summary: result.summary,
			tokensInput: result.tokensInput,
			tokensOutput: result.tokensOutput,
			messageId: result.messageId,
			resumeState: result.resumeState,
			uiMessages: result.uiMessages,
			chatSessionId: relationId(row.chatSession),
		}),
	);
}
