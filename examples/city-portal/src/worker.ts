/**
 * Background Job Worker
 *
 * Runs in a separate process to handle background jobs (pg-boss queue).
 * Start with: bun run worker  (or bun run dev:worker for watch mode)
 */

import { app } from "#questpie";

async function startWorker() {
	console.log("[city-portal] Starting job worker...");

	try {
		await app.queue.listen({
			teamSize: 5,
			batchSize: 3,
		});

		console.log("[city-portal] Job worker started, listening for jobs...");
	} catch (error) {
		console.error("[city-portal] Failed to start job worker:", error);
		process.exit(1);
	}
}

startWorker();
