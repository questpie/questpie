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
	name?: string;
	pollIntervalMs?: number;
}

export async function startAIWorker(
	app: any,
	config: EmbeddedWorkerConfig,
): Promise<{ stop(): Promise<void>; workerId: string }> {
	const { generateSecret } =
		await import("../server/modules/ai/services/worker-manager.js");
	const os = await import("node:os");

	const workerDir = config.workerDir ?? ".questpie/ai-worker";
	const volume = await prepareWorkerVolume(workerDir);
	const runner = createSpawnAgentRunner({
		workerDir,
		runtimes: config.runtimes,
	});

	const secret = generateSecret();
	const hostname = config.name ?? os.hostname();
	const workerManager = app.services?.aiWorkerManager;

	let workerId = "embedded";
	if (workerManager) {
		const result = await workerManager.registerWorker({
			deviceId: `embedded:${volume.volumeId}`,
			name: typeof hostname === "string" ? hostname : "embedded",
			volumeId: volume.volumeId,
			capabilities: config.runtimes.map((r) => ({
				runtime: r.runtime,
				maxConcurrent: config.maxConcurrentRuns ?? 1,
			})),
			secret,
		});
		workerId = result.workerId;
	}

	let running = true;
	const pollLoop = async () => {
		while (true) {
			if (!running || !workerManager) break;
			try {
				await workerManager.heartbeat(workerId);
				const claimed = await workerManager.claimRun({
					workerId,
					runtimes: config.runtimes.map((r) => r.runtime),
					limit: 1,
				});

				if (claimed) {
					await executeRun(runner, workerManager, claimed, workerId);
				}
			} catch {}
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
