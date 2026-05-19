import { executeRun } from "../server/worker/execute-run.js";

export type DirectSpawnRuntime = "claude-code" | "codex";

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
	const { createDaemon } = await import("@questpie/agent-runtime/worker");
	const { generateSecret } =
		await import("../server/modules/ai/services/worker-manager.js");
	const os = await import("node:os");

	const adapters = await Promise.all(
		config.runtimes.map(async (r) => {
			if (r.runtime === "codex") {
				const { createCodexAdapter } =
					await import("@questpie/agent-runtime/adapters/codex");
				return createCodexAdapter();
			}
			const { createClaudeCodeAdapter } =
				await import("@questpie/agent-runtime/adapters/claude-code");
			return createClaudeCodeAdapter();
		}),
	);

	const daemon = createDaemon(
		{
			workerDir: config.workerDir ?? ".questpie/ai-worker",
			runtimes: config.runtimes.map((r) => ({
				runtime: r.runtime,
				binaryPath: r.binaryPath,
			})),
			pollIntervalMs: config.pollIntervalMs ?? 5000,
		},
		adapters,
	);

	await daemon.start();

	const secret = generateSecret();
	const hostname = config.name ?? os.hostname();
	const workerManager = app.services?.aiWorkerManager;

	let workerId = "embedded";
	if (workerManager) {
		const result = await workerManager.registerWorker({
			deviceId: `embedded:${daemon.volumeId}`,
			name: typeof hostname === "string" ? hostname : "embedded",
			volumeId: daemon.volumeId,
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
					await executeRun(daemon, workerManager, claimed, workerId);
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
			await daemon.stop();
		},
	};
}
