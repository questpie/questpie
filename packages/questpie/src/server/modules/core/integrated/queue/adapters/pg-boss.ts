import { sql } from "drizzle-orm";
import {
	fromDrizzle,
	type ConstructorOptions,
	PgBoss,
	type SendOptions,
} from "pg-boss";

import { resolveRuntimeLogger } from "#questpie/server/utils/runtime-logger.js";

import type {
	QueueAdapter,
	QueueExecutionState,
	QueueHandlerMap,
	QueueListenOptions,
	QueueRunOnceOptions,
	QueueRunOnceResult,
} from "../adapter.js";
import {
	decodeQueueDispatchEnvelope,
	encodeQueueDispatchEnvelope,
} from "../dispatch-envelope.js";
import type { PublishOptions } from "../types.js";

export type PgBossAdapterOptions = ConstructorOptions & {
	/**
	 * Use the current QUESTPIE Drizzle transaction for Job insertion.
	 *
	 * Keep enabled only when pg-boss points at the same PostgreSQL database as
	 * the application. Set false for a separate pg-boss database; QUESTPIE then
	 * uses its durable dispatch relay.
	 */
	useApplicationTransaction?: boolean;
};

export class PgBossAdapter implements QueueAdapter {
	public readonly capabilities = {
		longRunningConsumer: true,
		runOnceConsumer: true,
		pushConsumer: false,
		scheduling: true,
		singleton: true,
		executionTerminalState: true,
	} as const;

	private boss: PgBoss;
	private started = false;
	private createdQueues = new Set<string>();
	private warnedSingletonNoop = new Set<string>();
	public readonly transactionalPublishing: boolean;

	constructor(options: PgBossAdapterOptions) {
		const { useApplicationTransaction = true, ...pgBossOptions } = options;
		this.transactionalPublishing = useApplicationTransaction;
		this.boss = new PgBoss(pgBossOptions);
	}

	async start(): Promise<void> {
		if (!this.started) {
			await this.boss.start();
			this.started = true;
		}
	}

	async stop(): Promise<void> {
		if (this.started) {
			await this.boss.stop();
			this.started = false;
		}
	}

	async ensureQueue(
		jobName: string,
		opts?: { policy?: PublishOptions["queuePolicy"] },
	): Promise<void> {
		const policy = opts?.policy;
		if (!this.createdQueues.has(jobName)) {
			// A queue's policy is fixed at creation. A dedupe policy (short/
			// singleton/stately) is what makes `singletonKey` actually enforce —
			// on a `standard` queue pg-boss stores the key but never dedupes.
			await this.boss.createQueue(jobName, policy ? { policy } : undefined);
			this.createdQueues.add(jobName);
		}
	}

	/**
	 * Guard against the silent `singletonKey` no-op: pg-boss ignores the key on a
	 * standard-policy queue, so a caller expecting dedupe gets duplicates. Warn
	 * once per queue when a key is used without a dedupe policy.
	 */
	private warnIfSingletonNoop(jobName: string, options?: PublishOptions): void {
		if (
			options?.singletonKey &&
			!options.queuePolicy &&
			!this.warnedSingletonNoop.has(jobName)
		) {
			this.warnedSingletonNoop.add(jobName);
			resolveRuntimeLogger()?.warn(
				`⚠️  Queue "${jobName}": singletonKey "${options.singletonKey}" was passed but the queue has no dedupe policy — pg-boss will NOT dedupe it. Pass \`queuePolicy: "stately"\` (or "short"/"singleton") when publishing so the queue is created with a policy that enforces the key.`,
			);
		}
	}

	private async requireAcceptedJobId(
		jobName: string,
		adapterJobId: string | null,
		dispatchId?: string,
		db?: ReturnType<typeof fromDrizzle>,
	): Promise<string> {
		if (adapterJobId) return adapterJobId;
		if (dispatchId) {
			const persisted = await this.boss.getJobById(
				jobName,
				dispatchId,
				db ? { db } : undefined,
			);
			if (persisted?.id === dispatchId) return dispatchId;
		}
		throw new Error("QUESTPIE pg-boss publication was not accepted");
	}

	async publish(
		jobName: string,
		payload: any,
		options?: PublishOptions,
		dispatchId?: string,
	): Promise<string | null> {
		await this.start();
		await this.ensureQueue(jobName, { policy: options?.queuePolicy });
		this.warnIfSingletonNoop(jobName, options);
		// PublishOptions closely mirrors pg-boss send options; queuePolicy is
		// consumed by ensureQueue above, not forwarded to send().
		const {
			queuePolicy: _queuePolicy,
			idempotencyKey,
			secretPayload,
			...sendOptions
		} = options ?? {};
		const adapterJobId = await this.boss.send(
			jobName,
			dispatchId
				? encodeQueueDispatchEnvelope(
						payload,
						dispatchId,
						idempotencyKey,
						secretPayload,
					)
				: payload,
			{
				...sendOptions,
				...(dispatchId ? { id: dispatchId } : {}),
			} satisfies SendOptions,
		);
		// pg-boss returns null for every ON CONFLICT DO NOTHING path, including
		// queue-policy suppression by a different physical job. Recover an
		// uncertain stable-id replay only after proving that exact row exists.
		return this.requireAcceptedJobId(jobName, adapterJobId, dispatchId);
	}

	async publishInTransaction(
		tx: unknown,
		jobName: string,
		payload: unknown,
		options: PublishOptions | undefined,
		dispatchId: string,
	): Promise<string | null> {
		await this.start();
		await this.ensureQueue(jobName, { policy: options?.queuePolicy });
		this.warnIfSingletonNoop(jobName, options);
		const {
			queuePolicy: _queuePolicy,
			idempotencyKey,
			secretPayload,
			...sendOptions
		} = options ?? {};
		const transactionDb = fromQuestpieDrizzleTransaction(tx);
		const adapterJobId = await this.boss.send(
			jobName,
			encodeQueueDispatchEnvelope(
				payload,
				dispatchId,
				idempotencyKey,
				secretPayload,
			),
			{
				...sendOptions,
				id: dispatchId,
				db: transactionDb,
			} satisfies SendOptions,
		);
		return this.requireAcceptedJobId(
			jobName,
			adapterJobId,
			dispatchId,
			transactionDb,
		);
	}

	async inspectExecutionState(
		jobName: string,
		adapterJobId: string,
	): Promise<QueueExecutionState> {
		await this.start();
		const job = await this.boss.getJobById(jobName, adapterJobId);
		if (!job) return "missing";
		switch (job.state) {
			case "completed":
				return "completed";
			case "failed":
			case "cancelled":
				return "failed";
			case "active":
				return "active";
			case "created":
			case "retry":
				return "pending";
		}
	}

	async schedule(
		jobName: string,
		cron: string,
		payload: any,
		options?: Omit<
			PublishOptions,
			"idempotencyKey" | "startAfter" | "secretPayload"
		>,
	): Promise<void> {
		await this.start();
		await this.ensureQueue(jobName, { policy: options?.queuePolicy });
		this.warnIfSingletonNoop(jobName, options as PublishOptions);
		const { queuePolicy: _queuePolicy, ...scheduleOptions } = options ?? {};
		await this.boss.schedule(jobName, cron, payload, scheduleOptions as any);
	}

	async unschedule(jobName: string): Promise<void> {
		await this.start();
		await this.boss.unschedule(jobName);
	}

	async listen(
		handlers: QueueHandlerMap,
		options?: QueueListenOptions,
	): Promise<void> {
		await this.start();

		for (const jobName of Object.keys(handlers)) {
			await this.ensureQueue(jobName);
			const handler = handlers[jobName];
			if (!handler) continue;

			// pg-boss v10+ always passes an array to work() callbacks, regardless
			// of batchSize. Iterating jobs serially keeps the existing teamSize/
			// batchSize semantics (one batch per worker callback). Per-item
			// failures are reported to pg-boss via boss.fail(jobName, id, …) so
			// they retry independently while siblings in the same batch still
			// complete.
			await this.boss.work(
				jobName,
				{ ...options, includeMetadata: true } as any,
				async (jobs: any) => {
					const arr: any[] = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
					for (const j of arr) {
						try {
							await handler({
								id: String(j.id),
								...decodeQueueDispatchEnvelope(j.data, String(j.id)),
								...finalAttemptMetadata(j),
							});
						} catch (error) {
							const err =
								error instanceof Error
									? error
									: new Error(
											typeof error === "string" ? error : String(error),
										);
							try {
								await this.boss.fail(jobName, String(j.id), {
									message: err.message,
									stack: err.stack,
								});
							} catch (failError) {
								// If reporting the failure itself fails, surface the
								// original handler error so pg-boss's own timeout/retry
								// path can take over.
								resolveRuntimeLogger()?.error(
									`[questpie:pg-boss] failed to mark job ${j.id} as failed`,
									failError,
								);
								throw err;
							}
						}
					}
				},
			);
		}
	}

	async runOnce(
		handlers: QueueHandlerMap,
		options?: QueueRunOnceOptions,
	): Promise<QueueRunOnceResult> {
		await this.start();

		const selectedJobNames =
			options?.jobs && options.jobs.length > 0
				? options.jobs
				: Object.keys(handlers);

		if (selectedJobNames.length === 0) {
			return { processed: 0 };
		}

		const batchSize = Math.max(1, options?.batchSize ?? 10);
		let processed = 0;
		let firstError: Error | undefined;

		for (const jobName of selectedJobNames) {
			const handler = handlers[jobName];
			if (!handler) continue;

			await this.ensureQueue(jobName);

			const fetchFn = (this.boss as any).fetch as
				| ((name: string, options?: Record<string, unknown>) => Promise<any>)
				| undefined;

			if (!fetchFn) {
				throw new Error(
					"PgBossAdapter.runOnce requires pg-boss fetch() support.",
				);
			}

			const fetched = await fetchFn.call(this.boss, jobName, {
				batchSize,
				includeMetadata: true,
			});

			const jobs = Array.isArray(fetched) ? fetched : fetched ? [fetched] : [];

			for (const job of jobs) {
				const id = String(job.id);
				try {
					await handler({
						id,
						...decodeQueueDispatchEnvelope(job.data, id),
						...finalAttemptMetadata(job),
					});
					await this.boss.complete(jobName, id);
					processed += 1;
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					firstError ??= err;
					try {
						await this.boss.fail(jobName, id, {
							message: err.message,
							stack: err.stack,
						});
					} catch {
						// Continue settling siblings already fetched into this
						// process. pg-boss will recover this active item through
						// its lease/expiry path.
					}
				}
			}
		}

		if (firstError) throw firstError;
		return { processed };
	}

	on(event: "error", handler: (error: Error) => void): void {
		// Use addListener to avoid TS2576 with some @types/node versions
		// that expose 'on' only as a static member in the class declaration
		(this.boss as unknown as NodeJS.EventEmitter).addListener(event, handler);
	}
}

function fromQuestpieDrizzleTransaction(
	tx: unknown,
): ReturnType<typeof fromDrizzle> {
	const database = fromDrizzle(tx as Parameters<typeof fromDrizzle>[0], sql);
	return {
		executeSql: (text, values) =>
			database.executeSql(
				text,
				values?.map((value, index) => {
					if (
						typeof value !== "string" ||
						!new RegExp(`\\$${index + 1}\\s*::\\s*jsonb?\\b`).test(text)
					) {
						return value;
					}
					try {
						// Bun SQL serializes a string supplied to a JSON-typed
						// placeholder as a JSON string scalar. pg-boss supplies its
						// batch as JSON text, so restore the structured value before
						// the official Drizzle bridge binds it.
						return JSON.parse(value);
					} catch {
						return value;
					}
				}),
			),
	};
}

function finalAttemptMetadata(
	job: Record<string, unknown>,
): { finalAttempt: boolean } | Record<string, never> {
	return Number.isInteger(job.retryCount) && Number.isInteger(job.retryLimit)
		? {
				finalAttempt: (job.retryCount as number) >= (job.retryLimit as number),
			}
		: {};
}

/**
 * Factory function for creating a PgBoss adapter
 */
export function pgBossAdapter(options: PgBossAdapterOptions): PgBossAdapter {
	return new PgBossAdapter(options);
}
