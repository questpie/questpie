import type {
  QueueAdapter,
  QueuePushBatch,
  QueuePushConsumerFactoryArgs,
} from "../adapter.js";
import type { PublishOptions } from "../types.js";

export interface CloudflareQueueEnvelope {
  jobName: string;
  payload: unknown;
  options?: PublishOptions;
}

export interface CloudflareQueuesAdapterOptions {
  /**
   * Producer function that enqueues a message to Cloudflare Queues.
   */
  enqueue: (message: CloudflareQueueEnvelope) => Promise<string | null>;

  /**
   * Decode raw pushed message body into queue envelope.
   */
  decode?: (body: unknown) => CloudflareQueueEnvelope | null;
}

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

export class CloudflareQueuesAdapter implements QueueAdapter {
  public readonly capabilities = {
    longRunningConsumer: false,
    runOnceConsumer: false,
    pushConsumer: true,
    scheduling: false,
    singleton: false,
  } as const;

  private readonly enqueue: (
    message: CloudflareQueueEnvelope,
  ) => Promise<string | null>;
  private readonly decode: (body: unknown) => CloudflareQueueEnvelope | null;
  private readonly errorHandlers = new Set<(error: Error) => void>();

  constructor(options: CloudflareQueuesAdapterOptions) {
    this.enqueue = options.enqueue;
    this.decode = options.decode ?? defaultDecode;
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async publish(
    jobName: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<string | null> {
    return this.enqueue({ jobName, payload, options });
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

  on(event: "error", handler: (error: Error) => void): void {
    if (event === "error") {
      this.errorHandlers.add(handler);
    }
  }

  createPushConsumer(args: QueuePushConsumerFactoryArgs) {
    return async (batch: QueuePushBatch) => {
      for (const message of batch.messages) {
        try {
          const envelope = this.decode(message.body);
          if (!envelope) {
            throw new Error(
              "CloudflareQueuesAdapter failed to decode message envelope.",
            );
          }

          const handler = args.handlers[envelope.jobName];
          if (!handler) {
            throw new Error(
              `CloudflareQueuesAdapter missing handler for job "${envelope.jobName}".`,
            );
          }

          await handler({ id: message.id, data: envelope.payload });
          await message.ack();
        } catch (error) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          for (const onError of this.errorHandlers) {
            onError(normalized);
          }

          await message.retry();
        }
      }
    };
  }
}

export function cloudflareQueuesAdapter(
  options: CloudflareQueuesAdapterOptions,
): CloudflareQueuesAdapter {
  return new CloudflareQueuesAdapter(options);
}
