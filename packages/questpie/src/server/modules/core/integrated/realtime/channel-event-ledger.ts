import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
	CHANNEL_MAX_PAYLOAD_BYTES,
	ChannelSecurityError,
} from "#questpie/server/channels/security.js";
import {
	getCurrentTransaction,
	onAfterCommit,
	withTransaction,
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
	/** Called after authorization and initial replay/catch-up complete. */
	onReady?: () => void | Promise<void>;
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
	onReady?: LocalChannelSubscriptionInput["onReady"];
	readySignaled: boolean;
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
	/** In-flight log page per channel, shared by every reader of that channel. */
	private readonly channelReads = new Map<
		string,
		{ afterSeq: number; page: Promise<ChannelEventRow[]> }
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
			// The UPDATE takes a row lock. Contending publishers cannot receive a
			// sequence until the previous publisher commits, so seq order is commit order.
			//
			// It is also attempted FIRST. The head, dispatch and coordinator-fence
			// rows are created together by whichever append is first on a channel,
			// so after that every append can reach its sequence in one statement
			// instead of paying three upserts that can only ever be no-ops.
			let head = await this.lockChannelSequence(tx, channelHash);
			if (!head) {
				await tx
					.insert(questpieChannelHeadTable)
					.values({ channelHash, channel: input.channel })
					.onConflictDoNothing();
				await tx
					.insert(questpieChannelDispatchTable)
					.values({ channelHash })
					.onConflictDoNothing();
				await this.authorityFences.ensureChannel(channelHash, tx);
				head = await this.lockChannelSequence(tx, channelHash);
			}
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

	private async lockChannelSequence(
		tx: AnyDrizzleClient<any>,
		channelHash: string,
	): Promise<{ seq: number } | undefined> {
		const [head] = await tx
			.update(questpieChannelHeadTable)
			.set({
				lastSeq: sql`${questpieChannelHeadTable.lastSeq} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(questpieChannelHeadTable.channelHash, channelHash))
			.returning({ seq: questpieChannelHeadTable.lastSeq });
		return head;
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
			onReady: input.onReady,
			readySignaled: false,
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
		try {
			await this.drainLocalSubscription(subscription);
		} catch (error) {
			await this.releaseLocalSubscription(subscription);
			throw error;
		}

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

	/**
	 * Enforce the retention horizon in bounded SQL, on one node at a time.
	 *
	 * This used to `select *` the entire event table — payloads included — into
	 * the heap and then issue one autocommit DELETE per row, hourly, on every
	 * node at once. At the documented 24 h / 10 events per second that is
	 * 864 000 rows and 864 000 transactions per node per pass.
	 *
	 * Both horizons are now single statements, and a transaction-scoped
	 * advisory lock keeps concurrent nodes from repeating each other's work.
	 */
	async cleanup(): Promise<void> {
		if (this.cleanupInProgress) return;
		if (this.config.retentionMs <= 0 && this.config.retentionBytes <= 0) return;
		this.cleanupInProgress = true;
		try {
			await withTransaction(this.db, async (tx) => {
				if (!(await this.admitCleanup(tx))) return;
				// Events the shared provider has not published yet are never
				// eligible: the dispatch cursor is the only durable record of what
				// has actually left this node.
				const undispatched =
					this.clientTransport?.channelDeliveryScope === "shared-provider"
						? sql`and not exists (
								select 1 from questpie_channel_dispatch d
								where d.channel_hash = e.channel_hash
									and e.seq > d.published_seq
							)`
						: sql``;

				await this.reportRetentionHorizon(tx);
				if (this.config.retentionMs > 0) {
					const cutoff = new Date(Date.now() - this.config.retentionMs);
					await tx.execute(sql`
						delete from questpie_channel_event e
						where e.created_at < ${cutoff} ${undispatched}
					`);
				}
				if (this.config.retentionBytes > 0) {
					// Keep the newest events up to the byte budget; everything the
					// running total pushes past it goes in one statement.
					await tx.execute(sql`
						delete from questpie_channel_event e
						using (
							select channel_hash, seq,
								sum(size_bytes) over (
									order by created_at desc, channel_hash desc, seq desc
									rows between unbounded preceding and current row
								) as retained
							from questpie_channel_event
						) r
						where e.channel_hash = r.channel_hash
							and e.seq = r.seq
							and r.retained > ${this.config.retentionBytes}
							${undispatched}
					`);
				}
			});
		} catch (error) {
			if (!hasPostgresErrorCode(error, "42P01")) throw error;
		} finally {
			this.cleanupInProgress = false;
		}
	}

	/**
	 * Say so when the byte cap, not the age cap, is the real retention horizon.
	 *
	 * `retentionBytes` defaults to 64 MB and `retentionMs` to 24 hours. At
	 * ~500 bytes an event and 10 events per second the byte cap binds after
	 * about 3.5 hours, so an operator who configured a day of replay silently
	 * got a few hours of it — and every subscriber resuming past that horizon
	 * gets a gap. Whichever cap wins, it is now named.
	 */
	private async reportRetentionHorizon(
		tx: AnyDrizzleClient<any>,
	): Promise<void> {
		if (this.config.retentionBytes <= 0 || this.config.retentionMs <= 0) return;
		const [totals] = await tx
			.select({
				retainedBytes: sql<number>`coalesce(sum(${questpieChannelEventTable.sizeBytes}), 0)::bigint`,
				oldest: sql<Date | null>`min(${questpieChannelEventTable.createdAt})`,
			})
			.from(questpieChannelEventTable);
		const retainedBytes = Number(totals?.retainedBytes ?? 0);
		if (retainedBytes <= this.config.retentionBytes) return;
		const oldest = totals?.oldest ? new Date(totals.oldest) : null;
		const cutoff = Date.now() - this.config.retentionMs;
		if (oldest && oldest.getTime() < cutoff) return;
		this.logger?.warn(
			`[Realtime] Channel retentionBytes (${this.config.retentionBytes}) is the binding retention horizon, not retentionMs (${this.config.retentionMs}). Retained ${retainedBytes} bytes of events, none of them old enough to expire. Subscribers resuming past the byte horizon will receive a channel gap.`,
		);
	}

	/**
	 * One node per cluster runs a retention pass.
	 *
	 * Unlike shared dispatch, cleanup had no lease of any kind, so every node
	 * did the whole thing and the cost scaled with the fleet. The lock is
	 * transaction-scoped so it cannot outlive a crashed pass.
	 */
	private async admitCleanup(tx: AnyDrizzleClient<any>): Promise<boolean> {
		try {
			const result = await tx.execute(
				sql`select pg_try_advisory_xact_lock(hashtext('questpie_channel_event_cleanup')) as admitted`,
			);
			const [row] = Array.isArray(result) ? result : (result?.rows ?? []);
			// A driver that cannot report the result is treated as admitted: an
			// unnecessary pass is now cheap, a skipped one is unbounded growth.
			if (typeof row?.admitted === "boolean") return row.admitted;
			return true;
		} catch {
			return true;
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

	/**
	 * Refuse to deliver across a hole in an already-connected subscriber's log.
	 *
	 * Gap detection used to exist only at subscribe and replay. On the live
	 * drain path a subscriber whose unread rows were removed underneath it —
	 * exactly what retention cleanup does on another node — simply received the
	 * next surviving row: seq 1,2,3,6 with no gap frame, no close and no log.
	 * The subscription is torn down here and the sink is left open, which is
	 * the same shape the subscribe-time gap branch already hands the client.
	 */
	private async admitContiguous(
		subscription: LocalSubscription,
		row: ChannelEventRow,
	): Promise<boolean> {
		if (Number(row.seq) === subscription.readSeq + 1) return true;
		this.observe({ type: "resume", outcome: "gap" });
		this.logger?.warn(
			`[Realtime] Channel "${subscription.channel}" delivery gap: expected seq ${
				subscription.readSeq + 1
			}, read seq ${Number(row.seq)}. Retained events no longer cover this subscriber.`,
		);
		const [oldest] = await this.db
			.select({ eventId: questpieChannelEventTable.eventId })
			.from(questpieChannelEventTable)
			.where(
				eq(questpieChannelEventTable.channelHash, subscription.channelHash),
			)
			.orderBy(asc(questpieChannelEventTable.seq))
			.limit(1);
		const frame: ChannelGapFrame = {
			type: "channel_gap",
			channel: subscription.channel,
			requestedEventId: channelEventId(
				subscription.channelHash,
				subscription.readSeq,
			),
			oldestEventId: oldest?.eventId ?? null,
		};
		try {
			await subscription.sink.write(
				this.encodeLocalFrame(frame, subscription.encodeFrame),
				"ordered-channel-event",
			);
		} finally {
			// A sink that cannot take the gap frame must still stop receiving a
			// stream it can no longer trust.
			await this.releaseLocalSubscription(subscription);
		}
		return false;
	}

	private async selectEvents(
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

	/**
	 * Read one page of a channel's log, keyed by TOPIC rather than by
	 * subscriber.
	 *
	 * Every delivery path re-drains the ledger, so a fan-out wakes every
	 * subscriber on a channel at once and each one used to issue its own
	 * identical `seq > cursor` scan: 50 subscribers on one channel cost 50
	 * index scans for one event. Concurrent readers of the same channel now
	 * share the in-flight page instead.
	 *
	 * A page that hit `batchSize` is deliberately not shared with a reader at a
	 * higher cursor: its length no longer answers "is there more after you",
	 * which is what the drain loops test to decide whether to read again.
	 */
	private async readEvents(
		channelHash: string,
		afterSeq: number,
	): Promise<ChannelEventRow[]> {
		const inflight = this.channelReads.get(channelHash);
		if (inflight && inflight.afterSeq <= afterSeq) {
			const shared = await inflight.page;
			if (shared.length < this.config.batchSize) {
				return inflight.afterSeq === afterSeq
					? shared
					: shared.filter((row) => Number(row.seq) > afterSeq);
			}
		}
		const page = this.selectEvents(channelHash, afterSeq);
		this.channelReads.set(channelHash, { afterSeq, page });
		try {
			return await page;
		} finally {
			if (this.channelReads.get(channelHash)?.page === page) {
				this.channelReads.delete(channelHash);
			}
		}
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
		let drainAgain = false;
		try {
			await operation;
		} finally {
			if (subscription.drainPromise === operation) {
				subscription.drainPromise = null;
				drainAgain = subscription.drainPending && !subscription.closed;
				subscription.drainPending = false;
			}
		}
		if (drainAgain) await this.drainLocalSubscription(subscription);
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
						if (!(await this.admitContiguous(subscription, row))) return;
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
			return;
		}
		if (
			!subscription.closed &&
			!subscription.readySignaled &&
			subscription.pending.length === 0 &&
			subscription.cursor === subscription.readSeq
		) {
			subscription.readySignaled = true;
			try {
				await subscription.onReady?.();
			} catch (error) {
				await this.closeLocalSubscription(subscription, "write_failed");
				throw error;
			}
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
				if (!(await this.admitContiguous(subscription, row))) return;
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
			void this.drainLocalSubscription(subscription).catch((error) => {
				this.logger?.error(
					"[Realtime] Channel readiness delivery failed",
					error,
				);
			});
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
			const heads = await this.pendingSharedChannels(requestedChannelHash);
			for (const head of heads) await this.drainSharedChannel(head.channelHash);
			// A wake racing this drain may target a different channel. The retry
			// therefore reconciles all heads instead of trusting the first hint.
			requestedChannelHash = undefined;
		} while (this.sharedDrainPending);
	}

	/**
	 * Channels whose head is ahead of the published cursor.
	 *
	 * The drain used to enumerate every head row that had ever existed and take
	 * — then release — a coordinator lease on each one, so a fleet with a large
	 * channel space paid two writes per idle channel on every pass, and a
	 * single wake that raced an in-flight drain re-scanned the whole table.
	 * Only channels with undelivered events are visited now.
	 */
	private async pendingSharedChannels(
		channelHash?: string,
	): Promise<Array<{ channelHash: string }>> {
		return this.db
			.select({ channelHash: questpieChannelHeadTable.channelHash })
			.from(questpieChannelHeadTable)
			.leftJoin(
				questpieChannelDispatchTable,
				eq(
					questpieChannelDispatchTable.channelHash,
					questpieChannelHeadTable.channelHash,
				),
			)
			.where(
				and(
					sql`${questpieChannelHeadTable.lastSeq} > coalesce(${questpieChannelDispatchTable.publishedSeq}, 0)`,
					...(channelHash
						? [eq(questpieChannelHeadTable.channelHash, channelHash)]
						: []),
				),
			);
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
