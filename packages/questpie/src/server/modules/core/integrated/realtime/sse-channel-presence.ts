import { and, asc, desc, eq, gt, lte } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";

import { hashResolvedChannel } from "./channel-event-ledger.js";
import {
	questpieChannelHeadTable,
	questpieChannelPresenceTable,
} from "./collection.js";
import { encodeSseEvent } from "./sse-client-transport.js";
import type { ClientSink } from "./transport.js";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_RECONCILIATION_MS = 1_000;
const DEFAULT_MAX_MEMBERS = 100;
const DEFAULT_MAX_MEMBER_BYTES = 1_024;
const DEFAULT_MAX_PRINCIPAL_ID_LENGTH = 128;

export type ChannelPresenceConfig = {
	/** Time after the last renewal before an abandoned connection disappears. */
	leaseMs: number;
	/** One app-instance timer renews all of its active connections. */
	heartbeatMs: number;
	/** Database reconciliation interval; this is the missed-notice guarantee. */
	reconciliationMs: number;
	/** Provider-parity cap for distinct principals in one resolved channel. */
	maxMembers: number;
	/** Provider-parity cap for one serialized member payload. */
	maxMemberBytes: number;
	/** Provider-parity cap for a stable principal identifier. */
	maxPrincipalIdLength: number;
};

type LocalPresenceMember = {
	connectionId: string;
	principalId: string;
	channel: string;
	channelHash: string;
	sink: ClientSink;
	data: Record<string, unknown>;
	lastSnapshot?: string;
};

type PresenceRow = typeof questpieChannelPresenceTable.$inferSelect;

export type RegisterChannelPresenceInput = {
	channel: string;
	connectionId: string;
	principalId: string;
	sink: ClientSink;
	data: Record<string, unknown>;
};

function positiveInteger(value: number | undefined, fallback: number): number {
	return Number.isInteger(value) && (value as number) > 0
		? (value as number)
		: fallback;
}

function payloadBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Postgres lease register used by the zero-infrastructure SSE transport. */
export class SseChannelPresenceRegistry {
	private readonly config: ChannelPresenceConfig;
	private readonly localConnections = new Map<string, LocalPresenceMember>();
	private readonly connectionsByChannel = new Map<
		string,
		Set<LocalPresenceMember>
	>();
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
	private reconcileOperation: Promise<void> = Promise.resolve();
	private destroyed = false;

	constructor(
		private readonly db: AnyDrizzleClient<any>,
		config: Partial<ChannelPresenceConfig> = {},
		private readonly logger?: Pick<LoggerAdapter, "error" | "warn">,
	) {
		this.config = {
			leaseMs: positiveInteger(config.leaseMs, DEFAULT_LEASE_MS),
			heartbeatMs: positiveInteger(config.heartbeatMs, DEFAULT_HEARTBEAT_MS),
			reconciliationMs: positiveInteger(
				config.reconciliationMs,
				DEFAULT_RECONCILIATION_MS,
			),
			maxMembers: positiveInteger(config.maxMembers, DEFAULT_MAX_MEMBERS),
			maxMemberBytes: positiveInteger(
				config.maxMemberBytes,
				DEFAULT_MAX_MEMBER_BYTES,
			),
			maxPrincipalIdLength: positiveInteger(
				config.maxPrincipalIdLength,
				DEFAULT_MAX_PRINCIPAL_ID_LENGTH,
			),
		};
	}

	async register(
		input: RegisterChannelPresenceInput,
	): Promise<() => Promise<void>> {
		if (this.destroyed)
			throw new Error("Channel presence registry is destroyed");
		if (!input.principalId) {
			throw new Error("Presence channel subscription requires a principal");
		}
		if (input.principalId.length > this.config.maxPrincipalIdLength) {
			throw new Error("Presence principal identifier is too long");
		}
		if (payloadBytes(input.data) > this.config.maxMemberBytes) {
			throw new Error("Presence member data is too large");
		}
		if (this.localConnections.has(input.connectionId)) {
			throw new Error("Presence connection id is already registered");
		}

		const channelHash = hashResolvedChannel(input.channel);
		const now = new Date();
		const member: LocalPresenceMember = { ...input, channelHash };
		await this.db.transaction(async (tx) => {
			await tx
				.insert(questpieChannelHeadTable)
				.values({ channelHash, channel: input.channel })
				.onConflictDoNothing();
			await tx
				.update(questpieChannelHeadTable)
				.set({ updatedAt: now })
				.where(eq(questpieChannelHeadTable.channelHash, channelHash));

			const activeRows = await tx
				.select({ principalId: questpieChannelPresenceTable.principalId })
				.from(questpieChannelPresenceTable)
				.where(
					and(
						eq(questpieChannelPresenceTable.channelHash, channelHash),
						gt(questpieChannelPresenceTable.expiresAt, now),
					),
				);
			const principals = new Set(activeRows.map((row) => row.principalId));
			if (
				!principals.has(input.principalId) &&
				principals.size >= this.config.maxMembers
			) {
				throw new Error("Presence channel member limit exceeded");
			}

			await tx
				.insert(questpieChannelPresenceTable)
				.values({
					channelHash,
					connectionId: input.connectionId,
					principalId: input.principalId,
					channel: input.channel,
					data: input.data,
					expiresAt: new Date(now.getTime() + this.config.leaseMs),
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: [
						questpieChannelPresenceTable.channelHash,
						questpieChannelPresenceTable.connectionId,
					],
					set: {
						principalId: input.principalId,
						channel: input.channel,
						data: input.data,
						expiresAt: new Date(now.getTime() + this.config.leaseMs),
						updatedAt: now,
					},
				});
		});

		this.localConnections.set(input.connectionId, member);
		const channelMembers =
			this.connectionsByChannel.get(channelHash) ?? new Set();
		channelMembers.add(member);
		this.connectionsByChannel.set(channelHash, channelMembers);
		this.ensureTimers();
		try {
			await this.reconcile(channelHash);
		} catch (error) {
			await this.unregister(member, false);
			throw error;
		}

		let stopped = false;
		return async () => {
			if (stopped) return;
			stopped = true;
			await this.unregister(member);
		};
	}

	/** Reconcile all locally observed channels, or one channel after a mutation. */
	reconcile(channelHash?: string): Promise<void> {
		const operation = this.reconcileOperation.then(() =>
			this.reconcileNow(channelHash),
		);
		this.reconcileOperation = operation.catch(() => {});
		return operation;
	}

	private async reconcileNow(channelHash?: string): Promise<void> {
		if (this.destroyed) return;
		const now = new Date();
		await this.db
			.delete(questpieChannelPresenceTable)
			.where(lte(questpieChannelPresenceTable.expiresAt, now));
		const hashes = channelHash
			? [channelHash]
			: [...this.connectionsByChannel.keys()];
		for (const hash of hashes) {
			const localMembers = this.connectionsByChannel.get(hash);
			if (!localMembers?.size) continue;
			const rows = await this.db
				.select()
				.from(questpieChannelPresenceTable)
				.where(
					and(
						eq(questpieChannelPresenceTable.channelHash, hash),
						gt(questpieChannelPresenceTable.expiresAt, now),
					),
				)
				.orderBy(
					asc(questpieChannelPresenceTable.principalId),
					desc(questpieChannelPresenceTable.updatedAt),
					desc(questpieChannelPresenceTable.connectionId),
				);
			const snapshot = this.aggregate(rows);
			const serialized = JSON.stringify(snapshot);
			const frame = encodeSseEvent("channel_presence", {
				type: "channel_presence",
				channel: localMembers.values().next().value?.channel,
				members: snapshot,
			});
			for (const member of localMembers) {
				if (member.lastSnapshot === serialized) continue;
				try {
					await member.sink.write(frame, "latest-snapshot");
					member.lastSnapshot = serialized;
				} catch {
					await this.unregister(member, false);
				}
			}
		}
	}

	private aggregate(rows: PresenceRow[]): readonly Record<string, unknown>[] {
		const byPrincipal = new Map<string, Record<string, unknown>>();
		for (const row of rows) {
			if (!byPrincipal.has(row.principalId)) {
				byPrincipal.set(row.principalId, row.data as Record<string, unknown>);
			}
		}
		return [...byPrincipal.values()];
	}

	private async heartbeat(): Promise<void> {
		if (this.destroyed || this.localConnections.size === 0) return;
		const now = new Date();
		const expiresAt = new Date(now.getTime() + this.config.leaseMs);
		await Promise.all(
			[...this.localConnections.values()].map((member) =>
				this.db
					.update(questpieChannelPresenceTable)
					.set({ expiresAt })
					.where(
						and(
							eq(questpieChannelPresenceTable.channelHash, member.channelHash),
							eq(
								questpieChannelPresenceTable.connectionId,
								member.connectionId,
							),
						),
					),
			),
		);
	}

	private async unregister(
		member: LocalPresenceMember,
		reconcileAfter = true,
	): Promise<void> {
		if (this.localConnections.get(member.connectionId) !== member) return;
		this.localConnections.delete(member.connectionId);
		const channelMembers = this.connectionsByChannel.get(member.channelHash);
		channelMembers?.delete(member);
		if (channelMembers?.size === 0) {
			this.connectionsByChannel.delete(member.channelHash);
		}
		await this.db
			.delete(questpieChannelPresenceTable)
			.where(
				and(
					eq(questpieChannelPresenceTable.channelHash, member.channelHash),
					eq(questpieChannelPresenceTable.connectionId, member.connectionId),
				),
			);
		if (reconcileAfter) await this.reconcile(member.channelHash);
		this.clearTimersIfIdle();
	}

	private ensureTimers(): void {
		if (!this.heartbeatTimer) {
			this.heartbeatTimer = setInterval(() => {
				void this.heartbeat().catch((error) => {
					this.logger?.error("[Realtime] Presence heartbeat failed", error);
				});
			}, this.config.heartbeatMs);
		}
		if (!this.reconciliationTimer) {
			this.reconciliationTimer = setInterval(() => {
				void this.reconcile().catch((error) => {
					this.logger?.error(
						"[Realtime] Presence reconciliation failed",
						error,
					);
				});
			}, this.config.reconciliationMs);
		}
	}

	private clearTimersIfIdle(): void {
		if (this.localConnections.size > 0) return;
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
		this.heartbeatTimer = null;
		this.reconciliationTimer = null;
	}

	async destroy(options: { removeMemberships?: boolean } = {}): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
		this.heartbeatTimer = null;
		this.reconciliationTimer = null;
		const members = [...this.localConnections.values()];
		this.localConnections.clear();
		this.connectionsByChannel.clear();
		if (options.removeMemberships === false) return;
		await Promise.all(
			members.map((member) =>
				this.db
					.delete(questpieChannelPresenceTable)
					.where(
						and(
							eq(questpieChannelPresenceTable.channelHash, member.channelHash),
							eq(
								questpieChannelPresenceTable.connectionId,
								member.connectionId,
							),
						),
					),
			),
		);
	}
}
