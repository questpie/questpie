import {
	getCurrentTransaction,
	getTransactionContext,
	onAfterCommit,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import type { ObservabilityService } from "../observability/service.js";
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
	claimQueueDispatchExecution,
	completeQueueDispatch,
	drainQueueDispatches,
	enqueueQueueDispatch,
	getQueueDispatchReceipt,
	reconcileQueueDispatchExecutions,
	releaseQueueDispatchExecution,
	renewQueueDispatchExecution,
	reserveQueueDispatch,
	stableQueueDispatchId,
} from "./dispatch-store.js";
import {
	decryptQueueSecretPayload,
	encryptQueueSecretPayload,
	isQueueSecretPayloadEnvelope,
} from "./secret-payload.js";
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
	secret?: string;
}

const defaultLogger: QueueLogger = {
	info: (msg, ...args) => console.log(msg, ...args),
	warn: (msg, ...args) => console.warn(msg, ...args),
	error: (msg, ...args) => console.error(msg, ...args),
};

/**
 * Create a deliberately cause-free error at the secret boundary.
 *
 * Validation, provider, and handler errors may contain the original payload.
 * Keeping construction outside the catch blocks makes the intentional
 * redaction explicit without attaching a secret-bearing `cause`.
 */
function redactedSecretQueueError(message: string): Error {
	return new Error(message);
}

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
		executionTerminalState:
			adapter.capabilities?.executionTerminalState === true &&
			typeof adapter.inspectExecutionState === "function",
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
				const secretPayload = job.secretPayload === true;
				let executionToken: string | undefined;
				let executionHeartbeat: ReturnType<typeof setInterval> | undefined;
				let completionPersisted = false;
				try {
					if (secretPayload) {
						if (
							!job.dispatchId ||
							!context.db ||
							!runtimeOptions.secret ||
							!isQueueSecretPayloadEnvelope(job.data)
						) {
							throw new Error("Secret execution prerequisites unavailable");
						}
						const claim = await claimQueueDispatchExecution(
							context.db,
							job.dispatchId,
						);
						if (claim.status === "terminal") return;
						if (claim.status !== "claimed") {
							throw new Error("Secret execution claim unavailable");
						}
						executionToken = claim.token;
						executionHeartbeat = setInterval(() => {
							void renewQueueDispatchExecution(
								context.db!,
								job.dispatchId!,
								claim.token,
							).catch(() => {
								logger.warn(
									"[QUESTPIE Queue] Secret execution claim heartbeat failed",
									{ dispatchId: job.dispatchId, jobName: jobDef.name },
								);
							});
						}, 20_000);
						executionHeartbeat.unref?.();
						job.data = await decryptQueueSecretPayload({
							dispatchId: job.dispatchId,
							jobName: jobDef.name,
							payload: job.data,
							rootSecret: runtimeOptions.secret,
							wrappedKey: claim.wrappedKey,
						});
					}
					const validated = jobDef.schema.parse(job.data);
					const appInstance = getAppOrThrow() as any;
					const { extractAppServices } =
						await import("#questpie/server/config/app-context.js");
					const { runWithContext } =
						await import("#questpie/server/config/context.js");
					const { runInFreshRequestScope } =
						await import("#questpie/server/config/request-scope.js");
					await runInFreshRequestScope(appInstance, async () => {
						const services = extractAppServices(appInstance, {
							db: context.db,
							session: context.session,
							accessMode: "system",
						});
						const observability = appInstance.observability as
							| ObservabilityService
							| undefined;
						const runHandler = () =>
							runWithContext(
								{
									app: appInstance,
									db: context.db,
									session: context.session,
									locale: context.locale,
									accessMode: "system",
								},
								async () => {
									try {
										return await jobDef.handler({
											...services,
											payload: validated,
											locale: context.locale,
											dispatchId: job.dispatchId,
											idempotencyKey: job.idempotencyKey,
										} as any);
									} catch (error) {
										if (secretPayload) {
											throw redactedSecretQueueError(
												"QUESTPIE Queue secret job handling failed",
											);
										}
										throw error;
									}
								},
							);
						if (!observability?.enabled) {
							await runHandler();
							return;
						}
						await observability.span(
							`job ${jobDef.name}`,
							(span) => {
								span.setAttributes({
									"messaging.operation.name": "process",
									"messaging.destination.name": jobDef.name,
									// dispatchId is the stable logical id across retries and
									// across adapters, so it is what correlates a failed
									// attempt with the one that eventually succeeded.
									...(job.dispatchId
										? { "questpie.job.dispatch_id": job.dispatchId }
										: {}),
									...(job.idempotencyKey
										? {
												"questpie.job.idempotency_key": job.idempotencyKey,
											}
										: {}),
								});
								return runHandler();
							},
							{ kind: "consumer" },
						);
					});
					if (secretPayload && job.dispatchId && context.db) {
						await completeQueueDispatch(context.db, job.dispatchId);
						completionPersisted = true;
					}
				} catch (error) {
					if (secretPayload) {
						throw redactedSecretQueueError(
							"QUESTPIE Queue secret job handling failed",
						);
					}
					throw error;
				} finally {
					if (executionHeartbeat) clearInterval(executionHeartbeat);
					if (
						secretPayload &&
						executionToken &&
						!completionPersisted &&
						job.dispatchId &&
						context.db
					) {
						await releaseQueueDispatchExecution(
							context.db,
							job.dispatchId,
							executionToken,
						).catch(() => {
							logger.warn(
								"[QUESTPIE Queue] Secret execution claim release failed",
								{ dispatchId: job.dispatchId, jobName: jobDef.name },
							);
						});
					}
				}
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

			const {
				cron: _cron,
				startAfter: _startAfter,
				...scheduleOptions
			} = jobDef.options ?? {};
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
			const reconciliation = await reconcileQueueDispatchExecutions({
				adapter,
				db,
				logger,
				batchSize,
			});
			total.terminal += reconciliation.terminal;
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
			try {
				return await adapter.runOnce(buildHandlers(selectedJobs), {
					batchSize: options?.batchSize,
					jobs: selectedJobNames,
				});
			} finally {
				await drain();
			}
		},
		drain,
		getReceipt: async (dispatchId: string) => {
			const db = runtimeOptions.getDatabase?.();
			if (!db) {
				throw new Error(
					"QUESTPIE Queue: database context is required for dispatch receipts.",
				);
			}
			return getQueueDispatchReceipt(db, dispatchId);
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

				// Merge job options with publish options
				const options = {
					...jobDef.options,
					...publishOptions,
				};
				let validated: unknown;
				try {
					validated = jobDef.schema.parse(payload);
				} catch (error) {
					if (options.secretPayload) {
						throw redactedSecretQueueError(
							"QUESTPIE Queue secret payload validation failed",
						);
					}
					throw error;
				}
				if (options.secretPayload && !options.idempotencyKey) {
					throw new Error(
						"QUESTPIE Queue secret payloads require idempotencyKey",
					);
				}
				if (options.secretPayload && !capabilities.executionTerminalState) {
					throw new Error(
						"QUESTPIE Queue: selected adapter cannot reconcile durable broker terminal execution state required for secret payload erasure.",
					);
				}
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
				const encrypted = options.secretPayload
					? await encryptQueueSecretPayload({
							dispatchId,
							jobName: jobDef.name,
							payload: validated,
							rootSecret: runtimeOptions.secret ?? "",
						})
					: undefined;
				const adapterPayload = encrypted?.payload ?? validated;
				const adapterOptions = options;
				const tx = getCurrentTransaction();

				if (tx && canPublishInTransaction && options.idempotencyKey) {
					const reservation = await reserveQueueDispatch(tx, {
						dispatchId,
						jobName: jobDef.name,
						idempotencyKey: options.idempotencyKey,
						payload: adapterPayload,
						wrappedSecretKey: encrypted?.wrappedKey,
						options: adapterOptions,
					});
					if (!reservation.inserted) return reservation.dispatchId;
					const adapterJobId = await adapter.publishInTransaction!(
						tx,
						jobDef.name,
						adapterPayload,
						adapterOptions,
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
						adapterPayload,
						adapterOptions,
						dispatchId,
					);
					return dispatchId;
				}

				if (tx) {
					const persistedId = await enqueueQueueDispatch(tx, {
						dispatchId,
						jobName: jobDef.name,
						idempotencyKey: options.idempotencyKey,
						payload: adapterPayload,
						wrappedSecretKey: encrypted?.wrappedKey,
						options: adapterOptions,
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
								payload: adapterPayload,
								wrappedSecretKey: encrypted?.wrappedKey,
								options: adapterOptions,
							});
							if (!reservation.inserted) return reservation.dispatchId;
							const adapterJobId = await adapter.publishInTransaction!(
								transaction,
								jobDef.name,
								adapterPayload,
								adapterOptions,
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
							payload: adapterPayload,
							wrappedSecretKey: encrypted?.wrappedKey,
							options: adapterOptions,
						}),
					);
					await drain();
					return persistedId;
				}

				await adapter.publish(
					jobDef.name,
					adapterPayload,
					adapterOptions,
					dispatchId,
				);
				return dispatchId;
			},

			/**
			 * Schedule a recurring job
			 */
			schedule: async (
				payload: any,
				cron: string,
				publishOptions?: Omit<
					PublishOptions,
					"idempotencyKey" | "startAfter" | "secretPayload"
				>,
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
