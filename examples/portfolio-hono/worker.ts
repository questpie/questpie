/**
 * Background Job Worker
 *
 * Runs in a separate process to handle background jobs.
 * Start with: bun run worker.ts
 */

import { cms } from "./src/cms";

async function startWorker() {
	console.log("Starting job worker...");

	try {
		await cms.listenToJobs({
			teamSize: 5, // Concurrent jobs
			batchSize: 3, // Jobs to fetch at once
		});

		console.log("Job worker started successfully");
		console.log("Listening for jobs: contact-notification, notify-new-project");
	} catch (error) {
		console.error("Failed to start job worker:", error);
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
	console.log("\nShutting down worker...");
	await cms.queue._stop();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\nShutting down worker...");
	await cms.queue._stop();
	process.exit(0);
});

startWorker();
