import type {
  JobDefinition,
  QueueClient,
  QueueListenRuntimeOptions,
} from "./types.js";

/**
 * Worker options for long-running queue consumers.
 */
export type WorkerOptions = QueueListenRuntimeOptions;

/**
 * Start long-running queue consumers.
 *
 * Breaking change: worker startup is now delegated to `queueClient.listen()`.
 */
export async function startJobWorker<
  TJobs extends Record<string, JobDefinition<any, any>>,
>(queueClient: QueueClient<TJobs>, options?: WorkerOptions): Promise<void> {
  await queueClient.listen(options);
}

/**
 * Process one bounded queue batch (serverless tick mode).
 */
export async function runJobWorkerOnce<
  TJobs extends Record<string, JobDefinition<any, any>>,
>(
  queueClient: QueueClient<TJobs>,
  options?: { batchSize?: number; jobs?: string[] },
): Promise<{ processed: number }> {
  return queueClient.runOnce(options);
}
