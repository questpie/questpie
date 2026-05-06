import {
	type ConnectionOptions,
	type JobsOptions,
	Queue,
	Worker,
	type WorkerOptions,
} from "bullmq";

import type {
	QueueAdapter,
	QueueHandlerMap,
	QueueListenOptions,
	QueueRunOnceOptions,
	QueueRunOnceResult,
} from "../adapter.js";
import type { PublishOptions } from "../types.js";

export type BullMQAdapterOptions = {
	connection: ConnectionOptions;
	queuePrefix?: string;
	workerOptions?: Omit<WorkerOptions, "connection" | "prefix">;
};

export class BullMQAdapter implements QueueAdapter {
	public readonly capabilities = {
		longRunningConsumer: true,
		runOnceConsumer: true,
		pushConsumer: false,
		scheduling: true,
		singleton: true,
	} as const;

	private readonly connection: ConnectionOptions;
	private readonly queuePrefix?: string;
	private readonly workerOptions?: Omit<WorkerOptions, "connection" | "prefix">;
	private readonly queues = new Map<string, Queue>();
	private readonly workers = new Set<Worker>();
	private readonly errorHandlers = new Set<(error: Error) => void>();

	constructor(options: BullMQAdapterOptions) {
		this.connection = options.connection;
		this.queuePrefix = options.queuePrefix;
		this.workerOptions = options.workerOptions;
	}

	async start(): Promise<void> {
		// BullMQ queues/workers connect lazily; nothing to do here.
	}

	async stop(): Promise<void> {
		// Close workers first so they stop pulling jobs, then queues.
		const workerCloses = Array.from(this.workers).map((w) =>
			w.close().catch((error) => this.notifyError(this.normalizeError(error))),
		);
		await Promise.all(workerCloses);
		this.workers.clear();

		const queueCloses = Array.from(this.queues.values()).map((q) =>
			q.close().catch((error) => this.notifyError(this.normalizeError(error))),
		);
		await Promise.all(queueCloses);
		this.queues.clear();
	}

	private getQueue(jobName: string): Queue {
		let queue = this.queues.get(jobName);
		if (!queue) {
			queue = new Queue(jobName, {
				connection: this.connection,
				...(this.queuePrefix ? { prefix: this.queuePrefix } : {}),
			});
			// Surface queue connection errors to registered handlers.
			queue.on("error", (error: Error) => this.notifyError(error));
			this.queues.set(jobName, queue);
		}
		return queue;
	}

	private toDelayMs(
		startAfter: PublishOptions["startAfter"],
	): number | undefined {
		if (startAfter === undefined) return undefined;
		if (startAfter instanceof Date) {
			const ms = startAfter.getTime() - Date.now();
			return ms > 0 ? ms : 0;
		}
		if (typeof startAfter === "number") {
			// PublishOptions documents this as seconds.
			return Math.max(0, Math.floor(startAfter * 1000));
		}
		// Fallback: try to parse ISO string; ignore invalid values.
		const parsed = Date.parse(startAfter);
		if (Number.isNaN(parsed)) return undefined;
		const ms = parsed - Date.now();
		return ms > 0 ? ms : 0;
	}

	private mapPublishOptions(options?: PublishOptions): JobsOptions {
		if (!options) return {};
		const opts: JobsOptions = {};

		const delay = this.toDelayMs(options.startAfter);
		if (delay !== undefined) opts.delay = delay;

		if (options.singletonKey !== undefined) {
			// BullMQ deduplicates by jobId; reuse it as the singleton lock.
			opts.jobId = options.singletonKey;
		}

		if (options.expireInSeconds !== undefined) {
			// No direct TTL; expire completed entries by age instead.
			opts.removeOnComplete = { age: options.expireInSeconds };
		}

		if (options.retryLimit !== undefined) {
			opts.attempts = options.retryLimit + 1;
		}

		if (options.retryDelay !== undefined) {
			opts.backoff = {
				type: options.retryBackoff ? "exponential" : "fixed",
				delay: options.retryDelay * 1000,
			};
		} else if (options.retryBackoff) {
			opts.backoff = { type: "exponential" };
		}

		if (options.priority !== undefined) {
			opts.priority = options.priority;
		}

		return opts;
	}

	async publish(
		jobName: string,
		payload: any,
		options?: PublishOptions,
	): Promise<string | null> {
		const queue = this.getQueue(jobName);
		const job = await queue.add(
			jobName,
			payload,
			this.mapPublishOptions(options),
		);
		return job.id ?? null;
	}

	async schedule(
		jobName: string,
		cron: string,
		payload: any,
		options?: Omit<PublishOptions, "startAfter">,
	): Promise<void> {
		const queue = this.getQueue(jobName);
		// Use a deterministic repeat key keyed by jobName so unschedule() can
		// find/remove every recurring job for that name.
		const baseOpts = this.mapPublishOptions(options);
		await queue.add(jobName, payload, {
			...baseOpts,
			repeat: { pattern: cron, key: `questpie:${jobName}` },
		});
	}

	async unschedule(jobName: string): Promise<void> {
		const queue = this.getQueue(jobName);
		// removeRepeatableByKey is the v5 way to remove by full repeat key.
		// Iterate all repeatables and drop those tied to jobName.
		const repeatables = await queue.getRepeatableJobs();
		for (const repeatable of repeatables) {
			if (repeatable.name !== jobName) continue;
			await queue.removeRepeatableByKey(repeatable.key);
		}
	}

	async listen(
		handlers: QueueHandlerMap,
		options?: QueueListenOptions,
	): Promise<void> {
		for (const jobName of Object.keys(handlers)) {
			const handler = handlers[jobName];
			if (!handler) continue;

			// One Worker per job name; BullMQ retries via attempts/backoff opts
			// set at publish time, so handler errors propagate naturally.
			const worker = new Worker(
				jobName,
				async (job) => {
					await handler({ id: String(job.id), data: job.data });
				},
				{
					connection: this.connection,
					...(this.queuePrefix ? { prefix: this.queuePrefix } : {}),
					...(options?.teamSize ? { concurrency: options.teamSize } : {}),
					...this.workerOptions,
				},
			);

			worker.on("error", (error: Error) => this.notifyError(error));
			this.workers.add(worker);
		}
	}

	async runOnce(
		handlers: QueueHandlerMap,
		options?: QueueRunOnceOptions,
	): Promise<QueueRunOnceResult> {
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

			const worker = new Worker(
				jobName,
				async (job) => {
					await handler({ id: String(job.id), data: job.data });
				},
				{
					connection: this.connection,
					...(this.queuePrefix ? { prefix: this.queuePrefix } : {}),
					...this.workerOptions,
					autorun: false,
					concurrency: 1,
				},
			);
			worker.on("error", (error: Error) => this.notifyError(error));

			try {
				while (processed < batchSize) {
					const token = `${worker.id}:${processed}`;
					const job = await worker.getNextJob(token, { block: false });
					if (!job) break;

					await worker.processJob(job, token, () => false);
					processed += 1;
				}
			} finally {
				try {
					await worker.close();
				} catch (error) {
					this.notifyError(this.normalizeError(error));
				}
			}

			if (processed >= batchSize) break;
		}

		return { processed };
	}

	on(_event: "error", handler: (error: Error) => void): void {
		this.errorHandlers.add(handler);
	}

	private notifyError(error: Error): void {
		for (const onError of this.errorHandlers) {
			onError(error);
		}
	}

	private normalizeError(error: unknown): Error {
		if (error instanceof Error) return error;
		return new Error(typeof error === "string" ? error : String(error));
	}
}

/**
 * Factory function for creating a BullMQ adapter
 */
export function bullMQAdapter(options: BullMQAdapterOptions): BullMQAdapter {
	return new BullMQAdapter(options);
}
