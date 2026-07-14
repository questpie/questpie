import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
	onAfterCommit,
	withTransactionOrExisting,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { DrizzleClientFromQuestpieConfig } from "#questpie/server/config/types.js";
import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";

import {
	questpieChannelDispatchTable,
	questpieChannelEventTable,
	questpieChannelHeadTable,
} from "./collection.js";
import type {
	ChannelGapFrame,
	ChangeBroker,
	ClientSink,
	ClientTransport,
	OrderedChannelDelivery,
	OrderedChannelEventFrame,
} from "./transport.js";

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_EVENTS = 100;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_BATCH_SIZE = 500;

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
	db?: DrizzleClientFromQuestpieConfig<any>;
};

export type ChannelEventReceipt = Readonly<{
	eventId: string;
}>;

export type LocalChannelSubscriptionInput = {
	subscriptionId: string;
	channel: string;
	sink: ClientSink;
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
	encodeFrame?: LocalChannelSubscriptionInput["encodeFrame"];
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

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
	private readonly localSubscriptions = new Map<string, LocalSubscription>();
	private readonly subscriptionsByChannel = new Map<
		string,
		Set<LocalSubscription>
	>();
	private sharedDrainPending = false;
	private sharedDrainPromise: Promise<void> | null = null;
	private cleanupInProgress = false;

	constructor(
		private readonly db: DrizzleClientFromQuestpieConfig<any>,
		private readonly changeBroker: ChangeBroker | undefined,
		private readonly clientTransport: ClientTransport | undefined,
		config: Partial<ChannelEventLedgerConfig> = {},
		private readonly logger?: Pick<LoggerAdapter, "error" | "warn">,
		private readonly ensureDeliveryStarted?: () => Promise<void>,
	) {
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
			await tx.insert(questpieChannelEventTable).values({
				channelHash,
				seq,
				eventId,
				channel: input.channel,
				event: input.event,
				schemaIdentity: input.schemaIdentity,
				payload: input.data,
				sizeBytes: byteLength(input),
			});
			await tx
				.insert(questpieChannelDispatchTable)
				.values({ channelHash })
				.onConflictDoNothing();

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
	): Promise<() => void> {
		if (
			this.clientTransport &&
			this.clientTransport.channelDeliveryScope !== "local-sessions"
		) {
			throw new Error("Local channel subscriptions require a local transport");
		}
		if (this.localSubscriptions.has(input.subscriptionId)) {
			throw new Error(`Channel subscription "${input.subscriptionId}" exists`);
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
				await this.writeGap(input, oldest?.eventId ?? null);
				return () => {};
			}
			cursor = parsed.seq;
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
			encodeFrame: input.encodeFrame,
		};
		this.localSubscriptions.set(subscription.id, subscription);
		const channelSubscriptions =
			this.subscriptionsByChannel.get(channelHash) ?? new Set();
		channelSubscriptions.add(subscription);
		this.subscriptionsByChannel.set(channelHash, channelSubscriptions);
		await this.drainLocalSubscription(subscription);

		return () => this.removeLocalSubscription(subscription);
	}

	async drain(channelHash?: string): Promise<void> {
		try {
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

	destroy(): void {
		for (const subscription of this.localSubscriptions.values()) {
			this.removeLocalSubscription(subscription);
		}
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
		if (subscription.closed) return;
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
			const result = await subscription.sink.write(
				encodedFrame,
				"ordered-channel-event",
			);
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
		return {
			type: "channel_event",
			channel: row.channel,
			event: row.event,
			eventId: row.eventId,
			data: row.payload,
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
		this.localSubscriptions.delete(subscription.id);
		const channelSubscriptions = this.subscriptionsByChannel.get(
			subscription.channelHash,
		);
		channelSubscriptions?.delete(subscription);
		if (channelSubscriptions?.size === 0) {
			this.subscriptionsByChannel.delete(subscription.channelHash);
		}
	}

	private async closeLocalSubscription(
		subscription: LocalSubscription,
		reason: "slow_consumer" | "write_failed",
	): Promise<void> {
		if (subscription.closed) return;
		this.removeLocalSubscription(subscription);
		await subscription.sink.close(reason);
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
						frame: this.encoder.encode(
							JSON.stringify({ event: row.event, data: row.payload }),
						),
					};
					const result = await this.clientTransport.publishChannel(delivery);
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
