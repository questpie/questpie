import type { ChangeBroker, ClientTransport } from "./transport.js";

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
	origin?: "crdt_projection" | "crdt_replace";
	before?: RealtimeEqualityProjection | null;
	after?: RealtimeEqualityProjection | null;
	count?: number;
	recordIds?: (string | number)[];
};

export type RealtimeChangeEvent = {
	seq: number;
	txid?: string;
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

/**
 * Topics for realtime subscriptions.
 * Supports hierarchical filtering via WHERE clause and automatic dependency tracking.
 */
export type RealtimeTopics = {
	resourceType: RealtimeResourceType;
	resource: string;
	/** Query shape used to compute the latest snapshot. */
	operation?: "find" | "count" | "get";
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
	 * Function to resolve collection dependencies from a WITH or WHERE fragment.
	 * Returns all collections that should trigger refresh (main + relations).
	 */
	resolveCollectionDependencies?: (
		baseCollection: string,
		withConfig?: Record<string, any>,
	) => Set<string>;
	/** Own the relation-name boundary used by conservative payload routing. */
	resolveCollectionRelationNames?: (
		baseCollection: string,
	) => ReadonlySet<string>;
	/**
	 * Function to resolve global dependencies from WITH config.
	 */
	resolveGlobalDependencies?: (
		globalName: string,
		withConfig?: Record<string, any>,
	) => { collections: Set<string>; globals: Set<string> };
};

export type RealtimeSubscriptionScopeContext = {
	principal?: {
		kind: string;
		user?: { id?: unknown };
		tokenId?: unknown;
	} | null;
	session?: { user?: { id?: unknown }; session?: { id?: unknown } } | null;
	locale?: string;
	stage?: string;
	accessMode?: string;
	request?: Request;
	req?: Request;
};

export type RealtimeSubscriptionScopeResolver = (
	context: RealtimeSubscriptionScopeContext,
) => string | null | undefined | Promise<string | null | undefined>;

export interface RealtimeConfig {
	/**
	 * Enables native row-delta emission once every replica reads the outbox in
	 * settled `(txid, seq)` order. Keep disabled during the first phase of a
	 * rolling deployment: a replica still ordering by sequence alone can skip a
	 * row. Snapshot realtime remains available throughout.
	 *
	 * @default false
	 */
	nativeDeltas?: boolean;
	/**
	 * Records collection and global mutations to the realtime outbox — the
	 * write side of collection realtime, and the only source row live queries
	 * can be served from.
	 *
	 * While enabled (the default), every collection and global mutation writes a
	 * before/after scalar image to `questpie_realtime_log`, retained
	 * {@link retentionDays} days. That is one insert, taking no shared lock, so
	 * concurrent writers do not queue behind each other — but the cost is paid on
	 * every write whether or not anything is subscribed.
	 *
	 * Turn it off when the application uses typed channels only, or no realtime
	 * at all. Capture then issues no SQL at all: no outbox insert, no drain, no
	 * retention cleanup.
	 *
	 * What is given up, in full:
	 * - **Collection and global realtime.** Every `collection`/`global` topic is
	 *   refused at admission with `change_capture_disabled`, including topics
	 *   that only watch a resource as a relation dependency.
	 * - **Resume.** With no outbox there is nothing for `sinceSeq` to replay, so
	 *   a reconnecting client cannot catch up on what it missed.
	 * - **`txid` correlation.** Mutations stop returning a transaction id, so
	 *   `getTxid()` is `undefined` and optimistic clients (`@questpie/tanstack-db`)
	 *   cannot match a local write against a server frame.
	 *
	 * What still works: typed channels and their ordered ledger, channel
	 * presence, CRDT document sync, and every ordinary read and write. CRDT
	 * canonical projection is the single exception that keeps writing outbox
	 * rows — its commit protocol requires exactly one row per commit.
	 *
	 * @see {@link rowLiveQueries} — the narrower, read-side sibling.
	 * @default true
	 */
	changeCapture?: boolean;
	/**
	 * Serves collection/global row live queries. Refusing them here leaves
	 * change capture, dependency watches, typed channels, and CRDT enabled: the
	 * outbox is still written, so `txid` correlation and resume keep working and
	 * row topics can be re-enabled without a gap in the log.
	 *
	 * This is the read side of the pair; {@link changeCapture} is the write
	 * side. Capture off already implies no live queries, so this flag only
	 * matters while capture is on.
	 *
	 * @default true
	 */
	rowLiveQueries?: boolean;
	/**
	 * Resolve one stable server-owned scope at admission. `null`/`undefined`
	 * means explicitly unscoped; switching scope requires a new subscription.
	 *
	 * @deprecated Tenant selection belongs in `appConfig.context` and read
	 * access. Use collection/global `realtime.accessCacheKey` only when widening
	 * compute sharing for byte-identical output. Removed in QUESTPIE 4.
	 */
	subscriptionScope?: RealtimeSubscriptionScopeResolver;
	/** Diagnostic event sink. Observer failures are isolated from delivery. */
	observer?: import("./observer.js").RealtimeObserver;
	/** Realtime edge-session admission limits. */
	admission?: Partial<import("./admission.js").RealtimeAdmissionConfig>;
	/** Optional maximum random delay before accepting a new edge session. */
	connectionAcceptPacingMs?: number;
	/** Cross-instance notice seam used by Realtime v2 transports. */
	changeBroker?: ChangeBroker;
	/** Edge delivery seam shared by live queries and typed channels. */
	clientTransport?: ClientTransport;
	/** Durable ordered-channel retention, backpressure, and lease tuning. */
	channelEvents?: Partial<
		import("./channel-event-ledger.js").ChannelEventLedgerConfig
	>;
	/** Cross-instance lease register tuning for SSE presence channels. */
	channelPresence?: Partial<
		import("./sse-channel-presence.js").ChannelPresenceConfig
	>;
	/** Security policy shared by channel auth and server-mediated publish routes. */
	channelSecurity?: import("#questpie/server/channels/security.js").ChannelSecurityConfig;

	/**
	 * Reconciliation poll interval in ms. Polling runs alongside brokers so a
	 * dropped wake-up notice cannot stall delivery indefinitely.
	 *
	 * @default 15000 with a broker or Postgres connection; 2000 without one
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
