import type { JobDefinition, PublishOptions } from "./types.js";

export interface QueueAdapterCapabilities {
  longRunningConsumer: boolean;
  runOnceConsumer: boolean;
  pushConsumer: boolean;
  scheduling: boolean;
  singleton: boolean;
}

export interface QueueJobRecord {
  id: string;
  data: unknown;
}

export interface QueueListenOptions {
  teamSize?: number;
  batchSize?: number;
}

export interface QueueRunOnceOptions {
  batchSize?: number;
  jobs?: string[];
}

export interface QueueRunOnceResult {
  processed: number;
}

export type QueueJobHandler = (job: QueueJobRecord) => Promise<void>;

export type QueueHandlerMap = Record<string, QueueJobHandler>;

export interface QueuePushMessage {
  id: string;
  body: unknown;
  ack: () => Promise<void>;
  retry: () => Promise<void>;
}

export interface QueuePushBatch {
  messages: QueuePushMessage[];
  ackAll?: () => Promise<void>;
  retryAll?: () => Promise<void>;
  raw?: unknown;
}

export type QueuePushConsumerHandler = (batch: QueuePushBatch) => Promise<void>;

export interface QueuePushConsumerFactoryArgs {
  handlers: QueueHandlerMap;
}

/**
 * Common interface for Queue Adapters (e.g. PgBoss, BullMQ)
 */
export interface QueueAdapter {
  /**
   * Capability flags used for runtime checks and multi-runtime support.
   */
  capabilities?: Partial<QueueAdapterCapabilities>;

  /**
   * Start the queue adapter (connect to DB/Redis, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop the queue adapter (close connections)
   */
  stop(): Promise<void>;

  /**
   * Publish a job to the queue
   */
  publish(
    jobName: string,
    payload: any,
    options?: PublishOptions,
  ): Promise<string | null>;

  /**
   * Schedule a recurring job with cron
   */
  schedule(
    jobName: string,
    cron: string,
    payload: any,
    options?: Omit<PublishOptions, "startAfter">,
  ): Promise<void>;

  /**
   * Cancel scheduled jobs for a specific job name
   */
  unschedule(jobName: string): Promise<void>;

  /**
   * Start long-running consumers (Node/Bun worker mode)
   */
  listen?(
    handlers: QueueHandlerMap,
    options?: QueueListenOptions,
  ): Promise<void>;

  /**
   * Process a single bounded batch (serverless-friendly tick mode).
   */
  runOnce?(
    handlers: QueueHandlerMap,
    options?: QueueRunOnceOptions,
  ): Promise<QueueRunOnceResult>;

  /**
   * Create push-based consumer handler (Cloudflare Queues style).
   */
  createPushConsumer?(
    args: QueuePushConsumerFactoryArgs,
  ): QueuePushConsumerHandler;

  /**
   * Listen for queue events
   */
  on(event: "error", handler: (error: Error) => void): void;
}
