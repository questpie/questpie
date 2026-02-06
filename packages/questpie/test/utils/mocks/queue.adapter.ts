import type { PublishOptions } from "../../../src/exports/index.js";
import type {
  QueueAdapter,
  QueueHandlerMap,
  QueueListenOptions,
  QueueRunOnceOptions,
  QueueRunOnceResult,
} from "../../../src/server/integrated/queue/adapter.js";

export interface MockJob {
  id: string;
  name: string;
  payload: any;
  options?: PublishOptions;
  publishedAt: Date;
}

export interface MockScheduledJob {
  name: string;
  cron: string;
  payload: any;
  options?: Omit<PublishOptions, "startAfter">;
}

export interface MockWorker {
  handlers: QueueHandlerMap;
  options?: { teamSize?: number; batchSize?: number };
}

/**
 * Mock Queue Adapter for testing
 * Provides full type safety and test utilities for inspecting queue state
 */
export class MockQueueAdapter implements QueueAdapter {
  public readonly capabilities = {
    longRunningConsumer: true,
    runOnceConsumer: true,
    pushConsumer: false,
    scheduling: true,
    singleton: false,
  } as const;

  private jobs: MockJob[] = [];
  private scheduledJobs: MockScheduledJob[] = [];
  private workers: MockWorker[] = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  /**
   * Get all published jobs (test utility)
   */
  getJobs(): MockJob[] {
    return [...this.jobs];
  }

  /**
   * Get jobs by name (test utility)
   */
  getJobsByName(name: string): MockJob[] {
    return this.jobs.filter((job) => job.name === name);
  }

  /**
   * Get all scheduled jobs (test utility)
   */
  getScheduledJobs(): MockScheduledJob[] {
    return [...this.scheduledJobs];
  }

  /**
   * Get scheduled job by name (test utility)
   */
  getScheduledJob(name: string): MockScheduledJob | undefined {
    return this.scheduledJobs.find((job) => job.name === name);
  }

  /**
   * Get all registered workers (test utility)
   */
  getWorkers(): MockWorker[] {
    return [...this.workers];
  }

  /**
   * Clear all jobs and scheduled jobs (test utility)
   */
  clearJobs(): void {
    this.jobs = [];
    this.scheduledJobs = [];
  }

  /**
   * Process a job manually (test utility)
   */
  async processJob(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const worker = this.workers.find((w) => !!w.handlers[job.name]);
    const handler = worker?.handlers[job.name];
    if (!handler) {
      throw new Error(`No worker registered for job: ${job.name}`);
    }

    await handler({ id: job.id, data: job.payload });
  }

  /**
   * Process all pending jobs (test utility)
   */
  async processAllJobs(): Promise<void> {
    for (const job of this.jobs) {
      const worker = this.workers.find((w) => !!w.handlers[job.name]);
      const handler = worker?.handlers[job.name];
      if (handler) {
        try {
          await handler({ id: job.id, data: job.payload });
        } catch (error) {
          for (const handler of this.errorHandlers) {
            handler(error as Error);
          }
        }
      }
    }
  }

  async start(): Promise<void> {
    // this.started = true;
  }

  async stop(): Promise<void> {
    // this.started = false;
    this.jobs = [];
    this.scheduledJobs = [];
    this.workers = [];
    this.errorHandlers = [];
  }

  async publish(
    jobName: string,
    payload: any,
    options?: PublishOptions,
  ): Promise<string | null> {
    const job: MockJob = {
      id: crypto.randomUUID(),
      name: jobName,
      payload,
      options,
      publishedAt: new Date(),
    };

    this.jobs.push(job);
    return job.id;
  }

  async schedule(
    jobName: string,
    cron: string,
    payload: any,
    options?: Omit<PublishOptions, "startAfter">,
  ): Promise<void> {
    // Remove existing scheduled job with same name
    this.scheduledJobs = this.scheduledJobs.filter(
      (job) => job.name !== jobName,
    );

    this.scheduledJobs.push({
      name: jobName,
      cron,
      payload,
      options,
    });
  }

  async unschedule(jobName: string): Promise<void> {
    this.scheduledJobs = this.scheduledJobs.filter(
      (job) => job.name !== jobName,
    );
  }

  async listen(
    handlers: QueueHandlerMap,
    options?: QueueListenOptions,
  ): Promise<void> {
    this.workers.push({
      handlers,
      options,
    });
  }

  async runOnce(
    handlers: QueueHandlerMap,
    options?: QueueRunOnceOptions,
  ): Promise<QueueRunOnceResult> {
    const selectedNames =
      options?.jobs && options.jobs.length > 0 ? new Set(options.jobs) : null;
    const max = Math.max(1, (options?.batchSize ?? this.jobs.length) || 1);

    let processed = 0;
    for (const job of this.jobs) {
      if (processed >= max) break;
      if (selectedNames && !selectedNames.has(job.name)) continue;

      const handler = handlers[job.name];
      if (!handler) continue;

      await handler({ id: job.id, data: job.payload });
      processed += 1;
    }

    return { processed };
  }

  on(event: "error", handler: (error: Error) => void): void {
    if (event === "error") {
      this.errorHandlers.push(handler);
    }
  }
}
