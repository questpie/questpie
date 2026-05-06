import type {
	QueueAdapter,
	QueuePushBatch,
	QueuePushConsumerFactoryArgs,
} from "../adapter.js";
import type { PublishOptions } from "../types.js";

type MaybePromise<T> = T | Promise<T>;

export interface CloudflareQueueEnvelope {
	jobName: string;
	payload: unknown;
	options?: PublishOptions;
}

export interface CloudflareQueueBinding {
	send(
		message: CloudflareQueueEnvelope,
		options?: CloudflareQueueSendOptions,
	): Promise<unknown>;
}

export type CloudflareQueueBindingProvider =
	() => MaybePromise<CloudflareQueueBinding>;
export type CloudflareQueueBindingInput =
	| CloudflareQueueBinding
	| CloudflareQueueBindingProvider;

export interface CloudflareQueuesAdapterOptions {
	/**
	 * Producer function that enqueues a message to Cloudflare Queues.
	 */
	enqueue?: (
		message: CloudflareQueueEnvelope,
		options?: CloudflareQueueSendOptions,
	) => Promise<string | null>;

	/**
	 * Cloudflare Queues producer binding.
	 *
	 * `send()` does not expose a stable message id, so publish() returns `null`
	 * when this form is used.
	 */
	queue?: CloudflareQueueBindingInput;

	/**
	 * Decode raw pushed message body into queue envelope.
	 */
	decode?: (body: unknown) => CloudflareQueueEnvelope | null;
}

export interface CloudflareQueueSendOptions {
	delaySeconds?: number;
}

const MAX_CLOUDFLARE_QUEUE_DELAY_SECONDS = 24 * 60 * 60;

function defaultDecode(body: unknown): CloudflareQueueEnvelope | null {
	if (!body || typeof body !== "object") return null;

	const maybeEnvelope = body as Record<string, unknown>;
	if (typeof maybeEnvelope.jobName !== "string") return null;

	return {
		jobName: maybeEnvelope.jobName,
		payload: maybeEnvelope.payload,
		options: maybeEnvelope.options as PublishOptions | undefined,
	};
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(String(error));
}

function toDelaySeconds(
	startAfter: PublishOptions["startAfter"],
): number | undefined {
	if (startAfter === undefined) return undefined;

	let delayMs: number | undefined;
	if (startAfter instanceof Date) {
		delayMs = startAfter.getTime() - Date.now();
	} else if (typeof startAfter === "number") {
		delayMs = startAfter * 1000;
	} else {
		const parsed = Date.parse(startAfter);
		if (Number.isNaN(parsed)) {
			throw new Error(
				`CloudflareQueuesAdapter received invalid startAfter value: "${startAfter}".`,
			);
		}
		delayMs = parsed - Date.now();
	}

	const delaySeconds = Math.max(0, Math.ceil(delayMs / 1000));
	if (delaySeconds > MAX_CLOUDFLARE_QUEUE_DELAY_SECONDS) {
		throw new Error(
			`CloudflareQueuesAdapter supports startAfter delays up to 24 hours; received ${delaySeconds} seconds.`,
		);
	}

	return delaySeconds;
}

function retryOptionsFromPublishOptions(
	options: PublishOptions | undefined,
): CloudflareQueueSendOptions | undefined {
	if (!options?.retryDelay) return undefined;
	if (options.retryDelay > MAX_CLOUDFLARE_QUEUE_DELAY_SECONDS) {
		throw new Error(
			`CloudflareQueuesAdapter supports retryDelay up to 24 hours; received ${options.retryDelay} seconds.`,
		);
	}
	return {
		delaySeconds: Math.max(0, Math.floor(options.retryDelay)),
	};
}

export class CloudflareQueuesAdapter implements QueueAdapter {
	public readonly runtime = "cloudflare" as const;
	public readonly capabilities = {
		longRunningConsumer: false,
		runOnceConsumer: false,
		pushConsumer: true,
		scheduling: false,
		singleton: false,
	} as const;

	private readonly enqueue: (
		message: CloudflareQueueEnvelope,
		options?: CloudflareQueueSendOptions,
	) => Promise<string | null>;
	private readonly decode: (body: unknown) => CloudflareQueueEnvelope | null;
	private readonly errorHandlers = new Set<(error: Error) => void>();

	constructor(options: CloudflareQueuesAdapterOptions) {
		if (!options.enqueue && !options.queue) {
			throw new Error(
				"CloudflareQueuesAdapter requires either enqueue or queue.",
			);
		}
		this.enqueue =
			options.enqueue ??
			(async (message, sendOptions) => {
				const queue =
					typeof options.queue === "function"
						? await options.queue()
						: options.queue!;
				await queue.send(
					message,
					sendOptions ?? toSendOptions(message.options),
				);
				return null;
			});
		this.decode = options.decode ?? defaultDecode;
	}

	async start(): Promise<void> {}

	async stop(): Promise<void> {}

	async publish(
		jobName: string,
		payload: unknown,
		options?: PublishOptions,
	): Promise<string | null> {
		try {
			return await this.enqueue(
				{ jobName, payload, options },
				toSendOptions(options),
			);
		} catch (error) {
			this.notifyError(normalizeError(error));
			throw error;
		}
	}

	async schedule(): Promise<void> {
		throw new Error(
			"CloudflareQueuesAdapter does not support cron scheduling. Use platform cron triggers.",
		);
	}

	async unschedule(): Promise<void> {
		throw new Error(
			"CloudflareQueuesAdapter does not support unschedule(). Use platform cron triggers.",
		);
	}

	on(_event: "error", handler: (error: Error) => void): void {
		this.errorHandlers.add(handler);
	}

	createPushConsumer(args: QueuePushConsumerFactoryArgs) {
		return async (batch: QueuePushBatch) => {
			for (const message of batch.messages) {
				const envelope = this.decode(message.body);
				if (!envelope) {
					this.notifyError(
						new Error(
							"CloudflareQueuesAdapter failed to decode message envelope.",
						),
					);
					await message.ack();
					continue;
				}

				const handler = args.handlers[envelope.jobName];
				if (!handler) {
					this.notifyError(
						new Error(
							`CloudflareQueuesAdapter missing handler for job "${envelope.jobName}".`,
						),
					);
					await message.ack();
					continue;
				}

				try {
					await handler({ id: message.id, data: envelope.payload });
					await message.ack();
				} catch (error) {
					this.notifyError(normalizeError(error));
					const retryOptions = retryOptionsFromPublishOptions(envelope.options);
					if (
						envelope.options?.retryLimit !== undefined &&
						message.attempts !== undefined &&
						message.attempts >= envelope.options.retryLimit + 1
					) {
						await message.ack();
						continue;
					}
					await message.retry(retryOptions);
				}
			}
		};
	}

	private notifyError(error: Error): void {
		for (const onError of this.errorHandlers) {
			onError(error);
		}
	}
}

function toSendOptions(
	options: PublishOptions | undefined,
): CloudflareQueueSendOptions | undefined {
	const delaySeconds = toDelaySeconds(options?.startAfter);
	return delaySeconds === undefined ? undefined : { delaySeconds };
}

export function cloudflareQueuesAdapter(
	options: CloudflareQueuesAdapterOptions,
): CloudflareQueuesAdapter {
	return new CloudflareQueuesAdapter(options);
}
