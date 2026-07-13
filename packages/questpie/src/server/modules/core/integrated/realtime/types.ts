import type { RealtimeAdapter } from "./adapter.js";

export type RealtimeResourceType = "collection" | "global";

export type RealtimeOperation =
	| "create"
	| "update"
	| "delete"
	| "bulk_update"
	| "bulk_delete";

export type RealtimeEqualityValue = string | number | boolean | null;

/**
 * Shallow scalar fields that can participate in cheap equality routing.
 * Nested objects, arrays, relations, and hydrated payloads are deliberately
 * excluded from the durable outbox.
 */
export type RealtimeEqualityProjection = Record<string, RealtimeEqualityValue>;

/**
 * Durable routing payload. Single-record changes carry pre/post projections;
 * bulk changes carry only their affected ids and count.
 */
export type RealtimeChangePayload = {
	before?: RealtimeEqualityProjection | null;
	after?: RealtimeEqualityProjection | null;
	count?: number;
	recordIds?: (string | number)[];
};

export type RealtimeChangeEvent = {
	seq: number;
	resourceType: RealtimeResourceType;
	resource: string;
	operation: RealtimeOperation;
	recordId?: string | null;
	locale?: string | null;
	payload?: RealtimeChangePayload;
	createdAt: Date;
};

/** Called when realtime delivery fails and the subscriber should reconnect. */
export type RealtimeErrorListener = (error: unknown) => void;

export type RealtimeNotice = Pick<
	RealtimeChangeEvent,
	"seq" | "resourceType" | "resource" | "operation"
>;

/**
 * Topics for realtime subscriptions.
 * Supports hierarchical filtering via WHERE clause and automatic dependency tracking.
 */
export type RealtimeTopics = {
	resourceType: RealtimeResourceType;
	resource: string;
	/**
	 * WHERE clause for filtering events.
	 * Simple equality filters are extracted for topic routing.
	 * Example: { chatId: 'chat-1', status: 'active' }
	 */
	where?: Record<string, any>;
	/**
	 * Relations to include - triggers automatic subscription to related resources.
	 * Example: { user: true, attachments: true }
	 */
	with?: Record<string, any>;
};

export type RealtimeSubscriptionContext = {
	/**
	 * Function to resolve collection dependencies from WITH config.
	 * Returns all collections that should trigger refresh (main + relations).
	 */
	resolveCollectionDependencies?: (
		baseCollection: string,
		withConfig?: Record<string, any>,
	) => Set<string>;
	/**
	 * Function to resolve global dependencies from WITH config.
	 */
	resolveGlobalDependencies?: (
		globalName: string,
		withConfig?: Record<string, any>,
	) => { collections: Set<string>; globals: Set<string> };
};

export interface RealtimeConfig {
	/**
	 * Optional transport adapter (pg_notify, redis streams, etc.).
	 */
	adapter?: RealtimeAdapter;

	/**
	 * Poll interval in ms if no adapter is configured.
	 * @default 2000
	 */
	pollIntervalMs?: number;

	/**
	 * Max events to read per drain.
	 * @default 500
	 */
	batchSize?: number;

	/**
	 * Retention window in days for time-based outbox cleanup.
	 *
	 * Cleanup is time-based only so one process can never delete rows that a
	 * different process has not drained yet. Set to `0` to disable cleanup.
	 *
	 * @default 3
	 */
	retentionDays?: number;

	/**
	 * Interval in ms between `ping` keep-alive events on `POST /realtime`
	 * SSE streams.
	 *
	 * Default is 8000 — strictly under Bun's default 10s `idleTimeout` (so
	 * streams survive on an untuned `Bun.serve`) and far under common proxy
	 * read timeouts (30-60s).
	 *
	 * @default 8000
	 */
	keepAliveIntervalMs?: number;
}
