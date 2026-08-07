import { and, asc, desc, isNull, lt, sql } from "drizzle-orm";

import {
	opaqueChannelAuthoritySubject,
	resolveChannelAuthoritySubject,
} from "#questpie/server/channels/authority.js";
import type {
	ChannelAuthorityRevocation,
	ChannelAuthorityRevocationReceipt,
} from "#questpie/server/channels/service.js";
import {
	getCurrentTransaction,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { DrizzleClientFromQuestpieConfig } from "#questpie/server/config/types.js";
import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";

import { CoreNoticeRouter } from "../collaboration/notice-router.js";
import { PgNotifyChangeBroker } from "./adapters/pg-notify.js";
import { ChannelAuthorityFenceStore } from "./channel-authority-fence.js";
import {
	type AppendChannelEventInput,
	type AppendChannelEventOptions,
	ChannelEventLedger,
	type ChannelEventReceipt,
	type ChannelReplayPage,
	hashResolvedChannel,
	type LocalChannelSubscriptionInput,
} from "./channel-event-ledger.js";
import { questpieRealtimeLogTable } from "./collection.js";
import {
	RealtimeObservability,
	type RealtimeMetricsSnapshot,
	type RealtimeObservation,
} from "./observer.js";
import {
	type RegisterChannelPresenceInput,
	SseChannelPresenceRegistry,
} from "./sse-channel-presence.js";
import {
	compileRealtimeTopicRouting,
	evaluateRealtimeChangeRouting,
	RealtimeCandidateRouter,
	type RealtimeTopicRoutingPlan,
} from "./topic-routing.js";
import {
	createPostgresRealtimeTopologyCoordinator,
	type RealtimeDesiredTopology,
	RealtimeTopologyCoordinator,
	type RealtimeTopologyApplyInput,
	type RealtimeTopologyResult,
} from "./topology-coordinator.js";
import type {
	ClientAuthInput,
	ClientAuthResponse,
	ClientConfigInput,
	ClientSink,
	ClientTransport,
	ClientTransportConfig,
	ClientUserAuthInput,
	ClientUserAuthResponse,
	EdgeSessionInput,
	OrderedChannelDelivery,
	SinkWriteResult,
} from "./transport.js";
import type {
	RealtimeChangeEvent,
	RealtimeChangePayload,
	RealtimeConfig,
	RealtimeErrorListener,
	RealtimeOperation,
	RealtimeResourceType,
	RealtimeSubscriptionContext,
} from "./types.js";

export type RealtimeListener = (event: RealtimeChangeEvent) => void;

type AppendChangeInput = Omit<
	RealtimeChangeEvent,
	"seq" | "txid" | "createdAt"
>;

const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_ADAPTER_RECONCILIATION_INTERVAL_MS = 15_000;

/**
 * Where one node has read to in the outbox, in the order changes settle.
 *
 * `seq` alone cannot express this: it is allocated when a row is inserted, not
 * when its transaction commits, so a lower `seq` can settle after a higher one.
 */
type RealtimeDrainCursor = { txid: string; seq: number };

/** Before any row: xid8 0 is below every assigned transaction id. */
const EMPTY_DRAIN_CURSOR: RealtimeDrainCursor = { txid: "0", seq: 0 };

/** How soon to look again when a committed change is not yet readable. */
const SETTLEMENT_RETRY_MS = 250;

/**
 * Is this change strictly after the cursor in settled order?
 *
 * The read already says so in SQL; this keeps the same promise on the way out,
 * so no driver quirk can turn "read from here" into a replay.
 */
function isAfterCursor(
	event: Pick<RealtimeChangeEvent, "seq" | "txid">,
	cursor: RealtimeDrainCursor,
): boolean {
	if (event.txid === undefined) return event.seq > cursor.seq;
	const txid = BigInt(event.txid);
	const from = BigInt(cursor.txid);
	return txid > from || (txid === from && event.seq > cursor.seq);
}

type ListenerEntry = {
	listener: RealtimeListener;
	errorListener?: RealtimeErrorListener;
	topics: import("./types").RealtimeTopics;
	routing: RealtimeTopicRoutingPlan;
	// Track which resources this listener cares about (main + dependencies)
	watchedResources: {
		collections: Set<string>;
		globals: Set<string>;
	};
};

export class RealtimeService {
	readonly nativeDeltasEnabled: boolean;
	/** @internal Shared physical notice lifecycle for realtime and CRDT. */
	readonly noticeRouter: CoreNoticeRouter;
	private readonly hasPhysicalBroker: boolean;
	private unsubscribeNotices?: () => Promise<void>;
	private clientTransport?: ClientTransport;
	private listeners = new Set<ListenerEntry>();
	private directCollectionListeners = new Map<string, Set<ListenerEntry>>();
	private directCollectionRouters = new Map<
		string,
		RealtimeCandidateRouter<ListenerEntry>
	>();
	private directGlobalListeners = new Map<string, Set<ListenerEntry>>();
	private watchedCollectionListeners = new Map<string, Set<ListenerEntry>>();
	private watchedGlobalListeners = new Map<string, Set<ListenerEntry>>();
	private pollIntervalMs: number;
	private readonly configuredPollIntervalMs: number;
	private batchSize: number;
	private draining = false;
	private drainPending = false;
	private drainSignalGeneration = 0;
	private started = false;
	private startPromise: Promise<void> | null = null;
	private publisherStartPromise: Promise<void> | null = null;
	private publisherStarted = false;
	private cursor: RealtimeDrainCursor = EMPTY_DRAIN_CURSOR;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private settlementRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private subscriptionContext?: RealtimeSubscriptionContext;
	private retentionDays?: number;
	private retentionCleanupIntervalMs: number;
	private nextRetentionCleanupAt = 0;
	private retentionCleanupInProgress = false;
	private readonly channelEventLedger: ChannelEventLedger;
	private readonly authorityFences: ChannelAuthorityFenceStore;
	private readonly channelPresenceRegistry: SseChannelPresenceRegistry;
	private readonly topologyCoordinator: RealtimeTopologyCoordinator;
	private channelPollTimer: ReturnType<typeof setInterval> | null = null;
	private localChannelSubscriptionCount = 0;
	private unsubscribeChannelNotices?: () => Promise<void>;
	private channelNoticeStartPromise: Promise<void> | null = null;
	private nextChannelCleanupAt = 0;
	private readonly observability: RealtimeObservability;

	constructor(
		// TODO: this should be typed better
		private db: DrizzleClientFromQuestpieConfig<any>,
		config: RealtimeConfig = {},
		private pgConnectionString?: string,
		private logger?: Pick<LoggerAdapter, "error" | "warn">,
		noticeRouter?: CoreNoticeRouter,
	) {
		this.nativeDeltasEnabled = config.nativeDeltas === true;
		const broker =
			config.changeBroker ??
			(this.pgConnectionString
				? new PgNotifyChangeBroker({
						connectionString: this.pgConnectionString,
					})
				: undefined);
		this.noticeRouter = noticeRouter ?? new CoreNoticeRouter(broker);
		this.hasPhysicalBroker = Boolean(broker || noticeRouter);
		this.clientTransport = config.clientTransport;
		this.batchSize = config.batchSize ?? 500;
		this.pollIntervalMs =
			config.pollIntervalMs ??
			(this.hasPhysicalBroker || this.pgConnectionString
				? DEFAULT_ADAPTER_RECONCILIATION_INTERVAL_MS
				: 2000);
		this.configuredPollIntervalMs = this.pollIntervalMs;
		this.observability = new RealtimeObservability({
			observer: config.observer,
			logger: this.logger,
			drainLagAlertMs:
				this.configuredPollIntervalMs > 0
					? this.configuredPollIntervalMs
					: Number.POSITIVE_INFINITY,
		});
		this.topologyCoordinator = createPostgresRealtimeTopologyCoordinator(
			this.db,
			{
				broker: this.noticeRouter,
				reconcileMs: this.configuredPollIntervalMs,
				observer: this.observability,
				onError: (error) =>
					this.reportTransportFailure(
						"[Realtime] Topology coordinator failed",
						error,
					),
			},
		);
		this.channelEventLedger = new ChannelEventLedger(
			this.db,
			this.noticeRouter,
			this.clientTransport,
			config.channelEvents,
			this.logger,
			() => (this.clientTransport ? this.initialize() : Promise.resolve()),
			this.observability,
		);
		this.authorityFences = new ChannelAuthorityFenceStore(this.db);
		this.channelPresenceRegistry = new SseChannelPresenceRegistry(
			this.db,
			config.channelPresence,
			this.logger,
		);
		this.retentionDays =
			config.retentionDays === undefined
				? DEFAULT_RETENTION_DAYS
				: config.retentionDays > 0
					? config.retentionDays
					: undefined;
		this.retentionCleanupIntervalMs = 60 * 60 * 1000;
	}

	observe(event: RealtimeObservation): void {
		this.observability.record(event);
	}

	record(event: RealtimeObservation): void {
		this.observe(event);
	}

	getMetrics(): RealtimeMetricsSnapshot {
		return this.observability.snapshot();
	}

	/**
	 * Set context for resolving dependencies from WITH config.
	 * Called by QUESTPIE to provide collection/global resolution functions.
	 */
	setSubscriptionContext(context: RealtimeSubscriptionContext): void {
		this.subscriptionContext = context;
	}

	private reportTransportFailure(message: string, error: unknown): void {
		this.logger?.error(message, error);
		const listeners = Array.from(this.listeners);
		for (const entry of listeners) {
			try {
				entry.errorListener?.(error);
			} catch (listenerError) {
				this.logger?.error(
					"[Realtime] Error listener failed while reporting a transport failure",
					listenerError,
				);
			}
		}
	}

	private ensureStartedSafely(): void {
		if (this.started || this.startPromise) return;
		void this.ensureStarted().catch((error) => {
			this.reportTransportFailure("[Realtime] Transport startup failed", error);
		});
	}

	private drainSafely(
		reason: "broker" | "poll" | "reconnect" | "startup" = "broker",
	): void {
		void this.drain(reason).catch((error) => {
			this.reportTransportFailure("[Realtime] Outbox drain failed", error);
		});
	}

	private drainOrDeferUntilStarted(reason: "broker" | "reconnect"): void {
		this.drainSignalGeneration += 1;
		// Only a started service has a seeded cursor. `initialize()` runs at boot
		// on every node while `ensureStarted()` is reachable only from
		// `subscribe()`, so a node with no subscribers used to drain from seq 0
		// and walk the whole retained outbox — three days of it by default — into
		// an empty listener set, on every deploy.
		if (!this.started) return;
		this.drainSafely(reason);
	}

	private cleanupSafely(force = false): void {
		void this.scheduleRetentionCleanup(force).catch((error) => {
			this.logger?.warn("[Realtime] Outbox cleanup failed", error);
		});
	}

	private stopSafely(): void {
		void this.stop().catch((error) => {
			this.logger?.error("[Realtime] Transport shutdown failed", error);
		});
	}

	private addIndexedListener(
		index: Map<string, Set<ListenerEntry>>,
		resource: string,
		entry: ListenerEntry,
	): void {
		if (!index.has(resource)) {
			index.set(resource, new Set());
		}

		index.get(resource)?.add(entry);
	}

	private removeIndexedListener(
		index: Map<string, Set<ListenerEntry>>,
		resource: string,
		entry: ListenerEntry,
	): void {
		const listeners = index.get(resource);
		if (!listeners) return;

		listeners.delete(entry);
		if (listeners.size === 0) {
			index.delete(resource);
		}
	}

	private collectIndexedCandidates(
		index: Map<string, Set<ListenerEntry>>,
		resource: string,
		collector: Set<ListenerEntry>,
	): void {
		const exact = index.get(resource);
		if (exact) {
			for (const entry of exact) collector.add(entry);
		}

		const wildcard = index.get("*");
		if (wildcard) {
			for (const entry of wildcard) collector.add(entry);
		}
	}

	async appendChange(input: AppendChangeInput): Promise<RealtimeChangeEvent> {
		const currentTransaction = getCurrentTransaction();
		if (currentTransaction) {
			return this.appendChangeInTransaction(input, currentTransaction);
		}
		return withTransaction(this.db, (tx) =>
			this.appendChangeInTransaction(input, tx),
		);
	}

	private async appendChangeInTransaction(
		input: AppendChangeInput,
		db: DrizzleClientFromQuestpieConfig<any>,
	): Promise<RealtimeChangeEvent> {
		// Capture takes no fleet-wide lock. It used to UPDATE a single head row so
		// that sequence order was commit order, and PostgreSQL holds that row lock
		// until COMMIT — on the *caller's* business transaction. So exactly one
		// capture in the whole cluster could be in flight at a time: measured
		// throughput FELL as writers were added (57 -> 44 -> 35 captures/s at
		// 4 -> 8 -> 16 writers, against 115 -> 145 -> 267 without it), one long
		// transaction starved every other writer for its whole duration, and the
		// head row was a mid-transaction lock-ordering point that turned ordinary
		// row conflicts into deadlocks.
		//
		// Readers no longer need sequence order to be commit order: `readAfter`
		// walks the log in `(txid, seq)` order below PostgreSQL's own visibility
		// watermark. See `readAfter` for why that is gap-free.
		let row: typeof questpieRealtimeLogTable.$inferSelect;
		try {
			[row] = await db
				.insert(questpieRealtimeLogTable)
				.values({
					resourceType: input.resourceType,
					resource: input.resource,
					operation: input.operation,
					recordId: input.recordId ?? null,
					locale: input.locale ?? null,
					payload: input.payload ?? {},
				})
				.returning();
			this.observe({ type: "outbox.capture", outcome: "accepted" });
		} catch (error) {
			this.observe({ type: "outbox.capture", outcome: "failed" });
			throw error;
		}

		const event: RealtimeChangeEvent = {
			seq: Number(row.seq),
			...(row.txid === null ? {} : { txid: row.txid }),
			resourceType: row.resourceType as RealtimeResourceType,
			resource: row.resource,
			operation: row.operation as RealtimeOperation,
			recordId: row.recordId ?? null,
			locale: row.locale ?? null,
			payload: (row.payload ?? {}) as RealtimeChangePayload,
			createdAt: row.createdAt,
		};

		this.cleanupSafely();
		return event;
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		if (!this.hasPhysicalBroker) return;
		await this.initialize();
		await this.publishObserved(() =>
			this.noticeRouter.publish({
				kind: "outbox-maybe-advanced",
				highWaterSeq: event.seq,
				reason: "publish",
			}),
		);
	}

	private async publishObserved(publish: () => Promise<void>): Promise<void> {
		try {
			await publish();
			this.observe({ type: "broker.publish", seam: "v2", outcome: "accepted" });
		} catch (error) {
			this.observe({ type: "broker.publish", seam: "v2", outcome: "failed" });
			throw error;
		}
	}

	async initialize(): Promise<void> {
		if (this.publisherStarted) return;
		if (this.publisherStartPromise) {
			await this.publisherStartPromise;
			return;
		}

		this.publisherStartPromise = (async () => {
			this.unsubscribeNotices = await this.noticeRouter.subscribe({
				kind: "realtime",
				onNotice: ({ wake }) => {
					if (wake.kind === "topology-maybe-advanced") {
						this.topologyCoordinator.onWake(wake);
						return;
					}
					if (wake.kind === "channel-events-maybe-advanced") {
						void this.channelEventLedger
							.drain(wake.channelHash)
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Channel ledger drain failed",
									error,
								),
							);
						return;
					}
					if (wake.kind === "channel-authority-maybe-advanced") {
						void this.channelEventLedger
							.drain(wake.channelHash)
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Channel authority reconciliation failed",
									error,
								),
							);
						return;
					}
					this.drainOrDeferUntilStarted(
						wake.reason === "reconnect" ? "reconnect" : "broker",
					);
				},
				onError: (error) =>
					this.reportTransportFailure("[Realtime] Change broker failed", error),
				onStateChange: (state) => {
					this.observe({ type: "broker.lifecycle", state });
					if (state === "connected") {
						this.setReconciliationPollInterval(this.configuredPollIntervalMs);
						this.drainOrDeferUntilStarted("reconnect");
						void this.channelEventLedger
							.drain()
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Channel reconnect drain failed",
									error,
								),
							);
					} else if (state === "unavailable" || state === "failed") {
						this.setReconciliationPollInterval(
							this.configuredPollIntervalMs > 0
								? Math.min(this.configuredPollIntervalMs, 2000)
								: 0,
						);
					}
				},
				onOverflow: () => {
					this.drainOrDeferUntilStarted("reconnect");
					void this.channelEventLedger
						.drain()
						.catch((error) =>
							this.reportTransportFailure(
								"[Realtime] Channel overflow reconciliation failed",
								error,
							),
						);
					void this.topologyCoordinator
						.reconcile()
						.catch((error) =>
							this.reportTransportFailure(
								"[Realtime] Topology overflow reconciliation failed",
								error,
							),
						);
				},
			});
			await this.topologyCoordinator.start();
			await this.clientTransport?.start({
				onError: (error) =>
					this.reportTransportFailure(
						"[Realtime] Client transport failed",
						error,
					),
			});
			this.publisherStarted = true;
			this.startChannelPollTimer();
			await this.channelEventLedger.drain();
		})().finally(() => {
			this.publisherStartPromise = null;
		});
		await this.publisherStartPromise;
	}

	/** @internal Register the local owner before exposing session capability data. */
	async openTopologySession(input: {
		sessionId: string;
		token: string;
		identity: string;
		topology: RealtimeDesiredTopology;
		clientLeaseMs?: number;
		apply: (input: RealtimeTopologyApplyInput) => Promise<void>;
		onClose: () => Promise<void> | void;
	}): Promise<{
		generation: number;
		signal: AbortSignal;
		close(): Promise<void>;
	}> {
		await this.initialize();
		return this.topologyCoordinator.open(input);
	}

	/** @internal Commit one complete versioned desired topology. */
	async submitTopology(input: {
		sessionId: string;
		token: string;
		identity: string;
		topology: RealtimeDesiredTopology;
	}): Promise<RealtimeTopologyResult> {
		await this.initialize();
		return this.topologyCoordinator.submit(input);
	}

	/** @internal Validate a live topology capability for a CRDT binding. */
	async authorizeTopologySession(input: {
		sessionId: string;
		token: string;
		identity: string;
	}): Promise<{ sessionKey: string; ownerGeneration: number } | null> {
		await this.initialize();
		return this.topologyCoordinator.authorizeSession(input);
	}

	async getClientTransportConfig(
		input: ClientConfigInput,
	): Promise<ClientTransportConfig> {
		if (!this.clientTransport) return { transport: "sse" };
		await this.initialize();
		return this.clientTransport.getClientConfig(input);
	}

	async openClientSession(input: EdgeSessionInput): Promise<ClientSink> {
		await this.initialize();
		if (!this.clientTransport) {
			throw new Error("No configured realtime client transport");
		}
		const sink = await this.clientTransport.openSession(input);
		const transport =
			this.clientTransport.channelDeliveryScope === "shared-provider"
				? "shared-provider"
				: "sse";
		this.observe({ type: "session.opened", transport });
		let closed = false;
		return {
			sessionId: sink.sessionId,
			...(sink.clientChannel ? { clientChannel: sink.clientChannel } : {}),
			write: async (frame, delivery) => {
				try {
					const result = await sink.write(frame, delivery);
					this.observe({
						type: "sink.write",
						delivery,
						outcome: result.status,
						bufferedBytes: result.bufferedBytes ?? 0,
					});
					return result;
				} catch (error) {
					this.observe({
						type: "sink.write",
						delivery,
						outcome: "failed",
						bufferedBytes: 0,
					});
					throw error;
				}
			},
			close: async (reason) => {
				if (!closed) {
					closed = true;
					this.observe({ type: "session.closed", transport, reason });
				}
				await sink.close(reason);
			},
		};
	}

	async generateClientAuth(
		input: ClientAuthInput,
	): Promise<ClientAuthResponse> {
		await this.initialize();
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider"
		) {
			throw new Error("Realtime provider auth is not configured");
		}
		try {
			const auth = await this.clientTransport.generateAuth(input);
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "allowed",
				reason: "allowed",
			});
			return auth;
		} catch (error) {
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "denied",
				reason: "access_denied",
			});
			throw error;
		}
	}

	/**
	 * Optimistically evaluate policy and encode one side-effect-free provider
	 * grant, then publish it only when the expected subject generation still
	 * matches. Provider I/O is never serialized under a database lock.
	 */
	async generateAuthorizedClientAuth(
		input: Omit<ClientAuthInput, "presence"> & { scope: "channel" },
		authorize: () => Promise<{
			presence?: ClientAuthInput["presence"];
		}>,
	): Promise<ClientAuthResponse> {
		await this.initialize();
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider"
		) {
			throw new Error("Realtime provider auth is not configured");
		}
		const clientTransport = this.clientTransport;
		if (clientTransport.channelGrantMode !== "stateless-signed-grant") {
			throw new Error(
				"Shared provider does not support stateless signed channel grants",
			);
		}
		const grant = async () => {
			const authorization = await authorize();
			return clientTransport.generateAuth({
				...input,
				...(authorization.presence ? { presence: authorization.presence } : {}),
			});
		};
		try {
			const authoritySubject = resolveChannelAuthoritySubject({
				principal: input.principal,
			});
			if (!authoritySubject) {
				const auth = await grant();
				this.observe({
					type: "channel.security",
					verb: "grant",
					outcome: "allowed",
					reason: "allowed",
				});
				return auth;
			}
			const subject = opaqueChannelAuthoritySubject(authoritySubject);
			const channelHash = hashResolvedChannel(input.channel);
			await this.authorityFences.ensure({ channelHash, subject });
			const generation = await this.authorityFences.read({
				channelHash,
				subject,
			});
			const auth = await grant();
			const admission = await this.authorityFences.admitExpected(
				{ channelHash, subject, expectedGeneration: generation },
				{ publish: () => undefined },
			);
			if (!admission.admitted) {
				throw new Error("Channel authority changed during provider grant");
			}
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "allowed",
				reason: "allowed",
			});
			return auth;
		} catch (error) {
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "denied",
				reason: "access_denied",
			});
			throw error;
		}
	}

	async generateClientUserAuth(
		input: ClientUserAuthInput,
	): Promise<ClientUserAuthResponse> {
		await this.initialize();
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider" ||
			!this.clientTransport.generateUserAuth
		) {
			throw new Error("Realtime provider user auth is not configured");
		}
		try {
			const auth = await this.clientTransport.generateUserAuth(input);
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "allowed",
				reason: "allowed",
			});
			return auth;
		} catch (error) {
			this.observe({
				type: "channel.security",
				verb: "grant",
				outcome: "denied",
				reason: "access_denied",
			});
			throw error;
		}
	}

	async publishChannel(
		input: OrderedChannelDelivery,
	): Promise<SinkWriteResult> {
		await this.initialize();
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider"
		) {
			throw new Error("Shared-provider channel delivery is not configured");
		}
		return this.clientTransport.publishChannel(input);
	}

	async appendChannelEvent(
		input: AppendChannelEventInput,
		options: AppendChannelEventOptions = {},
	): Promise<ChannelEventReceipt> {
		const receipt = await this.channelEventLedger.append(input, options);
		this.cleanupChannelEventsSafely();
		return receipt;
	}

	async revokeChannelAuthority(
		input: ChannelAuthorityRevocation,
		options: AppendChannelEventOptions = {},
	): Promise<ChannelAuthorityRevocationReceipt> {
		if (this.clientTransport) await this.initialize();
		const subject = opaqueChannelAuthoritySubject(input.subject);
		return this.channelEventLedger.revokeAuthority(
			{
				channel: input.channel,
				subject,
				transportSubject: input.subject,
				idempotencyKey: input.idempotencyKey,
			},
			options,
		);
	}

	async subscribeChannel(
		input: Omit<LocalChannelSubscriptionInput, "stage"> & {
			presence?: RegisterChannelPresenceInput;
		},
	): Promise<() => Promise<void>> {
		if (this.clientTransport) await this.initialize();
		const { presence, ...subscription } = input;
		let counted = false;
		let finalized = false;
		const finalizeLocalSubscription = async () => {
			if (finalized) return;
			finalized = true;
			if (counted) {
				this.localChannelSubscriptionCount = Math.max(
					0,
					this.localChannelSubscriptionCount - 1,
				);
			}
			await this.stopIdleLocalChannelReconciliation();
		};
		const release = await this.channelEventLedger.subscribeLocal({
			...subscription,
			onRelease: finalizeLocalSubscription,
			...(presence
				? { stage: this.channelPresenceRegistry.stage(presence) }
				: {}),
		});
		if (this.clientTransport) return release;
		if (
			!this.channelEventLedger.hasLocalSubscription(subscription.subscriptionId)
		) {
			return release;
		}
		counted = true;
		this.localChannelSubscriptionCount += 1;
		try {
			await this.ensureLocalChannelReconciliation();
		} catch (error) {
			await release();
			throw error;
		}
		return async () => {
			await release();
			await finalizeLocalSubscription();
		};
	}

	/** Read a bounded page after route-level channel authorization. */
	replayChannelEvents(
		channel: string,
		afterEventId: string,
	): Promise<ChannelReplayPage> {
		return this.channelEventLedger.replay(channel, afterEventId);
	}

	async registerChannelPresence(
		input: RegisterChannelPresenceInput,
	): Promise<() => Promise<void>> {
		if (this.clientTransport) await this.initialize();
		return this.channelPresenceRegistry.register(input);
	}

	private setReconciliationPollInterval(intervalMs: number): void {
		if (this.pollIntervalMs === intervalMs) return;
		this.pollIntervalMs = intervalMs;
		this.topologyCoordinator.setReconciliationPollInterval(intervalMs);
		if (this.channelPollTimer) {
			clearInterval(this.channelPollTimer);
			this.channelPollTimer = null;
		}
		if (this.publisherStarted) this.startChannelPollTimer();
		if (!this.started) return;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.startPollTimer();
	}

	private startPollTimer(): void {
		if (this.pollIntervalMs <= 0 || this.pollTimer) return;
		this.pollTimer = setInterval(() => {
			this.drainSafely("poll");
		}, this.pollIntervalMs);
	}

	private startChannelPollTimer(): void {
		if (
			this.pollIntervalMs <= 0 ||
			this.channelPollTimer ||
			(!this.clientTransport && this.localChannelSubscriptionCount === 0)
		) {
			return;
		}
		this.channelPollTimer = setInterval(() => {
			void this.channelEventLedger.drain().catch((error) => {
				this.reportTransportFailure(
					"[Realtime] Channel reconciliation failed",
					error,
				);
			});
			this.cleanupChannelEventsSafely();
		}, this.pollIntervalMs);
	}

	private async ensureLocalChannelReconciliation(): Promise<void> {
		if (this.clientTransport) return;
		if (this.unsubscribeChannelNotices) {
			this.startChannelPollTimer();
			return;
		}
		if (!this.channelNoticeStartPromise) {
			this.channelNoticeStartPromise = (async () => {
				this.unsubscribeChannelNotices = await this.noticeRouter.subscribe({
					kind: "realtime",
					onNotice: ({ wake }) => {
						if (
							wake.kind !== "channel-events-maybe-advanced" &&
							wake.kind !== "channel-authority-maybe-advanced"
						) {
							return;
						}
						void this.channelEventLedger
							.drain(wake.channelHash)
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Local channel reconciliation failed",
									error,
								),
							);
					},
					onError: (error) =>
						this.reportTransportFailure(
							"[Realtime] Local channel notice failed",
							error,
						),
					onStateChange: (state) => {
						if (state !== "connected") return;
						void this.channelEventLedger
							.drain()
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Local channel reconnect failed",
									error,
								),
							);
					},
					onOverflow: () => {
						void this.channelEventLedger
							.drain()
							.catch((error) =>
								this.reportTransportFailure(
									"[Realtime] Local channel overflow failed",
									error,
								),
							);
					},
				});
			})().finally(() => {
				this.channelNoticeStartPromise = null;
			});
		}
		await this.channelNoticeStartPromise;
		this.startChannelPollTimer();
	}

	private async stopIdleLocalChannelReconciliation(): Promise<void> {
		if (this.clientTransport || this.localChannelSubscriptionCount > 0) return;
		if (this.channelPollTimer) {
			clearInterval(this.channelPollTimer);
			this.channelPollTimer = null;
		}
		if (this.channelNoticeStartPromise) await this.channelNoticeStartPromise;
		await this.unsubscribeChannelNotices?.();
		this.unsubscribeChannelNotices = undefined;
	}

	private cleanupChannelEventsSafely(force = false): void {
		const now = Date.now();
		if (!force && now < this.nextChannelCleanupAt) return;
		this.nextChannelCleanupAt = now + 60 * 60 * 1000;
		void this.channelEventLedger.cleanup().catch((error) => {
			this.logger?.warn("[Realtime] Channel ledger cleanup failed", error);
		});
	}

	/**
	 * Run realtime outbox cleanup immediately.
	 *
	 * Useful for scheduled queue jobs (for example starter module cron jobs).
	 */
	async cleanupOutbox(force = true): Promise<void> {
		await this.scheduleRetentionCleanup(force);
	}

	subscribe(
		listener: RealtimeListener,
		topics?: import("./types").RealtimeTopics,
		errorListener?: RealtimeErrorListener,
	): () => void {
		const resolvedTopics = topics ?? {
			resourceType: "collection",
			resource: "*",
		};
		const relationNames =
			resolvedTopics.resourceType === "collection"
				? this.subscriptionContext?.resolveCollectionRelationNames?.(
						resolvedTopics.resource,
					)
				: undefined;
		const routing = compileRealtimeTopicRouting(
			resolvedTopics.where,
			relationNames,
		);
		this.observe({
			type: "routing.plan",
			anchor: routing.anchors.length > 0 ? "required" : "missing",
			feature: routing.features.values().next().value ?? "none",
		});

		// Resolve dependencies from both the requested relation graph and the
		// access-merged WHERE. A change to an access relation must rebootstrap a
		// delta topic even when that relation was not requested in the output.
		let watchedResources: { collections: Set<string>; globals: Set<string> };

		if (resolvedTopics.resourceType === "collection") {
			const withCollections =
				this.subscriptionContext?.resolveCollectionDependencies?.(
					resolvedTopics.resource,
					resolvedTopics.with,
				) ?? new Set([resolvedTopics.resource]);
			const whereCollections =
				this.subscriptionContext?.resolveCollectionDependencies?.(
					resolvedTopics.resource,
					resolvedTopics.where,
				) ?? new Set([resolvedTopics.resource]);
			const collections = new Set([...withCollections, ...whereCollections]);
			watchedResources = { collections, globals: new Set() };
		} else if (
			resolvedTopics.resourceType === "global" &&
			resolvedTopics.with
		) {
			watchedResources = this.subscriptionContext?.resolveGlobalDependencies?.(
				resolvedTopics.resource,
				resolvedTopics.with,
			) ?? {
				collections: new Set(),
				globals: new Set([resolvedTopics.resource]),
			};
		} else {
			watchedResources = {
				collections: new Set(),
				globals: new Set([resolvedTopics.resource]),
			};
		}

		const entry: ListenerEntry = {
			listener,
			errorListener,
			topics: resolvedTopics,
			routing,
			watchedResources,
		};

		this.listeners.add(entry);

		if (
			resolvedTopics.resourceType === "collection" &&
			resolvedTopics.resource !== "*"
		) {
			let router = this.directCollectionRouters.get(resolvedTopics.resource);
			if (!router) {
				router = new RealtimeCandidateRouter();
				this.directCollectionRouters.set(resolvedTopics.resource, router);
			}
			router.add(entry, routing);
		} else {
			const directIndex =
				resolvedTopics.resourceType === "collection"
					? this.directCollectionListeners
					: this.directGlobalListeners;
			this.addIndexedListener(directIndex, resolvedTopics.resource, entry);
		}

		for (const resource of watchedResources.collections) {
			if (
				resolvedTopics.resourceType === "collection" &&
				resource === resolvedTopics.resource
			) {
				continue;
			}
			this.addIndexedListener(this.watchedCollectionListeners, resource, entry);
		}

		for (const resource of watchedResources.globals) {
			if (
				resolvedTopics.resourceType === "global" &&
				resource === resolvedTopics.resource
			) {
				continue;
			}
			this.addIndexedListener(this.watchedGlobalListeners, resource, entry);
		}

		this.ensureStartedSafely();

		return () => {
			this.listeners.delete(entry);

			if (
				resolvedTopics.resourceType === "collection" &&
				resolvedTopics.resource !== "*"
			) {
				const router = this.directCollectionRouters.get(
					resolvedTopics.resource,
				);
				router?.delete(entry);
			} else {
				const removeDirectIndex =
					resolvedTopics.resourceType === "collection"
						? this.directCollectionListeners
						: this.directGlobalListeners;
				this.removeIndexedListener(
					removeDirectIndex,
					resolvedTopics.resource,
					entry,
				);
			}

			for (const resource of watchedResources.collections) {
				if (
					resolvedTopics.resourceType === "collection" &&
					resource === resolvedTopics.resource
				) {
					continue;
				}
				this.removeIndexedListener(
					this.watchedCollectionListeners,
					resource,
					entry,
				);
			}

			for (const resource of watchedResources.globals) {
				if (
					resolvedTopics.resourceType === "global" &&
					resource === resolvedTopics.resource
				) {
					continue;
				}
				this.removeIndexedListener(
					this.watchedGlobalListeners,
					resource,
					entry,
				);
			}
		};
	}

	/**
	 * The highest sequence that is settled fleet-wide.
	 *
	 * Deliberately NOT `max(seq)`. Without the head lock a visible row can still
	 * be un-settled — its transaction id may sit above the current watermark
	 * while an older transaction is open — and a stamp taken from such a row is
	 * not a value the scheduler may stamp. The returned row itself is settled;
	 * lower sequence numbers may still belong to later transaction ids, so the
	 * scalar remains a resume hint rather than the drain cursor.
	 */
	async getLatestSeq(): Promise<number> {
		const rows = await this.readSettledSeqHead();
		return rows?.seq ?? 0;
	}

	private async readSettledSeqHead(): Promise<{
		seq: number;
		txid: string;
	} | null> {
		const rows = await this.db
			.select({
				seq: questpieRealtimeLogTable.seq,
				txid: questpieRealtimeLogTable.txid,
			})
			.from(questpieRealtimeLogTable)
			.where(
				sql`${questpieRealtimeLogTable.txid} < pg_snapshot_xmin(pg_current_snapshot())`,
			)
			.orderBy(desc(questpieRealtimeLogTable.seq))
			.limit(1);
		const row = rows[0];
		if (!row?.txid) return null;
		return { seq: Number(row.seq), txid: String(row.txid) };
	}

	/**
	 * Decide what a resuming subscriber owes its client.
	 *
	 * `current` means "provably nothing happened that this client has not
	 * already applied", which is what lets a deploy-restart storm reconnect
	 * without every topic recomputing. It is only claimed when BOTH hold:
	 *
	 * - `sinceSeq` is the settled head, so the client's own data was computed
	 *   from a snapshot at or after the moment that row settled, and
	 * - no visible row has a transaction id above that row's, so nothing has
	 *   committed since — including rows whose `seq` is *lower* than
	 *   `sinceSeq`, which is exactly the case a `seq` comparison cannot see.
	 *
	 * Anything else falls back to one authoritative recompute, which is
	 * suppressed on the wire when the result hashes the same.
	 */
	async getResumeState(sinceSeq: number): Promise<{
		latestSeq: number;
		reset: boolean;
		current: boolean;
	}> {
		const settled = await this.readSettledSeqHead();
		const latestSeq = settled?.seq ?? 0;
		if (sinceSeq === latestSeq && settled) {
			const newestTxid = await this.readNewestTxid();
			// String compare would order "9" after "10"; xid8 is a 64-bit counter.
			const current =
				newestTxid !== null && BigInt(newestTxid) <= BigInt(settled.txid);
			if (current) return { latestSeq, reset: false, current: true };
		}
		if (sinceSeq < 0 || sinceSeq > latestSeq) {
			return { latestSeq, reset: true, current: false };
		}
		if (latestSeq === 0) {
			return { latestSeq, reset: sinceSeq !== 0, current: false };
		}

		const rows = await this.db
			.select({ seq: questpieRealtimeLogTable.seq })
			.from(questpieRealtimeLogTable)
			.orderBy(asc(questpieRealtimeLogTable.seq))
			.limit(1);
		const oldestSeq = rows[0]?.seq ? Number(rows[0].seq) : latestSeq;
		return { latestSeq, reset: sinceSeq < oldestSeq - 1, current: false };
	}

	/**
	 * Newest transaction id in the visible log, settled or not.
	 *
	 * Rows written before `txid` existed (3.17) have none, and PostgreSQL sorts
	 * those first under `DESC`, so a log still holding them answers `null` and
	 * the resume fast path stays off until retention clears them.
	 */
	private async readNewestTxid(): Promise<string | null> {
		const rows = await this.db
			.select({ txid: questpieRealtimeLogTable.txid })
			.from(questpieRealtimeLogTable)
			.orderBy(desc(questpieRealtimeLogTable.txid))
			.limit(1);
		const txid = rows[0]?.txid;
		return txid == null ? null : String(txid);
	}

	/**
	 * Read the next batch of changes in the fleet-wide settled order.
	 *
	 * Two rules together make this gap-free without any lock:
	 *
	 * 1. Only rows whose `txid` is strictly below the reading snapshot's `xmin`
	 *    are eligible. Every transaction with an id below `xmin` has already
	 *    ended, so that set is stable and only ever grows.
	 * 2. The cursor is the composite `(txid, seq)`, ordered by `txid` then `seq`.
	 *    When `xmin` advances, every newly eligible row has `txid >=` the
	 *    previous `xmin`, which is strictly greater than the cursor's `txid`
	 *    (rule 1 keeps the cursor below the watermark it was read at). So new
	 *    rows always sort after everything already read, and the visible prefix
	 *    stays contiguous.
	 *
	 * The `seq` half of the cursor alone is NOT enough. Transaction ids and
	 * `seq` are assigned independently and can invert: a transaction that took
	 * its xid early but appended late gets a low `txid` with a high `seq`, so a
	 * `WHERE seq > cursor` reader advances past a lower `seq` that is still
	 * uncommitted and skips it forever once it commits. That is measured, not
	 * theoretical — see `.private/realtime-research-2026-08-05/probes/
	 * xid-seq-inversion.ts`, which fails against the seq-only cursor.
	 *
	 * Aborted transactions need no handling: their rows are never visible, and
	 * a row is only eligible once its transaction has ended.
	 */
	private async readAfter(
		cursor: RealtimeDrainCursor,
	): Promise<RealtimeChangeEvent[]> {
		const rows = await this.db
			.select({
				seq: questpieRealtimeLogTable.seq,
				txid: questpieRealtimeLogTable.txid,
				resourceType: questpieRealtimeLogTable.resourceType,
				resource: questpieRealtimeLogTable.resource,
				operation: questpieRealtimeLogTable.operation,
				recordId: questpieRealtimeLogTable.recordId,
				locale: questpieRealtimeLogTable.locale,
				payload: questpieRealtimeLogTable.payload,
				createdAt: questpieRealtimeLogTable.createdAt,
			})
			.from(questpieRealtimeLogTable)
			.where(
				and(
					sql`${questpieRealtimeLogTable.txid} < pg_snapshot_xmin(pg_current_snapshot())`,
					sql`(${questpieRealtimeLogTable.txid}, ${questpieRealtimeLogTable.seq}) > (${cursor.txid}::text::xid8, ${cursor.seq}::bigint)`,
				),
			)
			.orderBy(
				asc(questpieRealtimeLogTable.txid),
				asc(questpieRealtimeLogTable.seq),
			)
			.limit(this.batchSize);

		return rows
			.map((row: any) => ({
				seq: Number(row.seq),
				...(row.txid == null ? {} : { txid: String(row.txid) }),
				resourceType: row.resourceType as RealtimeResourceType,
				resource: row.resource,
				operation: row.operation as RealtimeOperation,
				recordId: row.recordId ?? null,
				locale: row.locale ?? null,
				payload: (row.payload ?? {}) as RealtimeChangePayload,
				createdAt: row.createdAt,
			}))
			.filter((event) => isAfterCursor(event, cursor));
	}

	/**
	 * The newest settled position: the log's composite head below the visibility
	 * watermark. A booting node adopts it so it delivers what happens next
	 * instead of replaying the retained log, and never adopts a position that
	 * could still be overtaken by an open transaction.
	 */
	private async readSettledHead(): Promise<RealtimeDrainCursor> {
		const rows = await this.db
			.select({
				seq: questpieRealtimeLogTable.seq,
				txid: questpieRealtimeLogTable.txid,
			})
			.from(questpieRealtimeLogTable)
			.where(
				sql`${questpieRealtimeLogTable.txid} < pg_snapshot_xmin(pg_current_snapshot())`,
			)
			.orderBy(
				desc(questpieRealtimeLogTable.txid),
				desc(questpieRealtimeLogTable.seq),
			)
			.limit(1);
		const row = rows[0];
		if (!row?.txid) return EMPTY_DRAIN_CURSOR;
		return { txid: String(row.txid), seq: Number(row.seq) };
	}

	private async ensureStarted(): Promise<void> {
		if (this.started) return;
		if (this.startPromise) {
			await this.startPromise;
			return;
		}

		this.startPromise = (async () => {
			const signalGeneration = this.drainSignalGeneration;
			this.cursor = await this.readSettledHead();
			this.started = true;
			await this.initialize();

			this.startPollTimer();
			if (this.drainSignalGeneration === signalGeneration) {
				this.drainSafely("startup");
			}
			this.cleanupSafely(true);
		})()
			.catch(async (error) => {
				this.started = false;

				if (this.pollTimer) {
					clearInterval(this.pollTimer);
					this.pollTimer = null;
				}

				throw error;
			})
			.finally(() => {
				this.startPromise = null;
			});

		await this.startPromise;
	}

	async destroy(): Promise<void> {
		await this.topologyCoordinator.stop();
		await this.channelPresenceRegistry.destroy();
		await this.stop();
	}

	private async stop(): Promise<void> {
		if (
			!this.started &&
			!this.startPromise &&
			!this.publisherStarted &&
			!this.publisherStartPromise &&
			!this.unsubscribeNotices &&
			!this.unsubscribeChannelNotices &&
			!this.channelNoticeStartPromise &&
			!this.channelPollTimer &&
			this.localChannelSubscriptionCount === 0
		) {
			return;
		}

		if (this.publisherStartPromise) {
			try {
				await this.publisherStartPromise;
			} catch {
				// startup already failed, continue cleanup
			}
		}

		if (this.startPromise) {
			try {
				await this.startPromise;
			} catch (error) {
				this.logger?.warn(
					"[Realtime] Transport startup failed before shutdown",
					error,
				);
			}
		}
		if (this.channelNoticeStartPromise) {
			try {
				await this.channelNoticeStartPromise;
			} catch {
				// channel-only notice startup already failed, continue cleanup
			}
		}

		this.started = false;

		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.settlementRetryTimer) {
			clearTimeout(this.settlementRetryTimer);
			this.settlementRetryTimer = null;
		}
		if (this.channelPollTimer) {
			clearInterval(this.channelPollTimer);
			this.channelPollTimer = null;
		}

		await this.channelEventLedger.destroy();
		await this.unsubscribeChannelNotices?.();
		this.unsubscribeChannelNotices = undefined;
		this.localChannelSubscriptionCount = 0;
		await this.unsubscribeNotices?.();
		this.unsubscribeNotices = undefined;
		await this.clientTransport?.stop();
		this.publisherStarted = false;
	}

	private async drain(
		reason: "broker" | "poll" | "reconnect" | "startup",
	): Promise<void> {
		if (this.draining) {
			this.drainPending = true;
			return;
		}
		this.draining = true;
		const startedAt = performance.now();
		const initialSeq = this.cursor.seq;
		let rows = 0;
		let newestCreatedAt: Date | undefined;

		try {
			while (true) {
				const events = await this.readAfter(this.cursor);
				if (events.length === 0) break;
				rows += events.length;
				newestCreatedAt = events.at(-1)?.createdAt;

				const last = events[events.length - 1];
				// `readAfter` filters on `txid`, so a row reaching here without one
				// only happens behind a test double; keep the cursor's own id then.
				this.cursor = { txid: last.txid ?? this.cursor.txid, seq: last.seq };
				for (const event of events) {
					this.emit(event);
				}

				if (events.length < this.batchSize) break;
			}
			this.observe({
				type: "drain.completed",
				reason,
				rows,
				seqDelta: Math.max(0, this.cursor.seq - initialSeq),
				lagMs: newestCreatedAt
					? Math.max(0, Date.now() - newestCreatedAt.getTime())
					: 0,
				durationMs: performance.now() - startedAt,
				healed: reason === "poll" && rows > 0,
			});
		} catch (error) {
			this.observe({ type: "drain.failed", reason });
			throw error;
		} finally {
			const shouldDrainAgain = this.drainPending;
			this.drainPending = false;
			this.draining = false;

			if (shouldDrainAgain) {
				this.drainSafely(reason);
			} else {
				this.scheduleSettlementRetry();
			}
		}
	}

	/**
	 * Come back for changes that are committed but not yet readable.
	 *
	 * A change is only drained once its transaction id falls below the reading
	 * snapshot's `xmin`, which an OLDER open write transaction holds back. The
	 * publisher's own wake-up already fired by then, so without this the change
	 * would wait for the next reconciliation poll — 15 seconds by default —
	 * every time any long write transaction overlaps it.
	 *
	 * The probe asks for any row after the cursor, not only one currently above
	 * `xmin`: the blocker can end between the empty drain statement and this
	 * statement. In that race the row is already readable, but still needs the
	 * retry because its original broker wake has passed.
	 */
	private scheduleSettlementRetry(): void {
		if (!this.started || this.settlementRetryTimer) return;
		void this.hasPendingChange()
			.then((pending) => {
				if (!pending || !this.started || this.settlementRetryTimer) return;
				this.settlementRetryTimer = setTimeout(() => {
					this.settlementRetryTimer = null;
					this.drainSafely("poll");
				}, SETTLEMENT_RETRY_MS);
			})
			.catch((error) => {
				this.logger?.warn("[Realtime] Settlement probe failed", error);
			});
	}

	/** Is any visible change still beyond this node's composite cursor? */
	private async hasPendingChange(): Promise<boolean> {
		const rows = await this.db
			.select({ seq: questpieRealtimeLogTable.seq })
			.from(questpieRealtimeLogTable)
			.where(
				sql`(${questpieRealtimeLogTable.txid}, ${questpieRealtimeLogTable.seq}) > (${this.cursor.txid}::text::xid8, ${this.cursor.seq}::bigint)`,
			)
			.limit(1);
		return rows.length > 0;
	}

	private emit(event: RealtimeChangeEvent): void {
		const candidates = new Set<ListenerEntry>();
		if (event.resourceType === "collection") {
			const routed = this.directCollectionRouters
				.get(event.resource)
				?.candidates(event);
			if (routed) {
				for (const entry of routed) candidates.add(entry);
			}
			this.collectIndexedCandidates(
				this.directCollectionListeners,
				event.resource,
				candidates,
			);
			this.collectIndexedCandidates(
				this.watchedCollectionListeners,
				event.resource,
				candidates,
			);
		} else {
			this.collectIndexedCandidates(
				this.directGlobalListeners,
				event.resource,
				candidates,
			);
			this.collectIndexedCandidates(
				this.watchedGlobalListeners,
				event.resource,
				candidates,
			);
		}
		this.observe({ type: "routing.candidates", groups: candidates.size });

		const notifiedListeners = new Set<ListenerEntry>();

		for (const entry of candidates) {
			if (notifiedListeners.has(entry)) continue;

			const isDirectMatch =
				entry.topics.resourceType === event.resourceType &&
				(entry.topics.resource === event.resource ||
					entry.topics.resource === "*");

			if (!isDirectMatch) {
				notifiedListeners.add(entry);
				continue;
			}

			const outcome = evaluateRealtimeChangeRouting(entry.routing, event);
			this.observe({ type: "routing.guard", outcome });
			if (outcome !== "miss") {
				notifiedListeners.add(entry);
			}
		}

		// Notify all collected listeners
		for (const entry of notifiedListeners) {
			try {
				entry.listener(event);
			} catch (error) {
				this.logger?.error("[Realtime] Realtime listener failed", error);
			}
		}

		this.cleanupSafely();
	}

	private async scheduleRetentionCleanup(force = false): Promise<void> {
		const hasTimeRetention = !!this.retentionDays && this.retentionDays > 0;
		if (!hasTimeRetention) return;

		const now = Date.now();
		if (!force && now < this.nextRetentionCleanupAt) return;
		if (this.retentionCleanupInProgress) return;

		this.retentionCleanupInProgress = true;
		this.nextRetentionCleanupAt = now + this.retentionCleanupIntervalMs;

		try {
			const cutoff = new Date(
				now - (this.retentionDays as number) * 24 * 60 * 60 * 1000,
			);
			// Retention starts when a row is first OBSERVED as settled, not when its
			// transaction inserted it. `created_at` is the transaction start time, so
			// an old transaction can commit a row that is already beyond the retention
			// window while an even older xid still keeps it above the drain frontier.
			// Deleting by `created_at` would erase that row before any node was allowed
			// to read it. Marking only rows below the same xmin gate as `readAfter`
			// gives every newly drainable prefix a full retention window.
			await this.db
				.update(questpieRealtimeLogTable)
				.set({ settledAt: new Date(now) })
				.where(
					and(
						isNull(questpieRealtimeLogTable.settledAt),
						sql`${questpieRealtimeLogTable.txid} < pg_snapshot_xmin(pg_current_snapshot())`,
					),
				);
			await this.db
				.delete(questpieRealtimeLogTable)
				.where(lt(questpieRealtimeLogTable.settledAt, cutoff));
		} catch (error) {
			// Best-effort cleanup; keep realtime delivery resilient to cleanup failures.
			this.logger?.warn("[Realtime] Outbox cleanup failed", error);
		} finally {
			this.retentionCleanupInProgress = false;
		}
	}
}
