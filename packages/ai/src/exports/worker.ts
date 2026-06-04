import * as os from "node:os";

import { generateSecret } from "../server/modules/ai/services/worker-manager.js";
import { executeRun } from "../server/worker/execute-run.js";
import {
	createSpawnAgentRunner,
	prepareWorkerVolume,
	type DirectSpawnRuntime,
} from "../server/worker/spawn-agent-runner.js";

export interface EmbeddedWorkerConfig {
	runtimes: { runtime: DirectSpawnRuntime; binaryPath?: string }[];
	maxConcurrentRuns?: number;
	workerDir?: string;
	mcpServers?: unknown[];
	name?: string;
	pollIntervalMs?: number;
}

export async function startAIWorker(
	// A resolved system context — workerManager is read from ctx.services,
	// which exists on a context but not on the bare app instance.
	ctx: any,
	config: EmbeddedWorkerConfig,
): Promise<{ stop(): Promise<void>; workerId: string }> {
	const workerDir = config.workerDir ?? ".questpie/ai-worker";
	const volume = await prepareWorkerVolume(workerDir);
	const runner = createSpawnAgentRunner({
		workerDir,
		runtimes: config.runtimes,
		mcpServers: config.mcpServers,
	});

	const secret = generateSecret();
	const hostname = config.name ?? os.hostname();
	const workerManager = ctx.services?.workerManager;

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
	const activeRuns = new Set<Promise<void>>();
	const startExecution = (claimed: any) => {
		if (!claimed || !workerManager) return;
		const execution = executeRun(
			runner,
			workerManager,
			claimed,
			workerId,
		).finally(() => {
			activeRuns.delete(execution);
		});
		activeRuns.add(execution);
	};
	const pollLoop = async () => {
		while (true) {
			if (!running || !workerManager) break;
			try {
				await workerManager.heartbeat(workerId);
				while (running && activeRuns.size < maxConcurrentRuns) {
					const claimed = await workerManager.claimRun({
						workerId,
						runtimes: config.runtimes.map((r) => r.runtime),
						limit: 1,
					});
					if (!claimed) break;
					startExecution(claimed);
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

export type { DirectSpawnRuntime };
