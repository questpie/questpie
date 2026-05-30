import type {
	ClaimedRun,
	CompleteRunInput,
	SpawnAgentRunner,
} from "../modules/ai/lib/execution-contract.js";

interface WorkerManagerForExecution {
	reportRunEvent(input: {
		runId: string;
		event: Record<string, unknown>;
	}): Promise<void>;
	completeRun(input: CompleteRunInput): Promise<void>;
	failRun(input: {
		runId: string;
		workerId: string;
		error: unknown;
	}): Promise<void>;
}

export async function executeRun(
	runner: SpawnAgentRunner,
	workerManager: WorkerManagerForExecution,
	claimed: ClaimedRun,
	workerId: string,
) {
	try {
		const handle = await runner.run({
			...claimed.spawn,
			metadata: { ...claimed.spawn.metadata, runId: claimed.lease.runId },
		});

		let sequence = 0;

		for await (const event of handle.events) {
			await workerManager.reportRunEvent({
				runId: claimed.lease.runId,
				event: { ...event, sequence: sequence++ },
			});
		}

		const result = await handle.completion;
		await workerManager.completeRun({
			runId: claimed.lease.runId,
			workerId,
			result: result as CompleteRunInput["result"],
		});
	} catch (error) {
		await workerManager.failRun({
			runId: claimed.lease.runId,
			workerId,
			error,
		});
	}
}
