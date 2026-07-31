import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
	CHANNEL_MAX_PAYLOAD_BYTES,
	ChannelSecurityError,
} from "#questpie/server/channels/security.js";
import {
	getCurrentTransaction,
	onAfterCommit,
	withTransactionOrExisting,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";
import {
	parseCompatibleTypedEventWire,
	stringifyCompatibleTypedEventWire,
} from "#questpie/shared/typed-wire.js";

import { ChannelAuthorityFenceStore } from "./channel-authority-fence.js";
import {
	questpieChannelDispatchTable,
	questpieChannelEventTable,
	questpieChannelHeadTable,
} from "./collection.js";
import type { RealtimeObservation, RealtimeObserver } from "./observer.js";
import type {
	ChannelGapFrame,
	ChangePublisher,
	ClientAuthoritySubject,
	ClientSink,
	ClientTransport,
	OrderedChannelDelivery,
	OrderedChannelEventFrame,
	SinkWriteResult,
} from "./transport.js";

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_EVENTS = 100;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_BATCH_SIZE = 500;
const PROVIDER_REVOCATION_TIMEOUT_MS = 5_000;

export type ChannelEventLedgerConfig = {
	/** Maximum age of replayable events. Set to 0 to disable time cleanup. */
	retentionMs: number;
	/** Maximum total retained payload bytes. Set to 0 to disable size cleanup. */
	retentionBytes: number;
	/** Maximum ordered events queued behind a busy local sink. */
	maxBufferedEvents: number;
	/** Maximum ordered bytes queued behind a busy local sink. */
	maxBufferedBytes: number;
	/** Shared-provider per-channel coordinator lease duration. */
	coordinatorLeaseMs: number;
	/** Retry delay for a busy local sink. */
	busyRetryMs: number;
	/** Maximum rows read in one channel-local batch. */
	batchSize: number;
};

export type AppendChannelEventInput = {
	channel: string;
	event: string;
	schemaIdentity: string;
	data: unknown;
};

export type AppendChannelEventOptions = {
	db?: AnyDrizzleClient<any>;
};

export type ChannelEventReceipt = Readonly<{
	eventId: string;
}>;

export type ChannelReplayPage =
	| Readonly<{
			status: "events";
			events: readonly Readonly<{
				eventId: string;
				event: string;
				data: unknown;
			}>[];
			hasMore: boolean;
	  }>
	| Readonly<{
			status: "gap";
			requestedEventId: string;
			oldestEventId: string | null;
	  }>;

export type LocalChannelBindingLifecycle = {
	/** Starts timers and client-visible snapshots after the publication commits. */
	activate(): Promise<void>;
	/** Removes every durable and local artifact. Must be idempotent. */
	deactivate(): Promise<void>;
	/** Installs a short expected-generation guard for owned heartbeat SQL. */
	setRenewalGuard?(
		guard: (
			operation: (tx: AnyDrizzleClient<any>) => Promise<void>,
		) => Promise<boolean>,
	): void;
};

export type LocalChannelBindingStage = {
	/** Owned SQL which establishes the lock ordered before authority fences. */
	beforeFence?(tx: AnyDrizzleClient<any>): Promise<void>;
	/** Owned SQL publication; no policy, sink, provider, or timer callbacks. */
	publish(
		tx: AnyDrizzleClient<any>,
		authorization?: LocalChannelAuthorization,
	): Promise<LocalChannelBindingLifecycle>;
};

export type LocalChannelAuthorization =
	| boolean
	| Readonly<{
			authorized: boolean;
			presence?: Record<string, unknown>;
	  }>;

export type LocalChannelSubscriptionInput = {
	subscriptionId: string;
	channel: string;
	/** Opaque stable subject. Raw user/session identifiers are not accepted here. */
	subject?: string;
	/** Resolve a fresh request and application context before reauthorizing. */
	reauthorize?: () => Promise<LocalChannelAuthorization>;
	/**
	 * Framework-owned state staged in the same short authority publication.
	 * @internal
	 */
	stage?: LocalChannelBindingStage;
	sink: ClientSink;
	/** Close only this logical binding when supplied by a multiplexed session. */
	close?: (reason: "access_revoked") => Promise<void>;
	/** @internal Runs exactly once for caller release or an internal close. */
	onRelease?: () => Promise<void>;
	lastEventId?: string | null;
	encodeFrame?: (
		frame: OrderedChannelEventFrame | ChannelGapFrame,
	) => Uint8Array;
};

type ChannelEventRow = typeof questpieChannelEventTable.$inferSelect;

type LocalSubscription = {
	id: string;
	channel: string;
	channelHash: string;
	sink: ClientSink;
	cursor: number;
	readSeq: number;
	pending: ChannelEventRow[];
	pendingBytes: number;
	drainPromise: Promise<void> | null;
	drainPending: boolean;
	closed: boolean;
	retryTimer: ReturnType<typeof setTimeout> | null;
	subject?: string;
	authorityGeneration?: number;
	reauthorize?: () => Promise<LocalChannelAuthorization>;
	close?: LocalChannelSubscriptionInput["close"];
	onRelease?: LocalChannelSubscriptionInput["onRelease"];
	encodeFrame?: LocalChannelSubscriptionInput["encodeFrame"];
	active: boolean;
	lifecycle?: LocalChannelBindingLifecycle;
};

export function hashResolvedChannel(channel: string): string {
	return createHash("sha256").update(channel).digest("hex");
}

function channelEventId(channelHash: string, seq: number): string {
	return `${channelHash}:${seq}`;
}

function parseChannelEventId(
	eventId: string,
): { channelHash: string; seq: number } | null {
	const match = /^([a-f0-9]{64}):(\d+)$/.exec(eventId);
	if (!match) return null;
	const seq = Number(match[2]);
	if (!Number.isSafeInteger(seq) || seq < 0) return null;
	return { channelHash: match[1], seq };
}

function canonicalChannelEnvelope(
	eventId: string,
	event: string,
	data: unknown,
): { wireJson: string; sizeBytes: number } {
	let wireJson: string | undefined;
	try {
		wireJson = stringifyCompatibleTypedEventWire({ eventId, event, data });
	} catch {
		throw new ChannelSecurityError(
			"channel_payload_invalid",
			"Channel event data must be JSON serializable",
		);
	}
	if (wireJson === undefined) {
		throw new ChannelSecurityError(
			"channel_payload_invalid",
			"Channel event data must be JSON serializable",
		);
	}
	const sizeBytes = new TextEncoder().encode(wireJson).byteLength;
	if (sizeBytes > CHANNEL_MAX_PAYLOAD_BYTES) {
		throw new ChannelSecurityError(
			"channel_payload_too_large",
			"Channel event envelope exceeds the 10,000-byte limit",
		);
	}
	return { wireJson, sizeBytes };
}

function isAuthorized(authorization: LocalChannelAuthorization): boolean {
	return (
		authorization === true ||
		(typeof authorization === "object" && authorization.authorized === true)
	);
}

async function withProviderRevocationTimeout<T>(
	operation: Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error("Shared provider authority revocation timed out")),
					PROVIDER_REVOCATION_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function hasPostgresErrorCode(error: unknown, code: string): boolean {
	let current = error;
	const seen = new Set<object>();
	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ((current as { code?: unknown }).code === code) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/**
 * Durable ordered-channel log and delivery coordinator.
 *
 * ChangeBroker wakes are deliberately notice-only. Every delivery path drains
 * this ledger, so duplicate or missing wakes cannot duplicate or stall events.
 */
export class ChannelEventLedger {
	private readonly config: ChannelEventLedgerConfig;
	private readonly instanceId = crypto.randomUUID();
	private readonly encoder = new TextEncoder();
	private readonly authorityFences: ChannelAuthorityFenceStore;
	private readonly localSubscriptions = new Map<string, LocalSubscription>();
	private readonly subscriptionsByChannel = new Map<
		string,
		Set<LocalSubscription>
	>();
	private sharedDrainPending = false;
	private sharedDrainPromise: Promise<void> | null = null;
	private cleanupInProgress = false;

	constructor(
		private readonly db: AnyDrizzleClient<any>,
		private readonly changeBroker: ChangePublisher | undefined,
		private readonly clientTransport: ClientTransport | undefined,
		config: Partial<ChannelEventLedgerConfig> = {},
		private readonly logger?: Pick<LoggerAdapter, "error" | "warn">,
		private readonly ensureDeliveryStarted?: () => Promise<void>,
		private readonly observer?: RealtimeObserver,
	) {
		this.authorityFences = new ChannelAuthorityFenceStore(this.db);
		this.config = {
			retentionMs: config.retentionMs ?? DEFAULT_RETENTION_MS,
			retentionBytes: config.retentionBytes ?? DEFAULT_RETENTION_BYTES,
			maxBufferedEvents:
				config.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS,
			maxBufferedBytes: config.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
			coordinatorLeaseMs: config.coordinatorLeaseMs ?? DEFAULT_LEASE_MS,
			busyRetryMs: config.busyRetryMs ?? DEFAULT_RETRY_MS,
			batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
		};
	}

	private observe(event: RealtimeObservation): void {
		try {
			this.observer?.record(event);
		} catch {
			// Observability cannot break ordered delivery.
		}
	}

	async append(
		input: AppendChannelEventInput,
		options: AppendChannelEventOptions = {},
	): Promise<ChannelEventReceipt> {
		const channelHash = hashResolvedChannel(input.channel);
		const db = options.db ?? this.db;
		let eventId = "";

		await withTransactionOrExisting(db, async (tx) => {
			await tx
				.insert(questpieChannelHeadTable)
				.values({ channelHash, channel: input.channel })
				.onConflictDoNothing();

			// The UPDATE takes a row lock. Contending publishers cannot receive a
			// sequence until the previous publisher commits, so seq order is commit order.
			const [head] = await tx
				.update(questpieChannelHeadTable)
				.set({
					lastSeq: sql`${questpieChannelHeadTable.lastSeq} + 1`,
					updatedAt: new Date(),
				})
				.where(eq(questpieChannelHeadTable.channelHash, channelHash))
				.returning({ seq: questpieChannelHeadTable.lastSeq });
			if (!head) throw new Error("Failed to lock channel sequence head");

			const seq = Number(head.seq);
			eventId = channelEventId(channelHash, seq);
			const envelope = canonicalChannelEnvelope(
				eventId,
				input.event,
				input.data,
			);
			await tx.insert(questpieChannelEventTable).values({
				channelHash,
				seq,
				eventId,
				channel: input.channel,
				event: input.event,
				schemaIdentity: input.schemaIdentity,
				payload: input.data,
				wireJson: envelope.wireJson,
				sizeBytes: envelope.sizeBytes,
			});
			await tx
				.insert(questpieChannelDispatchTable)
				.values({ channelHash })
				.onConflictDoNothing();
			await this.authorityFences.ensureChannel(channelHash, tx);

			onAfterCommit(async () => {
				void this.notifyAfterCommit(channelHash, eventId).catch((error) => {
					this.logger?.error(
						"[Realtime] Channel after-commit notification failed",
						error,
					);
				});
			});
		});

		return Object.freeze({ eventId });
	}

	private async notifyAfterCommit(
		channelHash: string,
		eventId: string,
	): Promise<void> {
		await this.ensureDeliveryStarted?.();
		await Promise.all([
			this.changeBroker?.publish({
				kind: "channel-events-maybe-advanced",
				channelHash,
				highWaterEventId: eventId,
				reason: "publish",
			}),
			this.drain(channelHash),
		]);
	}

	async subscribeLocal(
		input: LocalChannelSubscriptionInput,
	): Promise<() => Promise<void>> {
		if (
			this.clientTransport &&
			this.clientTransport.channelDeliveryScope !== "local-sessions"
		) {
			throw new Error("Local channel subscriptions require a local transport");
		}
		if (this.localSubscriptions.has(input.subscriptionId)) {
			throw new Error(`Channel subscription "${input.subscriptionId}" exists`);
		}
		if (Boolean(input.subject) !== Boolean(input.reauthorize)) {
			throw new Error(
				"Channel authority subject and reauthorizer must be provided together",
			);
		}
		if (input.stage && !input.subject) {
			throw new Error("Channel binding staging requires an authority subject");
		}

		const channelHash = hashResolvedChannel(input.channel);
		const [head] = await this.db
			.select({ lastSeq: questpieChannelHeadTable.lastSeq })
			.from(questpieChannelHeadTable)
			.where(eq(questpieChannelHeadTable.channelHash, channelHash))
			.limit(1);
		const latestSeq = Number(head?.lastSeq ?? 0);
		let cursor = latestSeq;

		if (input.lastEventId) {
			const parsed = parseChannelEventId(input.lastEventId);
			const [oldest] = await this.db
				.select({
					seq: questpieChannelEventTable.seq,
					eventId: questpieChannelEventTable.eventId,
				})
				.from(questpieChannelEventTable)
				.where(eq(questpieChannelEventTable.channelHash, channelHash))
				.orderBy(asc(questpieChannelEventTable.seq))
				.limit(1);
			const outsideRetention =
				!parsed ||
				parsed.channelHash !== channelHash ||
				parsed.seq > latestSeq ||
				(parsed.seq < latestSeq &&
					(!oldest || parsed.seq < Number(oldest.seq) - 1));
			if (outsideRetention) {
				this.observe({ type: "resume", outcome: "gap" });
				await this.writeGap(input, oldest?.eventId ?? null);
				return async () => {};
			}
			cursor = parsed.seq;
			this.observe({
				type: "resume",
				outcome: parsed.seq === latestSeq ? "current" : "replay",
			});
		}

		const subscription: LocalSubscription = {
			id: input.subscriptionId,
			channel: input.channel,
			channelHash,
			sink: input.sink,
			cursor,
			readSeq: cursor,
			pending: [],
			pendingBytes: 0,
			drainPromise: null,
			drainPending: false,
			closed: false,
			retryTimer: null,
			subject: input.subject,
			authorityGeneration: undefined,
			reauthorize: input.reauthorize,
			close: input.close,
			onRelease: input.onRelease,
			encodeFrame: input.encodeFrame,
			active: false,
		};
		const register = (
			generation?: number,
			lifecycle?: LocalChannelBindingLifecycle,
		) => {
			if (this.localSubscriptions.has(subscription.id)) {
				throw new Error(`Channel subscription "${subscription.id}" exists`);
			}
			subscription.authorityGeneration = generation;
			subscription.lifecycle = lifecycle;
			this.localSubscriptions.set(subscription.id, subscription);
			const channelSubscriptions =
				this.subscriptionsByChannel.get(channelHash) ?? new Set();
			channelSubscriptions.add(subscription);
			this.subscriptionsByChannel.set(channelHash, channelSubscriptions);
		};

		try {
			if (input.subject && input.reauthorize) {
				await this.authorityFences.ensure({
					channelHash,
					subject: input.subject,
				});
				while (!subscription.closed && !subscription.active) {
					const generation = await this.authorityFences.read({
						channelHash,
						subject: input.subject,
					});
					let authorization: LocalChannelAuthorization = false;
					try {
						authorization = await input.reauthorize();
					} catch {
						authorization = false;
					}
					if (!isAuthorized(authorization)) {
						if (input.close) await input.close("access_revoked");
						else await input.sink.close("access_revoked");
						return async () => {};
					}
					const admission = await this.authorityFences.admitExpected(
						{
							channelHash,
							subject: input.subject,
							expectedGeneration: generation,
						},
						{
							beforeFence: input.stage?.beforeFence,
							publish: async (tx) => {
								const lifecycle = await input.stage?.publish(tx, authorization);
								register(generation, lifecycle);
								lifecycle?.setRenewalGuard?.(async (operation) => {
									if (
										subscription.closed ||
										subscription.authorityGeneration === undefined
									) {
										return false;
									}
									const renewal = await this.authorityFences.admitExpected(
										{
											channelHash,
											subject: input.subject!,
											expectedGeneration: subscription.authorityGeneration,
										},
										{
											beforeFence: input.stage?.beforeFence,
											publish: operation,
										},
									);
									return renewal.admitted;
								});
								return lifecycle;
							},
						},
					);
					if (!admission.admitted) continue;
					if (subscription.closed) {
						await admission.value?.deactivate();
						break;
					}
					subscription.active = true;
					await admission.value?.activate();
				}
			} else {
				register();
				subscription.active = true;
			}
		} catch (error) {
			await this.releaseLocalSubscription(subscription);
			throw error;
		}
		if (subscription.closed) return async () => {};
		await this.drainLocalSubscription(subscription);

		return () => this.releaseLocalSubscription(subscription);
	}

	/** @internal Whether a successful admission installed the local binding. */
	hasLocalSubscription(subscriptionId: string): boolean {
		return this.localSubscriptions.has(subscriptionId);
	}

	/**
	 * Apply one durable authority cut, then reconcile every exact local binding.
	 *
	 * Duplicate calls are safe: a closed binding is removed before another cut
	 * can find it, and notice payloads carry only the resolved channel hash.
	 */
	async revokeAuthority(
		input: {
			channel: string;
			subject: string;
			transportSubject?: ClientAuthoritySubject;
			idempotencyKey: string;
		},
		options: AppendChannelEventOptions = {},
	): Promise<
		Readonly<{
			generation: number;
			scope: "exact-subscription" | "principal-connections";
		}>
	> {
		const channelHash = hashResolvedChannel(input.channel);
		const db = options.db ?? this.db;
		const managedCallerTransaction = Boolean(getCurrentTransaction());
		const sharedProvider =
			this.clientTransport?.channelDeliveryScope === "shared-provider"
				? this.clientTransport
				: undefined;
		if (sharedProvider) {
			if (!input.transportSubject) {
				throw new Error(
					"Shared-provider channel authority revocation is unavailable",
				);
			}
			sharedProvider.validateAuthorityRevocation?.(input.transportSubject);
		}
		const receipt = await this.authorityFences.advance(
			{
				channelHash,
				subject: input.subject,
				idempotencyKey: input.idempotencyKey,
			},
			db,
		);
		const scope = sharedProvider
			? sharedProvider.authorityRevocationScope
			: "exact-subscription";
		if (sharedProvider && (!scope || !sharedProvider.revokeAuthority)) {
			// Keep the newly advanced fence pending. Shared dispatch remains
			// blocked until a transport with an explicit capability applies it.
			throw new Error(
				"Shared provider channel authority revocation capability is unavailable",
			);
		}
		const reconcileLocal = async () => {
			const subscriptions = [
				...(this.subscriptionsByChannel.get(channelHash) ?? []),
			].filter((subscription) => subscription.subject === input.subject);
			await Promise.all(
				subscriptions.map((subscription) =>
					this.reconcileLocalAuthority(subscription),
				),
			);
		};
		const publishWake = async () => {
			await this.changeBroker?.publish({
				kind: "channel-authority-maybe-advanced",
				channelHash,
				reason: "revoke",
			});
		};

		if (sharedProvider) {
			if (!receipt.applied) {
				if (!input.transportSubject) {
					throw new Error(
						"Shared-provider channel authority revocation is unavailable",
					);
				}
				const applyProviderCut = async () => {
					await withProviderRevocationTimeout(
						sharedProvider.revokeAuthority!({
							channel: input.channel,
							subject: input.transportSubject!,
						}),
					);
					await this.authorityFences.acknowledge(
						{
							channelHash,
							subject: input.subject,
							idempotencyKey: input.idempotencyKey,
							generation: receipt.generation,
						},
						managedCallerTransaction ? db : undefined,
					);
				};
				if (managedCallerTransaction) {
					// A conservative disconnect may survive a later database rollback.
					// That is safer than returning success for an unapplied generation.
					await applyProviderCut();
				} else if (
					"rollback" in db &&
					typeof (db as { transaction?: unknown }).transaction !== "function"
				) {
					throw new Error(
						"Shared-provider revocation requires a managed transaction",
					);
				} else await applyProviderCut();
			}
		} else if (!receipt.applied) {
			// The committed generation is the exact-session enforcement boundary.
			await this.authorityFences.acknowledge(
				{
					channelHash,
					subject: input.subject,
					idempotencyKey: input.idempotencyKey,
					generation: receipt.generation,
				},
				db,
			);
		}

		const afterDurableCut = async () => {
			if (scope === "exact-subscription") await reconcileLocal();
			await publishWake().catch((error) => {
				this.logger?.warn("[Realtime] Channel authority wake failed", error);
			});
		};
		if (getCurrentTransaction()) {
			onAfterCommit(afterDurableCut);
		} else if (db !== this.db) {
			// An externally managed raw transaction has no framework after-commit
			// queue. Start reconciliation without awaiting its conflicting read:
			// the durable generation still blocks the next protected write, and
			// this operation resumes as soon as the external caller commits.
			void afterDurableCut().catch((error) => {
				this.logger?.warn(
					"[Realtime] Channel authority reconciliation failed",
					error,
				);
			});
		} else {
			await afterDurableCut();
		}
		return { generation: receipt.generation, scope: scope! };
	}

	/** Read one bounded replay page for an already-authorized channel identity. */
	async replay(
		channel: string,
		afterEventId: string,
	): Promise<ChannelReplayPage> {
		const channelHash = hashResolvedChannel(channel);
		const parsed = parseChannelEventId(afterEventId);
		const [head] = await this.db
			.select({ lastSeq: questpieChannelHeadTable.lastSeq })
			.from(questpieChannelHeadTable)
			.where(eq(questpieChannelHeadTable.channelHash, channelHash))
			.limit(1);
		const latestSeq = Number(head?.lastSeq ?? 0);
		const [oldest] = await this.db
			.select({
				seq: questpieChannelEventTable.seq,
				eventId: questpieChannelEventTable.eventId,
			})
			.from(questpieChannelEventTable)
			.where(eq(questpieChannelEventTable.channelHash, channelHash))
			.orderBy(asc(questpieChannelEventTable.seq))
			.limit(1);
		const outsideRetention =
			!parsed ||
			parsed.channelHash !== channelHash ||
			parsed.seq > latestSeq ||
			(parsed.seq < latestSeq &&
				(!oldest || parsed.seq < Number(oldest.seq) - 1));
		if (outsideRetention) {
			this.observe({ type: "resume", outcome: "gap" });
			return {
				status: "gap",
				requestedEventId: afterEventId,
				oldestEventId: oldest?.eventId ?? null,
			};
		}

		const maximumEvents = Math.max(
			1,
			Math.min(this.config.batchSize, this.config.maxBufferedEvents),
		);
		const rows = await this.db
			.select()
			.from(questpieChannelEventTable)
			.where(
				and(
					eq(questpieChannelEventTable.channelHash, channelHash),
					gt(questpieChannelEventTable.seq, parsed.seq),
				),
			)
			.orderBy(asc(questpieChannelEventTable.seq))
			.limit(maximumEvents + 1);
		const events: Array<{
			eventId: string;
			event: string;
			data: unknown;
		}> = [];
		let bytes = 0;
		let hasMore = false;
		for (const row of rows) {
			if (
				events.length >= maximumEvents ||
				bytes + row.sizeBytes > this.config.maxBufferedBytes
			) {
				hasMore = true;
				break;
			}
			events.push(JSON.parse(row.wireJson));
			bytes += row.sizeBytes;
		}
		if (hasMore && events.length === 0) {
			throw new Error("Channel replay event exceeds the configured byte limit");
		}
		this.observe({
			type: "resume",
			outcome: events.length === 0 ? "current" : "replay",
		});
		return { status: "events", events, hasMore };
	}

	async drain(channelHash?: string): Promise<void> {
		try {
			await this.reconcileLocalAuthorities(channelHash);
			if (this.clientTransport?.channelDeliveryScope === "shared-provider") {
				await this.drainShared(channelHash);
				return;
			}
			const subscriptions = channelHash
				? [...(this.subscriptionsByChannel.get(channelHash) ?? [])]
				: [...this.localSubscriptions.values()];
			await Promise.all(
				subscriptions.map((subscription) =>
					this.drainLocalSubscription(subscription),
				),
			);
		} catch (error) {
			// Apps can boot before their generated migration is applied. Match the
			// existing outbox contract: only an absent realtime table is ignored.
			if (hasPostgresErrorCode(error, "42P01")) return;
			throw error;
		}
	}

	private async reconcileLocalAuthorities(channelHash?: string): Promise<void> {
		const subscriptions = channelHash
			? [...(this.subscriptionsByChannel.get(channelHash) ?? [])]
			: [...this.localSubscriptions.values()];
		await Promise.all(
			subscriptions.map((subscription) =>
				this.reconcileLocalAuthority(subscription),
			),
		);
	}

	async cleanup(): Promise<void> {
		if (this.cleanupInProgress) return;
		if (this.config.retentionMs <= 0 && this.config.retentionBytes <= 0) return;
		this.cleanupInProgress = true;
		try {
			const rows = await this.db
				.select()
				.from(questpieChannelEventTable)
				.orderBy(asc(questpieChannelEventTable.createdAt));
			const dispatchRows =
				this.clientTransport?.channelDeliveryScope === "shared-provider"
					? await this.db.select().from(questpieChannelDispatchTable)
					: [];
			const publishedByChannel = new Map(
				dispatchRows.map((row) => [row.channelHash, Number(row.publishedSeq)]),
			);
			const cutoff = Date.now() - this.config.retentionMs;
			let retainedBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
			for (const row of rows) {
				const providerCursor = publishedByChannel.get(row.channelHash);
				if (providerCursor !== undefined && Number(row.seq) > providerCursor) {
					continue;
				}
				const expired =
					this.config.retentionMs > 0 && row.createdAt.getTime() < cutoff;
				const overSize =
					this.config.retentionBytes > 0 &&
					retainedBytes > this.config.retentionBytes;
				if (!expired && !overSize) continue;
				await this.db
					.delete(questpieChannelEventTable)
					.where(
						and(
							eq(questpieChannelEventTable.channelHash, row.channelHash),
							eq(questpieChannelEventTable.seq, row.seq),
						),
					);
				retainedBytes -= row.sizeBytes;
			}
		} catch (error) {
			if (!hasPostgresErrorCode(error, "42P01")) throw error;
		} finally {
			this.cleanupInProgress = false;
		}
	}

	async destroy(): Promise<void> {
		await Promise.all(
			[...this.localSubscriptions.values()].map((subscription) =>
				this.releaseLocalSubscription(subscription),
			),
		);
	}

	private async writeGap(
		input: LocalChannelSubscriptionInput,
		oldestEventId: string | null,
	): Promise<void> {
		const frame: ChannelGapFrame = {
			type: "channel_gap",
			channel: input.channel,
			requestedEventId: input.lastEventId ?? "",
			oldestEventId,
		};
		await input.sink.write(
			this.encodeLocalFrame(frame, input.encodeFrame),
			"ordered-channel-event",
		);
	}

	private async readEvents(
		channelHash: string,
		afterSeq: number,
	): Promise<ChannelEventRow[]> {
		return this.db
			.select()
			.from(questpieChannelEventTable)
			.where(
				and(
					eq(questpieChannelEventTable.channelHash, channelHash),
					gt(questpieChannelEventTable.seq, afterSeq),
				),
			)
			.orderBy(asc(questpieChannelEventTable.seq))
			.limit(this.config.batchSize);
	}

	private async drainLocalSubscription(
		subscription: LocalSubscription,
	): Promise<void> {
		if (subscription.closed || !subscription.active) return;
		if (subscription.drainPromise) {
			subscription.drainPending = true;
			return subscription.drainPromise;
		}
		const operation = this.runLocalDrain(subscription);
		subscription.drainPromise = operation;
		try {
			await operation;
		} finally {
			if (subscription.drainPromise === operation) {
				subscription.drainPromise = null;
			}
		}
	}

	private async runLocalDrain(subscription: LocalSubscription): Promise<void> {
		try {
			do {
				subscription.drainPending = false;
				if (!(await this.flushLocalPending(subscription))) {
					await this.fillLocalPending(subscription);
					return;
				}
				while (!subscription.closed) {
					const rows = await this.readEvents(
						subscription.channelHash,
						subscription.readSeq,
					);
					if (rows.length === 0) break;
					for (const row of rows) {
						if (!this.enqueueLocal(subscription, row)) return;
						subscription.readSeq = Number(row.seq);
					}
					if (!(await this.flushLocalPending(subscription))) {
						await this.fillLocalPending(subscription);
						return;
					}
					if (rows.length < this.config.batchSize) break;
				}
			} while (subscription.drainPending && !subscription.closed);
		} catch (error) {
			this.logger?.error("[Realtime] Ordered channel delivery failed", error);
			await this.closeLocalSubscription(subscription, "write_failed");
		}
	}

	private async fillLocalPending(
		subscription: LocalSubscription,
	): Promise<void> {
		while (!subscription.closed) {
			const rows = await this.readEvents(
				subscription.channelHash,
				subscription.readSeq,
			);
			if (rows.length === 0) return;
			for (const row of rows) {
				if (!this.enqueueLocal(subscription, row)) return;
				subscription.readSeq = Number(row.seq);
			}
			if (rows.length < this.config.batchSize) return;
		}
	}

	private enqueueLocal(
		subscription: LocalSubscription,
		row: ChannelEventRow,
	): boolean {
		const frameBytes = this.encodeLocalFrame(
			this.toLocalFrame(row),
			subscription.encodeFrame,
		).byteLength;
		if (
			subscription.pending.length + 1 > this.config.maxBufferedEvents ||
			subscription.pendingBytes + frameBytes > this.config.maxBufferedBytes
		) {
			void this.closeLocalSubscription(subscription, "slow_consumer");
			return false;
		}
		subscription.pending.push(row);
		subscription.pendingBytes += frameBytes;
		return true;
	}

	private async flushLocalPending(
		subscription: LocalSubscription,
	): Promise<boolean> {
		while (!subscription.closed && subscription.pending.length > 0) {
			const row = subscription.pending[0];
			const encodedFrame = this.encodeLocalFrame(
				this.toLocalFrame(row),
				subscription.encodeFrame,
			);
			const result = await this.writeAuthorizedLocalFrame(
				subscription,
				encodedFrame,
			);
			if (!result) return false;
			if (result.status === "busy") {
				if (
					result.bufferedBytes + subscription.pendingBytes >
					this.config.maxBufferedBytes
				) {
					await this.closeLocalSubscription(subscription, "slow_consumer");
					return false;
				}
				this.scheduleLocalRetry(subscription);
				return false;
			}
			subscription.pending.shift();
			subscription.pendingBytes -= encodedFrame.byteLength;
			subscription.cursor = Number(row.seq);
		}
		return true;
	}

	private toLocalFrame(row: ChannelEventRow): OrderedChannelEventFrame {
		const envelope = parseCompatibleTypedEventWire<{
			eventId: string;
			event: string;
			data: unknown;
		}>(row.wireJson);
		return {
			type: "channel_event",
			channel: row.channel,
			event: envelope.event,
			eventId: envelope.eventId,
			data: envelope.data,
		};
	}

	private scheduleLocalRetry(subscription: LocalSubscription): void {
		if (subscription.retryTimer || subscription.closed) return;
		subscription.retryTimer = setTimeout(() => {
			subscription.retryTimer = null;
			void this.drainLocalSubscription(subscription);
		}, this.config.busyRetryMs);
	}

	private encodeLocalFrame(
		frame: OrderedChannelEventFrame | ChannelGapFrame,
		encodeFrame?: LocalChannelSubscriptionInput["encodeFrame"],
	): Uint8Array {
		if (encodeFrame) return encodeFrame(frame);
		if (this.clientTransport?.channelDeliveryScope === "local-sessions") {
			const encoded = this.clientTransport.encodeChannelFrame?.(frame);
			if (encoded) return encoded;
		}
		return this.encoder.encode(JSON.stringify(frame));
	}

	private removeLocalSubscription(subscription: LocalSubscription): void {
		if (subscription.closed) return;
		subscription.closed = true;
		if (subscription.retryTimer) clearTimeout(subscription.retryTimer);
		subscription.pending = [];
		subscription.pendingBytes = 0;
		this.localSubscriptions.delete(subscription.id);
		const channelSubscriptions = this.subscriptionsByChannel.get(
			subscription.channelHash,
		);
		channelSubscriptions?.delete(subscription);
		if (channelSubscriptions?.size === 0) {
			this.subscriptionsByChannel.delete(subscription.channelHash);
		}
	}

	private async releaseLocalSubscription(
		subscription: LocalSubscription,
	): Promise<void> {
		if (subscription.closed) return;
		this.removeLocalSubscription(subscription);
		const lifecycle = subscription.lifecycle;
		subscription.lifecycle = undefined;
		try {
			await lifecycle?.deactivate();
		} finally {
			await subscription.onRelease?.();
		}
	}

	private async closeLocalSubscription(
		subscription: LocalSubscription,
		reason: "slow_consumer" | "write_failed" | "access_revoked",
	): Promise<void> {
		if (subscription.closed) return;
		await this.releaseLocalSubscription(subscription);
		if (reason === "access_revoked" && subscription.close) {
			await subscription.close(reason);
			return;
		}
		await subscription.sink.close(reason);
	}

	private async writeAuthorizedLocalFrame(
		subscription: LocalSubscription,
		frame: Uint8Array,
	): Promise<SinkWriteResult | null> {
		if (
			!subscription.subject ||
			subscription.authorityGeneration === undefined ||
			!subscription.reauthorize
		) {
			return subscription.sink.write(frame, "ordered-channel-event");
		}
		while (!subscription.closed && subscription.active) {
			const generation = await this.authorityFences.read({
				channelHash: subscription.channelHash,
				subject: subscription.subject,
			});
			if (generation !== subscription.authorityGeneration) {
				let authorization: LocalChannelAuthorization = false;
				try {
					authorization = await subscription.reauthorize();
				} catch {
					authorization = false;
				}
				if (!isAuthorized(authorization)) {
					await this.closeLocalSubscription(subscription, "access_revoked");
					return null;
				}
			}
			const admission = await this.authorityFences.admitExpected(
				{
					channelHash: subscription.channelHash,
					subject: subscription.subject,
					expectedGeneration: generation,
				},
				{
					publish: () => {
						subscription.authorityGeneration = generation;
					},
				},
			);
			if (!admission.admitted) continue;
			if (subscription.closed || !subscription.active) return null;
			// The frame was logically admitted at this generation. The sink is
			// deliberately outside the fence so revocation never waits on I/O.
			return subscription.sink.write(frame, "ordered-channel-event");
		}
		return null;
	}

	private async reconcileLocalAuthority(
		subscription: LocalSubscription,
	): Promise<void> {
		if (
			subscription.closed ||
			!subscription.subject ||
			subscription.authorityGeneration === undefined ||
			!subscription.reauthorize
		) {
			return;
		}
		while (!subscription.closed) {
			const generation = await this.authorityFences.read({
				channelHash: subscription.channelHash,
				subject: subscription.subject,
			});
			if (generation === subscription.authorityGeneration) return;
			let authorization: LocalChannelAuthorization = false;
			try {
				authorization = await subscription.reauthorize();
			} catch {
				// Refresh failures fail closed without exposing access details.
			}
			if (!isAuthorized(authorization)) {
				await this.closeLocalSubscription(subscription, "access_revoked");
				return;
			}
			const admission = await this.authorityFences.admitExpected(
				{
					channelHash: subscription.channelHash,
					subject: subscription.subject,
					expectedGeneration: generation,
				},
				{
					publish: () => {
						subscription.authorityGeneration = generation;
					},
				},
			);
			if (admission.admitted) return;
		}
	}

	private async drainShared(channelHash?: string): Promise<void> {
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider"
		) {
			return;
		}
		if (this.sharedDrainPromise) {
			this.sharedDrainPending = true;
			return this.sharedDrainPromise;
		}
		const operation = this.runSharedDrain(channelHash);
		this.sharedDrainPromise = operation;
		try {
			await operation;
		} finally {
			if (this.sharedDrainPromise === operation) {
				this.sharedDrainPromise = null;
			}
		}
	}

	private async runSharedDrain(channelHash?: string): Promise<void> {
		let requestedChannelHash = channelHash;
		do {
			this.sharedDrainPending = false;
			const heads = requestedChannelHash
				? await this.db
						.select()
						.from(questpieChannelHeadTable)
						.where(
							eq(questpieChannelHeadTable.channelHash, requestedChannelHash),
						)
				: await this.db.select().from(questpieChannelHeadTable);
			for (const head of heads) await this.drainSharedChannel(head.channelHash);
			// A wake racing this drain may target a different channel. The retry
			// therefore reconciles all heads instead of trusting the first hint.
			requestedChannelHash = undefined;
		} while (this.sharedDrainPending);
	}

	private async drainSharedChannel(channelHash: string): Promise<void> {
		if (
			!this.clientTransport ||
			this.clientTransport.channelDeliveryScope !== "shared-provider"
		) {
			return;
		}
		const clientTransport = this.clientTransport;
		const now = new Date();
		const leaseExpiresAt = new Date(
			now.getTime() + this.config.coordinatorLeaseMs,
		);
		const [lease] = await this.db
			.update(questpieChannelDispatchTable)
			.set({
				leaseOwner: this.instanceId,
				leaseExpiresAt,
				updatedAt: now,
			})
			.where(
				and(
					eq(questpieChannelDispatchTable.channelHash, channelHash),
					or(
						isNull(questpieChannelDispatchTable.leaseOwner),
						lt(questpieChannelDispatchTable.leaseExpiresAt, now),
						eq(questpieChannelDispatchTable.leaseOwner, this.instanceId),
					),
				),
			)
			.returning({ publishedSeq: questpieChannelDispatchTable.publishedSeq });
		if (!lease) return;

		let cursor = Number(lease.publishedSeq);
		try {
			while (true) {
				const rows = await this.readEvents(channelHash, cursor);
				if (rows.length === 0) break;
				for (const row of rows) {
					const renewed = await this.renewLease(channelHash);
					if (!renewed) return;
					const delivery: OrderedChannelDelivery = {
						channel: row.channel,
						eventId: row.eventId,
						frame: this.encoder.encode(row.wireJson),
					};
					if (!(await this.authorityFences.admitSharedDispatch(channelHash))) {
						return;
					}
					const result = await clientTransport.publishChannel(delivery);
					if (result.status === "busy") return;
					cursor = Number(row.seq);
					const [advanced] = await this.db
						.update(questpieChannelDispatchTable)
						.set({ publishedSeq: cursor, updatedAt: new Date() })
						.where(
							and(
								eq(questpieChannelDispatchTable.channelHash, channelHash),
								eq(questpieChannelDispatchTable.leaseOwner, this.instanceId),
								lte(questpieChannelDispatchTable.publishedSeq, cursor),
							),
						)
						.returning({
							channelHash: questpieChannelDispatchTable.channelHash,
						});
					if (!advanced) return;
				}
				if (rows.length < this.config.batchSize) break;
			}
		} catch (error) {
			this.logger?.error("[Realtime] Shared channel delivery failed", error);
			throw error;
		} finally {
			await this.db
				.update(questpieChannelDispatchTable)
				.set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
				.where(
					and(
						eq(questpieChannelDispatchTable.channelHash, channelHash),
						eq(questpieChannelDispatchTable.leaseOwner, this.instanceId),
					),
				);
		}
	}

	private async renewLease(channelHash: string): Promise<boolean> {
		const [row] = await this.db
			.update(questpieChannelDispatchTable)
			.set({
				leaseExpiresAt: new Date(Date.now() + this.config.coordinatorLeaseMs),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(questpieChannelDispatchTable.channelHash, channelHash),
					eq(questpieChannelDispatchTable.leaseOwner, this.instanceId),
				),
			)
			.returning({ channelHash: questpieChannelDispatchTable.channelHash });
		return !!row;
	}
}
