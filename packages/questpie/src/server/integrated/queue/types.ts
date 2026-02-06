import type { z } from "zod";
// Note: any, any, and any are deprecated.
// Users should use getApp<AppCMS>(), getDb<AppCMS>(), and getSession<AppCMS>() instead.
import type {
  QueueAdapter,
  QueueAdapterCapabilities,
  QueueListenOptions,
  QueuePushConsumerHandler,
  QueueRunOnceOptions,
  QueueRunOnceResult,
} from "./adapter.js";

// Re-export QueueAdapter for external use
export type { QueueAdapter } from "./adapter.js";

// ============================================================================
// Job Handler Context
// ============================================================================

/**
 * Context for job handlers.
 *
 * @template TPayload - The job payload type (from schema)
 * @template TApp - The CMS app type (defaults to any)
 *
 * @example
 * ```ts
 * import { getApp } from "questpie";
 * import type { AppCMS } from "./cms";
 *
 * const sendEmailJob = q.job({
 *   name: 'send-email',
 *   schema: z.object({ to: z.string(), subject: z.string() }),
 *   handler: async ({ payload, app }) => {
 *     const cms = getApp<AppCMS>(app);
 *     await cms.email.send({
 *       to: payload.to,
 *       subject: payload.subject,
 *       html: '<p>Hello</p>'
 *     });
 *   }
 * })
 * ```
 */
export interface JobHandlerArgs<TPayload = any, TApp = any> {
  /** Validated job payload */
  payload: TPayload;
  /** CMS instance - use getApp<AppCMS>(app) for type-safe access */
  app: TApp;
  /**
   * Auth session (user + session) - typically undefined for background jobs.
   * May be set if job was scheduled from authenticated request context.
   * Use getSession<AppCMS>(session) for type-safe access.
   */
  session?: any | null;
  /** Current locale */
  locale?: string;
  /** Database client - use getDb<AppCMS>(db) for type-safe access */
  db: any;
}

/**
 * Job definition with typesafe payload and result
 *
 * @template TPayload - The job payload type
 * @template TResult - The job result type
 * @template TName - The job name (literal string type)
 * @template TApp - The CMS app type (defaults to any from module augmentation)
 */
export interface JobDefinition<
  TPayload = any,
  TResult = void,
  TName extends string = string,
  TApp = any,
> {
  /**
   * Unique name for this job
   */
  name: TName;

  /**
   * Zod schema for payload validation
   */
  schema: z.ZodSchema<TPayload>;

  /**
   * Job handler function
   */
  handler: (args: JobHandlerArgs<TPayload, TApp>) => Promise<TResult>;

  /**
   * Optional job options (adapter agnostic where possible)
   */
  options?: {
    /**
     * Priority (higher = more important)
     */
    priority?: number;

    /**
     * Number of retry attempts
     */
    retryLimit?: number;

    /**
     * Delay between retries in seconds
     */
    retryDelay?: number;

    /**
     * Use exponential backoff for retries
     */
    retryBackoff?: boolean;

    /**
     * Job expiration in seconds
     */
    expireInSeconds?: number;

    /**
     * Start job after this delay (seconds)
     */
    startAfter?: number | string | Date;

    /**
     * Cron expression for recurring jobs
     */
    cron?: string;
  };
}

/**
 * Infer payload type from job definition
 */
export type InferJobPayload<T> =
  T extends JobDefinition<infer P, any, any> ? P : never;

/**
 * Infer result type from job definition
 */
export type InferJobResult<T> =
  T extends JobDefinition<any, infer R, any> ? R : never;

/**
 * Publish options for jobs
 */
export interface PublishOptions {
  /**
   * Priority (higher = more important)
   */
  priority?: number;

  /**
   * Start job after this delay (seconds)
   */
  startAfter?: number | string | Date;

  /**
   * Singleton key - only one job with this key can be queued
   */
  singletonKey?: string;

  /**
   * Number of retry attempts (overrides job default)
   */
  retryLimit?: number;

  /**
   * Delay between retries in seconds (overrides job default)
   */
  retryDelay?: number;

  /**
   * Use exponential backoff for retries (overrides job default)
   */
  retryBackoff?: boolean;

  /**
   * Job expiration in seconds (overrides job default)
   */
  expireInSeconds?: number;
}

/**
 * Extract job names from job definitions map
 */
export type JobNames<TJobs extends Record<string, JobDefinition<any, any>>> =
  keyof TJobs;

/**
 * Get specific job by name from jobs map
 */
export type GetJob<
  TJobs extends Record<string, JobDefinition<any, any>>,
  Name extends JobNames<TJobs>,
> = TJobs[Name];

/**
 * Queue configuration
 */
export interface QueueConfig<
  TJobs extends Record<string, JobDefinition<any, any>> = Record<
    string,
    JobDefinition<any, any>
  >,
> {
  /**
   * Job definitions map
   */
  jobs: TJobs;

  /**
   * Queue Adapter instance
   */
  adapter: QueueAdapter;
}

export interface QueueListenRuntimeOptions extends QueueListenOptions {
  /**
   * Register automatic graceful shutdown handlers for worker process.
   * @default true
   */
  gracefulShutdown?: boolean;

  /**
   * Process signals that trigger graceful shutdown.
   * @default ["SIGINT", "SIGTERM"]
   */
  shutdownSignals?: string[];

  /**
   * Max time to wait for queue adapter stop before forcing exit (ms).
   * @default 10000
   */
  shutdownTimeoutMs?: number;
}

export interface QueueRegisterSchedulesOptions {
  jobs?: string[];
}

export interface QueueListenHandle {
  stop: () => Promise<void>;
}

/**
 * Typesafe queue client for publishing jobs
 */
export type QueueClient<TJobs extends Record<string, JobDefinition<any, any>>> =
  {
    [K in keyof TJobs]: {
      /**
       * Publish a job to the queue
       */
      publish: (
        payload: InferJobPayload<TJobs[K]>,
        options?: PublishOptions,
      ) => Promise<string | null>;

      /**
       * Schedule a recurring job with cron
       */
      schedule: (
        payload: InferJobPayload<TJobs[K]>,
        cron: string,
        options?: Omit<PublishOptions, "startAfter">,
      ) => Promise<void>;

      /**
       * Cancel scheduled jobs
       */
      unschedule: () => Promise<void>;
    };
  } & {
    /**
     * Adapter capabilities exposed to runtime.
     */
    capabilities: QueueAdapterCapabilities;

    /**
     * Start long-running queue consumers.
     */
    listen: (options?: QueueListenRuntimeOptions) => Promise<QueueListenHandle>;

    /**
     * Process one bounded batch of jobs.
     */
    runOnce: (options?: QueueRunOnceOptions) => Promise<QueueRunOnceResult>;

    /**
     * Register recurring cron schedules declared in job options.
     */
    registerSchedules: (
      options?: QueueRegisterSchedulesOptions,
    ) => Promise<void>;

    /**
     * Stop all running queue consumers and adapter.
     */
    stop: () => Promise<void>;

    /**
     * Create push consumer handler (for runtimes like Cloudflare Queues).
     */
    createPushConsumer: () => QueuePushConsumerHandler;

    /**
     * Access to underlying Queue Adapter
     */
    _adapter: QueueAdapter;

    /**
     * Start the queue (called automatically)
     */
    _start: () => Promise<void>;

    /**
     * Stop the queue
     */
    _stop: () => Promise<void>;
  };
