import type { PublishOptions } from "./types.js";

export interface QueueAdapterCapabilities {
	longRunningConsumer: boolean;
	runOnceConsumer: boolean;
	pushConsumer: boolean;
	scheduling: boolean;
	singleton: boolean;
	/**
	 * Adapter can inspect durable broker execution state after process crashes,
	 * worker timeouts, and broker-owned terminalization.
	 */
	executionTerminalState: boolean;
}

export type QueueExecutionState =
	| "pending"
	| "active"
	| "completed"
	| "failed"
	| "missing";

export interface QueueJobRecord {
	id: string;
	data: unknown;
	/** Stable logical dispatch identity, independent of adapter job id. */
	dispatchId?: string;
	/** Portable caller-supplied idempotency identity. */
	idempotencyKey?: string;
	/** True only when a handler failure cannot be retried by the adapter. */
	finalAttempt?: boolean;
	/** Framework-authored marker that the adapter payload is encrypted. */
	secretPayload?: boolean;
	/** Defer execution admission without consuming a handler retry. */
	defer?: () => void;
	/** Persist execution admission after a secret claim is acquired, before user code. */
	beginExecution?: () => Promise<void>;
	/** Aborted when the adapter execution lease expires. */
	signal?: AbortSignal;
	/** Secret claim lease bounded by the adapter execution deadline. */
	executionLeaseMs?: number;
	/** Absolute database deadline; claims and terminal writes cannot extend it. */
	executionDeadline?: Date;
}

export interface QueueListenOptions {
	teamSize?: number;
	batchSize?: number;
}

export interface QueueRunOnceOptions {
	batchSize?: number;
	jobs?: string[];
}

export interface QueueRunOnceResult {
	processed: number;
}

export type QueueJobHandler = (job: QueueJobRecord) => Promise<void>;

export type QueueHandlerMap = Record<string, QueueJobHandler>;

export interface QueuePushMessage {
	id: string;
	body: unknown;
	attempts?: number;
	ack: () => Promise<void>;
	retry: (options?: QueueRetryOptions) => Promise<void>;
}

export interface QueuePushBatch {
	messages: QueuePushMessage[];
	ackAll?: () => Promise<void>;
	retryAll?: (options?: QueueRetryOptions) => Promise<void>;
	raw?: unknown;
}

export interface QueueRetryOptions {
	delaySeconds?: number;
}

export type QueuePushConsumerHandler = (batch: QueuePushBatch) => Promise<void>;

export interface QueuePushConsumerFactoryArgs {
	handlers: QueueHandlerMap;
}

/**
 * Common interface for Queue Adapters (e.g. PgBoss, BullMQ)
 */
export interface QueueAdapter {
	/**
	 * Capability flags used for runtime checks and multi-runtime support.
	 */
	capabilities?: Partial<QueueAdapterCapabilities>;

	/**
	 * Start the queue adapter (connect to DB/Redis, etc.)
	 */
	start(): Promise<void>;

	/**
	 * Stop the queue adapter (close connections)
	 */
	stop(): Promise<void>;

	/**
	 * Publish a job to the queue
	 */
	publish(
		jobName: string,
		payload: any,
		options?: PublishOptions,
		dispatchId?: string,
	): Promise<string | null>;

	/**
	 * Publish through the current QUESTPIE database transaction when the
	 * adapter owns compatible storage. pg-boss implements this capability.
	 */
	publishInTransaction?(
		tx: unknown,
		jobName: string,
		payload: unknown,
		options: PublishOptions | undefined,
		dispatchId: string,
	): Promise<string | null>;

	/**
	 * Set false when publishInTransaction cannot use the application's current
	 * PostgreSQL transaction. The runtime then uses the durable dispatch relay.
	 */
	transactionalPublishing?: boolean;

	/** Set false to keep encrypted dispatches on the durable relay path. */
	transactionalSecretPublishing?: boolean;

	/**
	 * Use a fresh dispatch identity for each newly reserved receipt lifetime.
	 * Required by adapters whose durable ledger can outlive framework retention.
	 * Replays still return the existing receipt identity until it is pruned.
	 */
	uniqueDispatchIds?: boolean;

	/**
	 * Inspect the durable broker state for crash-recovery reconciliation.
	 *
	 * Adapters must not advertise executionTerminalState without implementing
	 * this method for every broker-owned terminal path.
	 */
	inspectExecutionState?(
		jobName: string,
		adapterJobId: string,
	): Promise<QueueExecutionState>;

	/**
	 * Schedule a recurring job with cron
	 */
	schedule(
		jobName: string,
		cron: string,
		payload: any,
		options?: Omit<
			PublishOptions,
			"idempotencyKey" | "startAfter" | "secretPayload"
		>,
	): Promise<void>;

	/**
	 * Cancel scheduled jobs for a specific job name
	 */
	unschedule(jobName: string): Promise<void>;

	/**
	 * Ensure the queue for a job exists, optionally with a specific policy.
	 * Called once per job at listener setup so the worker and any publisher
	 * create the queue with the same declared policy (see `queuePolicy` on the
	 * job options). Optional — adapters that don't pre-create queues can omit it.
	 */
	ensureQueue?(
		jobName: string,
		opts?: { policy?: PublishOptions["queuePolicy"] },
	): Promise<void>;

	/**
	 * Start long-running consumers (Node/Bun worker mode)
	 */
	listen?(
		handlers: QueueHandlerMap,
		options?: QueueListenOptions,
	): Promise<void>;

	/**
	 * Process a single bounded batch (serverless-friendly tick mode).
	 */
	runOnce?(
		handlers: QueueHandlerMap,
		options?: QueueRunOnceOptions,
	): Promise<QueueRunOnceResult>;

	/**
	 * Create push-based consumer handler (Cloudflare Queues style).
	 */
	createPushConsumer?(
		args: QueuePushConsumerFactoryArgs,
	): QueuePushConsumerHandler;

	/**
	 * Listen for queue events
	 */
	on(event: "error", handler: (error: Error) => void): void;
}
