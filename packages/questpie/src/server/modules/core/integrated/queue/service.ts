import {
	getCurrentTransaction,
	getTransactionContext,
	onAfterCommit,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type {
	QueueAdapter,
	QueueAdapterCapabilities,
	QueueHandlerMap,
	QueueListenOptions,
	QueuePushConsumerHandler,
	QueueRunOnceOptions,
} from "./adapter.js";
import {
	acceptReservedQueueDispatch,
	drainQueueDispatches,
	enqueueQueueDispatch,
	reserveQueueDispatch,
	stableQueueDispatchId,
} from "./dispatch-store.js";
import type {
	JobDefinition,
	PublishOptions,
	QueueClient,
	QueueDrainOptions,
	QueueDrainResult,
	QueueListenRuntimeOptions,
	QueueRegisterSchedulesOptions,
} from "./types.js";

type QueueRuntimeContext = {
	session?: unknown;
	locale?: string;
	db?: AnyDrizzleClient;
};

type QueueLogger = {
	info: (msg: string, ...args: unknown[]) => void;
	warn: (msg: string, ...args: unknown[]) => void;
	error: (msg: string, ...args: unknown[]) => void;
};

export interface QueueClientRuntimeOptions {
	createContext?: () => Promise<QueueRuntimeContext>;
	getDatabase?: () => AnyDrizzleClient | undefined;
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
	const canPublishInTransaction =
		adapter.transactionalPublishing !== false &&
		typeof adapter.publishInTransaction === "function";

	// Track if started
	let started = false;
	let signalCleanup: (() => void) | undefined;
	let shutdownInProgress = false;
	let relayTimer: ReturnType<typeof setInterval> | undefined;
	let activeDrain: Promise<QueueDrainResult> | undefined;
	const transactionsWithScheduledDrain = new WeakSet<object>();

	// Auto-start helper
	const ensureStarted = async () => {
		if (!started) {
			await adapter.start();
			started = true;
		}
	};

	// Error handling
	adapter.on("error", () => {
		logger.error("[QUESTPIE Queue] Adapter reported an error");
	});

	const getContextOrThrow = async () => {
		if (!runtimeOptions.createContext) {
			throw new Error(
				"QUESTPIE Queue: createContext is not configured. Queue consumer methods must be called from a built app instance.",
			);
		}
		return runtimeOptions.createContext();
	};

	const getAppOrThrow = () => {
		if (!runtimeOptions.getApp) {
			throw new Error(
				"QUESTPIE Queue: app resolver is not configured. Queue consumer methods must be called from a built app instance.",
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
				const appInstance = getAppOrThrow() as any;
				const { extractAppServices } =
					await import("#questpie/server/config/app-context.js");
				const services = extractAppServices(appInstance, {
					db: context.db,
					session: context.session,
					accessMode: "system",
				});
				// Establish the ambient AppContext (ALS) for the job so implicit
				// consumers — mailer template handlers, logger trace, admin-audit
				// actor, and ctx-less CRUD — work inside jobs exactly as they do in
				// HTTP/CRUD scopes. Jobs are system scope (matches today's empty-ALS
				// fallback). `runWithContext` only inherits `_hookDepth` from an
				// existing parent; a top-level job has none, so no double-count.
				const { runWithContext } =
					await import("#questpie/server/config/context.js");
				await runWithContext(
					{
						app: appInstance,
						db: context.db,
						session: context.session,
						locale: context.locale,
						accessMode: "system",
					},
					() =>
						jobDef.handler({
							...services,
							payload: validated,
							locale: context.locale,
							dispatchId: job.dispatchId,
							idempotencyKey: job.idempotencyKey,
						} as any),
				);
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
		if (relayTimer) clearInterval(relayTimer);
		relayTimer = undefined;
		const drainInProgress = activeDrain;
		if (drainInProgress) await drainInProgress;

		if (started) {
			await adapter.stop();
			started = false;
		}
	};

	const drain = (options?: QueueDrainOptions): Promise<QueueDrainResult> => {
		if (activeDrain) return activeDrain;
		activeDrain = (async () => {
			await ensureStarted();
			const db = runtimeOptions.getDatabase?.();
			if (!db) {
				return { claimed: 0, accepted: 0, failed: 0, terminal: 0 };
			}
			const maxBatches = options?.maxBatches ?? 1;
			if (
				!Number.isSafeInteger(maxBatches) ||
				maxBatches <= 0 ||
				maxBatches > 100
			) {
				throw new Error(
					"Expected maxBatches to be an integer between 1 and 100",
				);
			}
			const batchSize = options?.batchSize ?? 100;
			const total: QueueDrainResult = {
				claimed: 0,
				accepted: 0,
				failed: 0,
				terminal: 0,
			};
			for (let batch = 0; batch < maxBatches; batch += 1) {
				const result = await drainQueueDispatches({
					adapter,
					db,
					logger,
					batchSize,
					concurrency: options?.concurrency,
				});
				total.claimed += result.claimed;
				total.accepted += result.accepted;
				total.failed += result.failed;
				total.terminal += result.terminal;
				if (result.claimed < batchSize) break;
			}
			return total;
		})().finally(() => {
			activeDrain = undefined;
		});
		return activeDrain;
	};

	const startRelayTimer = () => {
		if (relayTimer) return;
		relayTimer = setInterval(() => {
			void drain({ maxBatches: 10 }).catch((error) => {
				logger.warn("[QUESTPIE Queue] Dispatch recovery tick failed", error);
			});
		}, 5_000);
		relayTimer.unref?.();
	};

	const schedulePostCommitDrain = () => {
		const transactionContext = getTransactionContext();
		if (!transactionContext) return;
		if (transactionsWithScheduledDrain.has(transactionContext)) return;
		transactionsWithScheduledDrain.add(transactionContext);
		onAfterCommit(async () => {
			transactionsWithScheduledDrain.delete(transactionContext);
			await drain();
		});
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

			// Pre-create each job's queue with its declared `queuePolicy` BEFORE the
			// worker starts consuming — so the worker and any publisher agree on the
			// policy (queue policy is fixed at creation; whoever creates first wins).
			if (adapter.ensureQueue) {
				for (const jobDef of Object.values(jobs)) {
					await adapter.ensureQueue(jobDef.name, {
						policy: jobDef.options?.queuePolicy,
					});
				}
			}

			await drain({ maxBatches: 10 });
			await adapter.listen(buildHandlers(), buildWorkOptions(options));
			startRelayTimer();
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
			await drain();
			return adapter.runOnce(buildHandlers(selectedJobs), {
				batchSize: options?.batchSize,
				jobs: selectedJobNames,
			});
		},
		drain,
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
				await drain({ maxBatches: 10 });
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
		const jobClient = {
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
				if (
					options.idempotencyKey !== undefined &&
					options.singletonKey !== undefined
				) {
					throw new Error(
						"QUESTPIE Queue: idempotencyKey and singletonKey cannot be combined because singleton suppression cannot identify a newly accepted logical dispatch.",
					);
				}
				const dispatchId = await stableQueueDispatchId(
					jobDef.name,
					options.idempotencyKey,
				);
				const tx = getCurrentTransaction();

				if (tx && canPublishInTransaction && options.idempotencyKey) {
					const reservation = await reserveQueueDispatch(tx, {
						dispatchId,
						jobName: jobDef.name,
						idempotencyKey: options.idempotencyKey,
						payload: validated,
						options,
					});
					if (!reservation.inserted) return reservation.dispatchId;
					const adapterJobId = await adapter.publishInTransaction!(
						tx,
						jobDef.name,
						validated,
						options,
						dispatchId,
					);
					await acceptReservedQueueDispatch(
						tx,
						reservation.dispatchId,
						adapterJobId,
					);
					return reservation.dispatchId;
				}

				if (tx && canPublishInTransaction) {
					await adapter.publishInTransaction!(
						tx,
						jobDef.name,
						validated,
						options,
						dispatchId,
					);
					return dispatchId;
				}

				if (tx) {
					const persistedId = await enqueueQueueDispatch(tx, {
						dispatchId,
						jobName: jobDef.name,
						idempotencyKey: options.idempotencyKey,
						payload: validated,
						options,
					});
					schedulePostCommitDrain();
					return persistedId;
				}

				if (options.idempotencyKey) {
					const db = runtimeOptions.getDatabase?.();
					if (!db) {
						throw new Error(
							"QUESTPIE Queue: database context is required for portable idempotency.",
						);
					}
					if (canPublishInTransaction) {
						return withTransaction(db, async (transaction) => {
							const reservation = await reserveQueueDispatch(transaction, {
								dispatchId,
								jobName: jobDef.name,
								idempotencyKey: options.idempotencyKey,
								payload: validated,
								options,
							});
							if (!reservation.inserted) return reservation.dispatchId;
							const adapterJobId = await adapter.publishInTransaction!(
								transaction,
								jobDef.name,
								validated,
								options,
								reservation.dispatchId,
							);
							await acceptReservedQueueDispatch(
								transaction,
								reservation.dispatchId,
								adapterJobId,
							);
							return reservation.dispatchId;
						});
					}
					const persistedId = await withTransaction(db, (transaction) =>
						enqueueQueueDispatch(transaction, {
							dispatchId,
							jobName: jobDef.name,
							idempotencyKey: options.idempotencyKey,
							payload: validated,
							options,
						}),
					);
					await drain();
					return persistedId;
				}

				await adapter.publish(jobDef.name, validated, options, dispatchId);
				return dispatchId;
			},

			/**
			 * Schedule a recurring job
			 */
			schedule: async (
				payload: any,
				cron: string,
				publishOptions?: Omit<PublishOptions, "idempotencyKey" | "startAfter">,
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

		client[jobName] = jobClient;

		if (!(jobDef.name in client)) {
			client[jobDef.name] = jobClient;
		}
	}

	return client as QueueClient<TJobs>;
}
