import type { RealtimeAdapter } from "./adapter.js";

export type RealtimeResourceType = "collection" | "global";

export type RealtimeOperation =
	| "create"
	| "update"
	| "delete"
	| "bulk_update"
	| "bulk_delete";

export type RealtimeChangeEvent = {
	seq: number;
	resourceType: RealtimeResourceType;
	resource: string;
	operation: RealtimeOperation;
	recordId?: string | null;
	locale?: string | null;
	payload?: Record<string, unknown>;
	createdAt: Date;
};

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
	 * Reconciliation poll interval in ms. Polling runs alongside adapters so a
	 * dropped wake-up notice cannot stall delivery indefinitely.
	 *
	 * @default 15000 with an adapter; 2000 without one
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
	 * Note: realtime service always performs watermark cleanup based on
	 * min consumed seq for active subscribers. `retentionDays` adds an
	 * additional time-based safety window.
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
