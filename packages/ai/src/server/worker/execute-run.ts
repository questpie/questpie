export async function executeRun(
	daemon: any,
	workerManager: any,
	claimed: any,
	workerId: string,
) {
	try {
		const handle = await daemon.submit({
			type: "message.send",
			runtime: claimed.runtime,
			prompt: claimed.prompt,
			sessionRef: claimed.runtimeSessionRef,
			priority: 100,
			meta: { runId: claimed.runId },
		});

		let sequence = 0;

		for await (const event of handle.events) {
			await workerManager.reportRunEvent({
				runId: claimed.runId,
				event: { ...event, sequence: sequence++ },
			});
		}

		const result = await handle.completion;
		await workerManager.completeRun({
			runId: claimed.runId,
			workerId,
			result,
		});
	} catch (error) {
		await workerManager.failRun({
			runId: claimed.runId,
			workerId,
			error,
		});
	}
}
