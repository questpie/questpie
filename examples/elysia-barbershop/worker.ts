/**
 * Background Job Worker
 *
 * Processes queue jobs in the background
 */

import { cms } from "./src/cms";

async function startWorker() {
	console.log("👷 Starting background job worker...\n");

	try {
		// Start listening to all jobs
		await cms.queue.listen({
			// Worker options
			teamSize: 10, // Number of concurrent jobs
			batchSize: 5, // Jobs to fetch at once
		});

		console.log("✅ Worker started successfully!");
		console.log("\nListening for jobs:");
		console.log("  • send-appointment-confirmation");
		console.log("  • send-appointment-cancellation");
		console.log("  • send-appointment-reminder");
		console.log("\nPress Ctrl+C to stop\n");
	} catch (error) {
		console.error("❌ Worker failed to start:", error);
		process.exit(1);
	}
}

startWorker();
