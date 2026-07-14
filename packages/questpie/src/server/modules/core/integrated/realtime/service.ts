import { asc, desc, gt, lt } from "drizzle-orm";

import type { DrizzleClientFromQuestpieConfig } from "#questpie/server/config/types.js";
import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";

import type { RealtimeAdapter } from "./adapter.js";
import { PgNotifyAdapter } from "./adapters/pg-notify.js";
import {
	type AppendChannelEventInput,
	type AppendChannelEventOptions,
	ChannelEventLedger,
	type ChannelEventReceipt,
	type LocalChannelSubscriptionInput,
} from "./channel-event-ledger.js";
import { questpieRealtimeLogTable } from "./collection.js";
import type {
	ChangeBroker,
	ClientAuthInput,
	ClientAuthResponse,
	ClientConfigInput,
	ClientSink,
	ClientTransport,
	ClientTransportConfig,
	EdgeSessionInput,
	OrderedChannelDelivery,
	SinkWriteResult,
} from "./transport.js";
import type {
	RealtimeChangeEvent,
	RealtimeChangePayload,
	RealtimeConfig,
	RealtimeDualRunComparison,
	RealtimeErrorListener,
	RealtimeNotice,
	RealtimeOperation,
	RealtimeResourceType,
	RealtimeSubscriptionContext,
} from "./types.js";

export type RealtimeListener = (event: RealtimeChangeEvent) => void;

type AppendChangeInput = Omit<RealtimeChangeEvent, "seq" | "createdAt">;

type AppendChangeOptions = {
	db?: DrizzleClientFromQuestpieConfig<any>;
};

const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_ADAPTER_RECONCILIATION_INTERVAL_MS = 15_000;

type ListenerEntry = {
	listener: RealtimeListener;
	errorListener?: RealtimeErrorListener;
	topics: import("./types").RealtimeTopics;
	whereFilters: Record<string, unknown>;
	hasComplexWhere: boolean;
	// Track which resources this listener cares about (main + dependencies)
	watchedResources: {
		collections: Set<string>;
		globals: Set<string>;
	};
};

/** Compare a durable scalar projection with a normalized equality filter. */
function projectionMatch(
	projection: Record<string, unknown> | null | undefined,
	filters: Record<string, unknown>,
): "match" | "miss" | "unknown" {
	if (projection === null) return "miss";
	if (!projection || typeof projection !== "object") return "unknown";
	let missing = false;
	for (const [key, value] of Object.entries(filters)) {
		if (!(key in projection)) {
			missing = true;
			continue;
		}
		if (projection[key] !== value) return "miss";
	}
	return missing ? "unknown" : "match";
}

/**
 * Analyze WHERE clause for realtime matching strategy.
 * - `filters`: simple equality subset used for fast create matching
 * - `hasComplex`: true when where contains logical operators or non-equality operators
 *
 * When `hasComplex` is true we must avoid strict payload-only filtering to prevent
 * false negatives (stale snapshots) for create events.
 */
function analyzeWhere(where: any): {
	filters: Record<string, unknown>;
	hasComplex: boolean;
} {
	if (!where || typeof where !== "object") {
		return { filters: {}, hasComplex: false };
	}

	const filters: Record<string, unknown> = {};
	let hasComplex = false;

	for (const [key, value] of Object.entries(where)) {
		if (["AND", "OR", "NOT", "RAW"].includes(key)) {
			hasComplex = true;
			continue;
		}

		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			filters[key] = value;
			continue;
		}

		if (value && typeof value === "object") {
			const valueObject = value as Record<string, unknown>;
			if ("eq" in valueObject) {
				filters[key] = valueObject.eq;

				const operatorKeys = Object.keys(valueObject).filter((k) => k !== "eq");
				if (operatorKeys.length > 0) {
					hasComplex = true;
				}
				continue;
			}

			hasComplex = true;
			continue;
		}

		hasComplex = true;
	}

	return { filters, hasComplex };
}

export class RealtimeService {
	private adapter?: RealtimeAdapter;
	private changeBroker?: ChangeBroker;
	private clientTransport?: ClientTransport;
	private readonly transportMode: "legacy" | "v2" | "dual";
	private readonly onDualRunComparison?: (
		comparison: RealtimeDualRunComparison,
	) => void;
	private listeners = new Set<ListenerEntry>();
	private directCollectionListeners = new Map<string, Set<ListenerEntry>>();
	private directGlobalListeners = new Map<string, Set<ListenerEntry>>();
	private watchedCollectionListeners = new Map<string, Set<ListenerEntry>>();
	private watchedGlobalListeners = new Map<string, Set<ListenerEntry>>();
	private pollIntervalMs: number;
	private readonly configuredPollIntervalMs: number;
	private batchSize: number;
	private draining = false;
	private drainPending = false;
	private started = false;
	private startPromise: Promise<void> | null = null;
	private publisherStartPromise: Promise<void> | null = null;
	private publisherStarted = false;
	private lastSeq = 0;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private unsubscribeAdapter: (() => void) | null = null;
	private unsubscribeAdapterState: (() => void) | null = null;
	private subscriptionContext?: RealtimeSubscriptionContext;
	private retentionDays?: number;
	private retentionCleanupIntervalMs: number;
	private nextRetentionCleanupAt = 0;
	private retentionCleanupInProgress = false;
	private readonly channelEventLedger: ChannelEventLedger;
	private channelPollTimer: ReturnType<typeof setInterval> | null = null;
	private nextChannelCleanupAt = 0;

	constructor(
		// TODO: this should be typed better
		private db: DrizzleClientFromQuestpieConfig<any>,
		config: RealtimeConfig = {},
		private pgConnectionString?: string,
		private logger?: Pick<LoggerAdapter, "error" | "warn">,
	) {
		this.transportMode = config.rollout?.mode ?? "v2";
		this.onDualRunComparison = config.rollout?.onComparison;
		if (
			this.transportMode === "dual" &&
			(!config.adapter || !config.changeBroker)
		) {
			throw new Error(
				'Realtime rollout mode "dual" requires both adapter and changeBroker',
			);
		}

		let compatibleAdapter = config.adapter;
		if (
			!compatibleAdapter &&
			this.pgConnectionString &&
			(this.transportMode === "legacy" || !config.changeBroker)
		) {
			compatibleAdapter = new PgNotifyAdapter({
				connectionString: this.pgConnectionString,
				channel: "questpie_realtime",
			});
		}

		if (this.transportMode === "legacy") {
			this.adapter = compatibleAdapter;
		} else if (this.transportMode === "dual") {
			this.adapter = config.adapter;
			this.changeBroker = config.changeBroker;
			this.clientTransport = config.clientTransport;
		} else {
			this.changeBroker = config.changeBroker;
			this.adapter = this.changeBroker ? undefined : compatibleAdapter;
			this.clientTransport = config.clientTransport;
		}
		this.channelEventLedger = new ChannelEventLedger(
			this.db,
			this.changeBroker,
			this.clientTransport,
			config.channelEvents,
			this.logger,
			() => this.initialize(),
		);
		this.batchSize = config.batchSize ?? 500;
		this.pollIntervalMs =
			config.pollIntervalMs ??
			(this.adapter || this.changeBroker || this.pgConnectionString
				? DEFAULT_ADAPTER_RECONCILIATION_INTERVAL_MS
				: 2000);
		this.configuredPollIntervalMs = this.pollIntervalMs;
		this.retentionDays =
			config.retentionDays === undefined
				? DEFAULT_RETENTION_DAYS
				: config.retentionDays > 0
					? config.retentionDays
					: undefined;
		this.retentionCleanupIntervalMs = 60 * 60 * 1000;
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

	private drainSafely(): void {
		void this.drain().catch((error) => {
			this.reportTransportFailure("[Realtime] Outbox drain failed", error);
		});
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

	async appendChange(
		input: AppendChangeInput,
		options: AppendChangeOptions = {},
	): Promise<RealtimeChangeEvent> {
		const db = options.db ?? this.db;
		const [row] = await db
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

		const event = {
			seq: Number(row.seq),
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
		if (!this.adapter && !this.changeBroker) return;
		await this.initialize();
		if (this.transportMode === "dual") {
			const wake = {
				kind: "outbox-maybe-advanced" as const,
				highWaterSeq: event.seq,
				reason: "publish" as const,
			};
			const [legacyResult, v2Result] = await Promise.allSettled([
				this.adapter!.notify(event),
				this.changeBroker!.publish(wake),
			]);
			const comparison: RealtimeDualRunComparison = {
				seq: event.seq,
				legacy: legacyResult.status === "fulfilled" ? "accepted" : "rejected",
				v2: v2Result.status === "fulfilled" ? "accepted" : "rejected",
				equivalent: legacyResult.status === v2Result.status,
				...(legacyResult.status === "rejected"
					? { legacyError: legacyResult.reason }
					: {}),
				...(v2Result.status === "rejected" ? { v2Error: v2Result.reason } : {}),
			};
			if (!comparison.equivalent) {
				this.logger?.warn(
					"[Realtime] Dual-run invalidation transports diverged",
					comparison,
				);
			}
			try {
				this.onDualRunComparison?.(comparison);
			} catch (error) {
				this.logger?.warn(
					"[Realtime] Dual-run comparison observer failed",
					error,
				);
			}
			if (
				legacyResult.status === "rejected" &&
				v2Result.status === "rejected"
			) {
				throw new AggregateError(
					[legacyResult.reason, v2Result.reason],
					"Both realtime dual-run invalidation transports failed",
				);
			}
			return;
		}
		await Promise.all([
			this.adapter?.notify(event),
			this.changeBroker?.publish({
				kind: "outbox-maybe-advanced",
				highWaterSeq: event.seq,
				reason: "publish",
			}),
		]);
	}

	async initialize(): Promise<void> {
		if (this.publisherStarted) return;
		if (this.publisherStartPromise) {
			await this.publisherStartPromise;
			return;
		}

		this.publisherStartPromise = (async () => {
			await this.adapter?.startPublisher?.();
			await this.changeBroker?.start({
				onWake: (wake) => {
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
					this.drainSafely();
				},
				onError: (error) =>
					this.reportTransportFailure("[Realtime] Change broker failed", error),
				onStateChange: (state) => {
					if (state === "connected") {
						this.setReconciliationPollInterval(this.configuredPollIntervalMs);
						this.drainSafely();
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
			});
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

	async getClientTransportConfig(
		input: ClientConfigInput,
	): Promise<ClientTransportConfig> {
		await this.initialize();
		if (!this.clientTransport) return { transport: "sse" };
		return this.clientTransport.getClientConfig(input);
	}

	async openClientSession(input: EdgeSessionInput): Promise<ClientSink> {
		await this.initialize();
		if (!this.clientTransport) {
			throw new Error("No configured realtime client transport");
		}
		return this.clientTransport.openSession(input);
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
		return this.clientTransport.generateAuth(input);
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

	async subscribeChannel(
		input: LocalChannelSubscriptionInput,
	): Promise<() => void> {
		await this.initialize();
		return this.channelEventLedger.subscribeLocal(input);
	}

	private setReconciliationPollInterval(intervalMs: number): void {
		if (this.pollIntervalMs === intervalMs) return;
		this.pollIntervalMs = intervalMs;
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
			this.drainSafely();
		}, this.pollIntervalMs);
	}

	private startChannelPollTimer(): void {
		if (
			!this.clientTransport ||
			this.pollIntervalMs <= 0 ||
			this.channelPollTimer
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
		const whereAnalysis = analyzeWhere(resolvedTopics.where);

		// Resolve dependencies from WITH config
		let watchedResources: { collections: Set<string>; globals: Set<string> };

		if (resolvedTopics.resourceType === "collection" && resolvedTopics.with) {
			const collections =
				this.subscriptionContext?.resolveCollectionDependencies?.(
					resolvedTopics.resource,
					resolvedTopics.with,
				) ?? new Set([resolvedTopics.resource]);
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
			// No WITH config - only watch main resource
			watchedResources =
				resolvedTopics.resourceType === "collection"
					? {
							collections: new Set([resolvedTopics.resource]),
							globals: new Set(),
						}
					: {
							collections: new Set(),
							globals: new Set([resolvedTopics.resource]),
						};
		}

		const entry: ListenerEntry = {
			listener,
			errorListener,
			topics: resolvedTopics,
			whereFilters: whereAnalysis.filters,
			hasComplexWhere: whereAnalysis.hasComplex,
			watchedResources,
		};

		this.listeners.add(entry);

		const directIndex =
			resolvedTopics.resourceType === "collection"
				? this.directCollectionListeners
				: this.directGlobalListeners;
		this.addIndexedListener(directIndex, resolvedTopics.resource, entry);

		for (const resource of watchedResources.collections) {
			this.addIndexedListener(this.watchedCollectionListeners, resource, entry);
		}

		for (const resource of watchedResources.globals) {
			this.addIndexedListener(this.watchedGlobalListeners, resource, entry);
		}

		this.ensureStartedSafely();

		return () => {
			this.listeners.delete(entry);

			const removeDirectIndex =
				resolvedTopics.resourceType === "collection"
					? this.directCollectionListeners
					: this.directGlobalListeners;
			this.removeIndexedListener(
				removeDirectIndex,
				resolvedTopics.resource,
				entry,
			);

			for (const resource of watchedResources.collections) {
				this.removeIndexedListener(
					this.watchedCollectionListeners,
					resource,
					entry,
				);
			}

			for (const resource of watchedResources.globals) {
				this.removeIndexedListener(
					this.watchedGlobalListeners,
					resource,
					entry,
				);
			}
		};
	}

	async getLatestSeq(): Promise<number> {
		const rows = await this.db
			.select({ seq: questpieRealtimeLogTable.seq })
			.from(questpieRealtimeLogTable)
			.orderBy(desc(questpieRealtimeLogTable.seq))
			.limit(1);
		return rows[0]?.seq ? Number(rows[0].seq) : 0;
	}

	async getResumeState(
		sinceSeq: number,
	): Promise<{ latestSeq: number; reset: boolean }> {
		const latestSeq = await this.getLatestSeq();
		if (sinceSeq === latestSeq) return { latestSeq, reset: false };
		if (sinceSeq < 0 || sinceSeq > latestSeq) {
			return { latestSeq, reset: true };
		}
		if (latestSeq === 0) return { latestSeq, reset: sinceSeq !== 0 };

		const rows = await this.db
			.select({ seq: questpieRealtimeLogTable.seq })
			.from(questpieRealtimeLogTable)
			.orderBy(asc(questpieRealtimeLogTable.seq))
			.limit(1);
		const oldestSeq = rows[0]?.seq ? Number(rows[0].seq) : latestSeq;
		return { latestSeq, reset: sinceSeq < oldestSeq - 1 };
	}

	private async readSince(seq: number): Promise<RealtimeChangeEvent[]> {
		const rows = await this.db
			.select({
				seq: questpieRealtimeLogTable.seq,
				resourceType: questpieRealtimeLogTable.resourceType,
				resource: questpieRealtimeLogTable.resource,
				operation: questpieRealtimeLogTable.operation,
				recordId: questpieRealtimeLogTable.recordId,
				locale: questpieRealtimeLogTable.locale,
				payload: questpieRealtimeLogTable.payload,
				createdAt: questpieRealtimeLogTable.createdAt,
			})
			.from(questpieRealtimeLogTable)
			.where(gt(questpieRealtimeLogTable.seq, seq))
			.orderBy(asc(questpieRealtimeLogTable.seq))
			.limit(this.batchSize);

		return rows.map((row: any) => ({
			seq: Number(row.seq),
			resourceType: row.resourceType as RealtimeResourceType,
			resource: row.resource,
			operation: row.operation as RealtimeOperation,
			recordId: row.recordId ?? null,
			locale: row.locale ?? null,
			payload: (row.payload ?? {}) as RealtimeChangePayload,
			createdAt: row.createdAt,
		}));
	}

	private async ensureStarted(): Promise<void> {
		if (this.started) return;
		if (this.startPromise) {
			await this.startPromise;
			return;
		}

		this.startPromise = (async () => {
			await this.initialize();
			const latestSeq = await this.getLatestSeq();

			if (this.adapter) {
				await this.adapter.start();
				this.unsubscribeAdapter = this.adapter.subscribe(() => {
					this.drainSafely();
				});
				this.unsubscribeAdapterState =
					this.adapter.onStateChange?.((state) => {
						if (state === "connected") {
							void this.drain();
						}
					}) ?? null;
			}

			this.startPollTimer();

			this.lastSeq = latestSeq;
			this.started = true;
			this.drainSafely();
			this.cleanupSafely(true);
		})()
			.catch(async (error) => {
				this.started = false;

				if (this.pollTimer) {
					clearInterval(this.pollTimer);
					this.pollTimer = null;
				}

				if (this.unsubscribeAdapter) {
					this.unsubscribeAdapter();
					this.unsubscribeAdapter = null;
				}

				if (this.unsubscribeAdapterState) {
					this.unsubscribeAdapterState();
					this.unsubscribeAdapterState = null;
				}

				if (this.adapter) {
					try {
						await this.adapter.stop();
					} catch (stopError) {
						this.logger?.warn(
							"[Realtime] Transport cleanup after failed startup failed",
							stopError,
						);
					}
				}

				throw error;
			})
			.finally(() => {
				this.startPromise = null;
			});

		await this.startPromise;
	}

	async destroy(): Promise<void> {
		await this.stop();
	}

	private async stop(): Promise<void> {
		if (
			!this.started &&
			!this.startPromise &&
			!this.publisherStarted &&
			!this.publisherStartPromise
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

		this.started = false;

		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.channelPollTimer) {
			clearInterval(this.channelPollTimer);
			this.channelPollTimer = null;
		}

		if (this.unsubscribeAdapter) {
			this.unsubscribeAdapter();
			this.unsubscribeAdapter = null;
		}

		if (this.unsubscribeAdapterState) {
			this.unsubscribeAdapterState();
			this.unsubscribeAdapterState = null;
		}

		if (this.adapter) {
			await this.adapter.stop();
		}
		this.channelEventLedger.destroy();
		await this.changeBroker?.stop();
		await this.clientTransport?.stop();
		this.publisherStarted = false;
	}

	private async drain(): Promise<void> {
		if (this.draining) {
			this.drainPending = true;
			return;
		}
		this.draining = true;

		try {
			while (true) {
				const events = await this.readSince(this.lastSeq);
				if (events.length === 0) break;

				this.lastSeq = events[events.length - 1].seq;
				for (const event of events) {
					this.emit(event);
				}

				if (events.length < this.batchSize) break;
			}
		} finally {
			const shouldDrainAgain = this.drainPending;
			this.drainPending = false;
			this.draining = false;

			if (shouldDrainAgain) {
				void this.drain();
			}
		}
	}

	private emit(event: RealtimeChangeEvent): void {
		const candidates = new Set<ListenerEntry>();
		if (event.resourceType === "collection") {
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

			if (!entry.topics.where) {
				notifiedListeners.add(entry);
				continue;
			}

			// Complex WHERE clauses cannot be safely evaluated from payload-only filters.
			// Refresh to avoid false negatives for OR/nested/operator-heavy conditions.
			if (entry.hasComplexWhere) {
				notifiedListeners.add(entry);
				continue;
			}

			const before = projectionMatch(event.payload?.before, entry.whereFilters);
			const after = projectionMatch(event.payload?.after, entry.whereFilters);
			const definitelyUnrelated =
				(event.operation === "create" && after === "miss") ||
				(event.operation === "delete" && before === "miss") ||
				(event.operation === "update" && before === "miss" && after === "miss");

			if (!definitelyUnrelated) {
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
			await this.db
				.delete(questpieRealtimeLogTable)
				.where(lt(questpieRealtimeLogTable.createdAt, cutoff));
		} catch (error) {
			// Best-effort cleanup; keep realtime delivery resilient to cleanup failures.
			this.logger?.warn("[Realtime] Outbox cleanup failed", error);
		} finally {
			this.retentionCleanupInProgress = false;
		}
	}

	static noticeFromEvent(event: RealtimeChangeEvent): RealtimeNotice {
		return {
			seq: event.seq,
			resourceType: event.resourceType,
			resource: event.resource,
			operation: event.operation,
		};
	}
}
