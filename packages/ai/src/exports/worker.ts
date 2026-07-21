import * as os from "node:os";

import type {
	AgentWorkloadClaimAuthority,
	ClaimedRun,
} from "../server/modules/ai/lib/execution-contract.js";
import type { HarnessCoreRuntime } from "../server/modules/ai/lib/harness-core.js";
import { generateSecret } from "../server/modules/ai/services/worker-manager.js";
import {
	executeRun,
	type ExecuteRunDeps,
} from "../server/worker/execute-run.js";
import { prepareWorkerVolume } from "../server/worker/worker-volume.js";

// Public worker-entry alias for the harness-core runtime union (the legacy
// harness-agent-runner that used to own this name is deleted).
export type HarnessRuntime = HarnessCoreRuntime;
export type { AgentWorkloadClaimAuthority, ClaimedRun };

export interface WorkerWorkRootAuthority {
	managedRoot: string;
	currentVolumeId: string;
}

export interface EmbeddedWorkerConfig {
	runtimes: { runtime: HarnessRuntime; binaryPath?: string }[];
	maxConcurrentRuns?: number;
	workerDir?: string;
	mcpServers?: unknown[];
	/** Local-host sandbox settings (e.g. passthroughHomeForAuth for a personal machine). */
	sandbox?: ExecuteRunDeps["sandbox"];
	name?: string;
	pollIntervalMs?: number;
	/** App-specific harness skill resolver (autopilot buildHarnessSkills). */
	resolveSkills?: (
		run: Record<string, unknown>,
	) => Promise<unknown[]> | unknown[];
	/**
	 * App-owned claim-time authority resolver. Return undefined only for generic
	 * non-project runs that should use the worker-owned default directory.
	 */
	resolveWorkRoot?: (
		run: Record<string, unknown>,
		authority: WorkerWorkRootAuthority,
	) => Promise<string | undefined> | string | undefined;
	/** Executor-audience authority gate for Agent claims. Configuring it makes
	 * missing workload authority fail closed; generic legacy claims stay on the
	 * separate unconfigured path. */
	workloadBoundary?: ExecuteRunDeps["workloadBoundary"];
	/** Mint/obtain the signed opaque authority only after this exact Worker has
	 * received its lease. Worker identity is transport provenance, not authority. */
	resolveWorkloadAuthority?: (
		claimed: ClaimedRun,
		transport: { readonly workerId: string },
	) => Promise<AgentWorkloadClaimAuthority> | AgentWorkloadClaimAuthority;
}

export async function startAIWorker(
	// A resolved system context — workerManager is read from ctx.services,
	// which exists on a context but not on the bare app instance.
	ctx: any,
	config: EmbeddedWorkerConfig,
): Promise<{ stop(): Promise<void>; workerId: string }> {
	const workerDir = config.workerDir ?? ".questpie/ai-worker";
	const volume = await prepareWorkerVolume(workerDir);

	const secret = generateSecret();
	const hostname = config.name ?? os.hostname();
	const workerManager = ctx.services?.workerManager;
	const workflows = ctx.workflows;

	// runHarnessRun + finalizeRun execute against run_links via the worker's
	// system-context (collections/kv) + injected autopilot deps (workflows /
	// knowledgeResource / skills).
	const executeDeps: ExecuteRunDeps = {
		collections: ctx.collections,
		kv: ctx.kv,
		workflows,
		knowledgeResource: ctx.services?.knowledgeResource,
		workerDir,
		mcpServers: config.mcpServers,
		sandbox: config.sandbox,
		resolveSkills: config.resolveSkills,
		resolveWorkRoot: config.resolveWorkRoot,
		volumeId: volume.volumeId,
		workloadBoundary: config.workloadBoundary,
	};

	let workerId = "embedded";
	const maxConcurrentRuns =
		typeof config.maxConcurrentRuns === "number" &&
		Number.isFinite(config.maxConcurrentRuns) &&
		config.maxConcurrentRuns > 0
			? Math.floor(config.maxConcurrentRuns)
			: 1;
	if (workerManager) {
		const result = await workerManager.registerWorker({
			deviceId: `embedded:${volume.volumeId}`,
			name: typeof hostname === "string" ? hostname : "embedded",
			volumeId: volume.volumeId,
			capabilities: config.runtimes.map((r) => ({
				runtime: r.runtime,
				maxConcurrent: maxConcurrentRuns,
			})),
			secret,
		});
		workerId = result.workerId;
	}

	let running = true;
	const activeRuns = new Map<Promise<void>, HarnessRuntime>();
	const runtimes = Array.from(new Set(config.runtimes.map((r) => r.runtime)));
	const activeRunsForRuntime = (runtime: HarnessRuntime) => {
		let count = 0;
		for (const activeRuntime of activeRuns.values()) {
			if (activeRuntime === runtime) count++;
		}
		return count;
	};
	const startExecution = (claimed: ClaimedRun | null) => {
		if (!claimed || !workerManager) return;
		const runtime = claimed.spawn?.runtime as HarnessRuntime | undefined;
		if (!runtime) return;
		const execution = (async () => {
			const workloadAuthority = config.resolveWorkloadAuthority
				? await config.resolveWorkloadAuthority(claimed, { workerId })
				: claimed.workloadAuthority;
			await executeRun(executeDeps, {
				...claimed,
				workloadAuthority,
			});
		})().finally(() => {
			activeRuns.delete(execution);
		});
		activeRuns.set(execution, runtime);
	};
	const pollLoop = async () => {
		while (true) {
			if (!running || !workerManager) break;
			try {
				await workerManager.heartbeat(workerId);
				for (const runtime of runtimes) {
					while (running && activeRunsForRuntime(runtime) < maxConcurrentRuns) {
						const claimed = await workerManager.claimRun({
							workerId,
							runtimes: [runtime],
							limit: 1,
						});
						if (!claimed) break;
						// Emit run.claimed BEFORE run.completed so the task-pipeline
						// workflow's waitForEvent('run.claimed') resolves (the kept
						// chat-status mirror never emits it).
						if (claimed.run && workflows?.sendEvent) {
							void Promise.resolve(
								workflows.sendEvent(
									"run.claimed",
									{ runId: claimed.lease.runId, workerId },
									{ runId: claimed.lease.runId },
								),
							).catch(() => {});
						}
						startExecution(claimed);
					}
				}
			} catch {
				// Transient heartbeat/claim/execute error — stay alive and
				// retry on the next tick rather than killing the worker.
			}
			await new Promise((resolve) =>
				setTimeout(resolve, config.pollIntervalMs ?? 5000),
			);
		}
	};

	void pollLoop();

	return {
		workerId,
		async stop() {
			running = false;
			if (workerManager) {
				await workerManager.deregister(workerId);
			}
		},
	};
}
