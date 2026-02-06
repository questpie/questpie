/**
 * Background Job Worker
 *
 * Runs in a separate process to handle background jobs.
 * Start with: bun run worker.ts
 */

import { cms } from "@/questpie/server/cms";

async function startWorker() {
  console.log("Starting job worker...");

  try {
    await cms.queue.listen({
      teamSize: 5, // Concurrent jobs
      batchSize: 3, // Jobs to fetch at once
    });

    console.log("Job worker started successfully");
    console.log("Listening for jobs...");
  } catch (error) {
    console.error("Failed to start job worker:", error);
    process.exit(1);
  }
}

startWorker();
