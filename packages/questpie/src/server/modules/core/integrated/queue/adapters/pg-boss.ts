import { sql } from "drizzle-orm";
import { fromDrizzle, type ConstructorOptions, PgBoss } from "pg-boss";

import type {
	QueueAdapter,
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
			// Policies only constrain KEYED jobs, so non-keyed jobs keep full
			// throughput regardless.
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
			console.warn(
				`⚠️  Queue "${jobName}": singletonKey "${options.singletonKey}" was passed but the queue has no dedupe policy — pg-boss will NOT dedupe it. Pass \`queuePolicy: "stately"\` (or "short"/"singleton") when publishing so the queue is created with a policy that enforces the key.`,
			);
		}
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
			...sendOptions
		} = options ?? {};
		return this.boss.send(
			jobName,
			dispatchId
				? encodeQueueDispatchEnvelope(payload, dispatchId, idempotencyKey)
				: payload,
			{
				...sendOptions,
				...(dispatchId ? { id: dispatchId } : {}),
			} as any,
		);
	}

	async publishInTransaction(
		tx: unknown,
		jobName: string,
		payload: any,
		options: PublishOptions | undefined,
		dispatchId: string,
	): Promise<string | null> {
		await this.start();
		await this.ensureQueue(jobName, { policy: options?.queuePolicy });
		this.warnIfSingletonNoop(jobName, options);
		const {
			queuePolicy: _queuePolicy,
			idempotencyKey,
			...sendOptions
		} = options ?? {};
		return this.boss.send(
			jobName,
			encodeQueueDispatchEnvelope(payload, dispatchId, idempotencyKey),
			{
				...sendOptions,
				id: dispatchId,
				db: fromDrizzle(tx as any, sql),
			} as any,
		);
	}

	async schedule(
		jobName: string,
		cron: string,
		payload: any,
		options?: Omit<PublishOptions, "idempotencyKey" | "startAfter">,
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
			await this.boss.work(jobName, options as any, async (jobs: any) => {
				const arr: any[] = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
				for (const j of arr) {
					try {
						await handler({
							id: String(j.id),
							...decodeQueueDispatchEnvelope(j.data, String(j.id)),
						});
					} catch (error) {
						const err =
							error instanceof Error
								? error
								: new Error(typeof error === "string" ? error : String(error));
						try {
							await this.boss.fail(jobName, String(j.id), {
								message: err.message,
								stack: err.stack,
							});
						} catch (failError) {
							// If reporting the failure itself fails, surface the
							// original handler error so pg-boss's own timeout/retry
							// path can take over.
							console.error(
								`[questpie:pg-boss] failed to mark job ${j.id} as failed`,
								failError,
							);
							throw err;
						}
					}
				}
			});
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
			});

			const jobs = Array.isArray(fetched) ? fetched : fetched ? [fetched] : [];

			for (const job of jobs) {
				const id = String(job.id);
				try {
					await handler({
						id,
						...decodeQueueDispatchEnvelope(job.data, id),
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

/**
 * Factory function for creating a PgBoss adapter
 */
export function pgBossAdapter(options: PgBossAdapterOptions): PgBossAdapter {
	return new PgBossAdapter(options);
}
