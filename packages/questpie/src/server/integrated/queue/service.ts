import type {
  QueueAdapter,
  QueueAdapterCapabilities,
  QueueHandlerMap,
  QueueListenOptions,
  QueuePushConsumerHandler,
  QueueRunOnceOptions,
} from "./adapter.js";
import type {
  JobDefinition,
  PublishOptions,
  QueueClient,
  QueueListenRuntimeOptions,
  QueueRegisterSchedulesOptions,
} from "./types.js";

type QueueRuntimeContext = {
  session?: unknown;
  locale?: string;
  db?: unknown;
};

type QueueLogger = {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
};

export interface QueueClientRuntimeOptions {
  createContext?: () => Promise<QueueRuntimeContext>;
  getApp?: () => unknown;
  logger?: QueueLogger;
}

const defaultLogger: QueueLogger = {
  info: (msg, ...args) => console.log(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
};

function resolveCapabilities(adapter: QueueAdapter): QueueAdapterCapabilities {
  return {
    longRunningConsumer:
      adapter.capabilities?.longRunningConsumer ?? !!adapter.listen,
    runOnceConsumer: adapter.capabilities?.runOnceConsumer ?? !!adapter.runOnce,
    pushConsumer:
      adapter.capabilities?.pushConsumer ?? !!adapter.createPushConsumer,
    scheduling:
      adapter.capabilities?.scheduling ??
      (typeof adapter.schedule === "function" &&
        typeof adapter.unschedule === "function"),
    singleton: adapter.capabilities?.singleton ?? false,
  };
}

function normalizeSelectedJobs<
  TJobs extends Record<string, JobDefinition<any, any>>,
>(jobs: TJobs, selected?: string[]): TJobs {
  if (!selected || selected.length === 0) return jobs;

  const selectedSet = new Set(selected);
  const filteredEntries = Object.entries(jobs).filter(
    ([registrationKey, jobDef]) =>
      selectedSet.has(registrationKey) || selectedSet.has(jobDef.name),
  );

  return Object.fromEntries(filteredEntries) as TJobs;
}

function buildWorkOptions(
  options?: QueueListenRuntimeOptions,
): QueueListenOptions | undefined {
  if (!options?.teamSize && !options?.batchSize) {
    return undefined;
  }

  return {
    teamSize: options.teamSize,
    batchSize: options.batchSize,
  };
}

/**
 * Create a typesafe queue client from job definitions
 *
 * @internal Used by Questpie to create the queue instance
 */
export function createQueueClient<
  TJobs extends Record<string, JobDefinition<any, any>>,
>(
  jobs: TJobs,
  adapter: QueueAdapter,
  runtimeOptions: QueueClientRuntimeOptions = {},
): QueueClient<TJobs> {
  const logger = runtimeOptions.logger ?? defaultLogger;
  const capabilities = resolveCapabilities(adapter);

  // Track if started
  let started = false;
  let signalCleanup: (() => void) | undefined;
  let shutdownInProgress = false;

  // Auto-start helper
  const ensureStarted = async () => {
    if (!started) {
      await adapter.start();
      started = true;
    }
  };

  // Error handling
  adapter.on("error", (error: Error) => {
    logger.error("[QUESTPIE Queue] Adapter error:", error);
  });

  const getContextOrThrow = async () => {
    if (!runtimeOptions.createContext) {
      throw new Error(
        "QUESTPIE Queue: createContext is not configured. Queue consumer methods must be called from a built CMS instance.",
      );
    }
    return runtimeOptions.createContext();
  };

  const getAppOrThrow = () => {
    if (!runtimeOptions.getApp) {
      throw new Error(
        "QUESTPIE Queue: app resolver is not configured. Queue consumer methods must be called from a built CMS instance.",
      );
    }
    return runtimeOptions.getApp();
  };

  const buildHandlers = (selectedJobs?: TJobs): QueueHandlerMap => {
    const sourceJobs = selectedJobs ?? jobs;
    const handlers: QueueHandlerMap = {};

    for (const jobDef of Object.values(sourceJobs)) {
      handlers[jobDef.name] = async (job) => {
        const context = await getContextOrThrow();
        const validated = jobDef.schema.parse(job.data);
        await jobDef.handler({
          payload: validated,
          app: getAppOrThrow() as any,
          session: context.session,
          locale: context.locale,
          db: context.db,
        });
      };
    }

    return handlers;
  };

  const registerSchedules = async (options?: QueueRegisterSchedulesOptions) => {
    await ensureStarted();

    if (!capabilities.scheduling || !adapter.schedule) {
      if (options?.jobs && options.jobs.length > 0) {
        throw new Error(
          "QUESTPIE Queue: selected adapter does not support scheduling.",
        );
      }
      return;
    }

    const selectedJobs = normalizeSelectedJobs(jobs, options?.jobs);
    for (const jobDef of Object.values(selectedJobs)) {
      if (!jobDef.options?.cron) continue;

      let schedulePayload: unknown;
      try {
        schedulePayload = jobDef.schema.parse({});
      } catch (error) {
        throw new Error(
          `QUESTPIE Queue: Job "${jobDef.name}" has cron schedule but schema does not accept an empty payload.`,
          { cause: error },
        );
      }

      const { cron, startAfter, ...scheduleOptions } = jobDef.options ?? {};
      await adapter.schedule(
        jobDef.name,
        jobDef.options.cron,
        schedulePayload,
        scheduleOptions,
      );
    }
  };

  const stopInternal = async () => {
    signalCleanup?.();
    signalCleanup = undefined;
    shutdownInProgress = false;

    if (started) {
      await adapter.stop();
      started = false;
    }
  };

  const setupGracefulShutdown = (options?: QueueListenRuntimeOptions) => {
    const enabled = options?.gracefulShutdown ?? true;
    if (!enabled) return;
    if (typeof process === "undefined" || typeof process.on !== "function") {
      return;
    }

    signalCleanup?.();

    const signals =
      options?.shutdownSignals && options.shutdownSignals.length > 0
        ? options.shutdownSignals
        : ["SIGINT", "SIGTERM"];
    const timeoutMs = Math.max(0, options?.shutdownTimeoutMs ?? 10000);

    const handlers = new Map<string, () => void>();
    for (const signal of signals) {
      const onSignal = () => {
        if (shutdownInProgress) return;
        shutdownInProgress = true;

        logger.info(
          `[QUESTPIE Queue] Received ${signal}. Starting graceful shutdown...`,
        );

        const shutdownPromise = stopInternal();
        const timeoutPromise =
          timeoutMs > 0
            ? new Promise<"timeout">((resolve) => {
                setTimeout(() => resolve("timeout"), timeoutMs);
              })
            : Promise.resolve("timeout" as const);

        void Promise.race([shutdownPromise, timeoutPromise])
          .then((result) => {
            if (result === "timeout") {
              logger.warn(
                `[QUESTPIE Queue] Graceful shutdown timed out after ${timeoutMs}ms. Forcing exit.`,
              );
            }
            process.exit(0);
          })
          .catch((error) => {
            logger.error(
              "[QUESTPIE Queue] Error during graceful shutdown:",
              error,
            );
            process.exit(1);
          });
      };

      handlers.set(signal, onSignal);
      process.on(signal as any, onSignal);
    }

    signalCleanup = () => {
      for (const [signal, handler] of handlers) {
        process.off(signal as any, handler);
      }
      handlers.clear();
    };
  };

  // Build the typesafe client
  const client: any = {
    capabilities,
    listen: async (options?: QueueListenRuntimeOptions) => {
      await ensureStarted();
      await registerSchedules();

      if (!capabilities.longRunningConsumer || !adapter.listen) {
        throw new Error(
          "QUESTPIE Queue: selected adapter does not support long-running listen() mode.",
        );
      }

      await adapter.listen(buildHandlers(), buildWorkOptions(options));
      setupGracefulShutdown(options);

      return {
        stop: async () => {
          await stopInternal();
        },
      };
    },
    runOnce: async (options?: QueueRunOnceOptions) => {
      await ensureStarted();
      if (!capabilities.runOnceConsumer || !adapter.runOnce) {
        throw new Error(
          "QUESTPIE Queue: selected adapter does not support runOnce() mode.",
        );
      }

      const selectedJobs = normalizeSelectedJobs(jobs, options?.jobs);
      const selectedJobNames = Object.values(selectedJobs).map(
        (job) => job.name,
      );
      return adapter.runOnce(buildHandlers(selectedJobs), {
        batchSize: options?.batchSize,
        jobs: selectedJobNames,
      });
    },
    registerSchedules,
    stop: async () => {
      await stopInternal();
    },
    createPushConsumer: (): QueuePushConsumerHandler => {
      if (!capabilities.pushConsumer || !adapter.createPushConsumer) {
        throw new Error(
          "QUESTPIE Queue: selected adapter does not support push consumer mode.",
        );
      }

      const consumer = adapter.createPushConsumer({
        handlers: buildHandlers(),
      });

      return async (batch) => {
        await ensureStarted();
        await consumer(batch);
      };
    },
    _adapter: adapter,
    _start: async () => {
      await ensureStarted();
    },
    _stop: async () => {
      await stopInternal();
    },
  };

  // Create typesafe methods for each job (iterate over object entries)
  // Use the object key (jobName) for client access to match QueueClient type definition
  // but use jobDef.name for actual adapter operations (the internal queue name)
  for (const [jobName, jobDef] of Object.entries(jobs)) {
    client[jobName] = {
      /**
       * Publish a job to the queue
       */
      publish: async (payload: any, publishOptions?: PublishOptions) => {
        await ensureStarted();

        // Validate payload with schema
        const validated = jobDef.schema.parse(payload);

        // Merge job options with publish options
        const options = {
          ...jobDef.options,
          ...publishOptions,
        };

        return adapter.publish(jobDef.name, validated, options);
      },

      /**
       * Schedule a recurring job
       */
      schedule: async (
        payload: any,
        cron: string,
        publishOptions?: Omit<PublishOptions, "startAfter">,
      ) => {
        await ensureStarted();

        if (!capabilities.scheduling || !adapter.schedule) {
          throw new Error(
            "QUESTPIE Queue: selected adapter does not support scheduling.",
          );
        }

        // Validate payload with schema
        const validated = jobDef.schema.parse(payload);

        // Merge job options with publish options
        const options = {
          ...jobDef.options,
          ...publishOptions,
        };

        await adapter.schedule(jobDef.name, cron, validated, options);
      },

      /**
       * Unschedule a recurring job
       */
      unschedule: async () => {
        await ensureStarted();

        if (!capabilities.scheduling || !adapter.unschedule) {
          throw new Error(
            "QUESTPIE Queue: selected adapter does not support scheduling.",
          );
        }

        await adapter.unschedule(jobDef.name);
      },
    };
  }

  return client as QueueClient<TJobs>;
}
