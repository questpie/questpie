import { type ConstructorOptions, PgBoss } from "pg-boss";

import type {
	QueueAdapter,
	QueueHandlerMap,
	QueueListenOptions,
	QueueRunOnceOptions,
	QueueRunOnceResult,
} from "../adapter.js";
import type { PublishOptions } from "../types.js";

export type PgBossAdapterOptions = ConstructorOptions;

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

	constructor(options: PgBossAdapterOptions) {
		this.boss = new PgBoss(options);
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

	private async ensureQueue(jobName: string): Promise<void> {
		if (!this.createdQueues.has(jobName)) {
			await this.boss.createQueue(jobName);
			this.createdQueues.add(jobName);
		}
	}

	async publish(
		jobName: string,
		payload: any,
		options?: PublishOptions,
	): Promise<string | null> {
		await this.start();
		await this.ensureQueue(jobName);
		// pg-boss specific options mapping could happen here if needed
		// but PublishOptions closely mirrors pg-boss options
		return this.boss.send(jobName, payload, options as any);
	}

	async schedule(
		jobName: string,
		cron: string,
		payload: any,
		options?: Omit<PublishOptions, "startAfter">,
	): Promise<void> {
		await this.start();
		await this.ensureQueue(jobName);
		await this.boss.schedule(jobName, cron, payload, options as any);
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
						await handler({ id: String(j.id), data: j.data });
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
				await handler({ id: String(job.id), data: job.data });
				processed += 1;
			}
		}

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
