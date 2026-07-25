import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import { questpieRealtimeTopologyTable } from "./collection.js";
import type { RealtimeObservation, RealtimeObserver } from "./observer.js";
import type { ChangePublisher, ChangeWake } from "./transport.js";

export const REALTIME_TOPOLOGY_PROTOCOL = "questpie-realtime-topology" as const;
export const MAX_REALTIME_TOPOLOGY_BYTES = 262_144;
export const MANAGED_PROVIDER_CLIENT_LEASE_MS = 45_000;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 15_000;

export type RealtimeTopologyQuery = {
	kind: "query";
	id: string;
	topic: Record<string, unknown>;
	sinceSeq?: number;
};

export type RealtimeTopologyChannel = {
	kind: "channel";
	id: string;
	channel: string;
	params: Record<string, string>;
	lastEventId?: string;
};

export type RealtimeTopologyCrdt = {
	kind: "crdt";
	id: string;
	bindingId: string;
};

export type RealtimeDesiredSubscription =
	| RealtimeTopologyQuery
	| RealtimeTopologyChannel
	| RealtimeTopologyCrdt;

export type RealtimeDesiredTopology = {
	protocol: typeof REALTIME_TOPOLOGY_PROTOCOL;
	version: 2;
	revision: number;
	subscriptions: RealtimeDesiredSubscription[];
};

export type RealtimeTopologyApplyInput = {
	topology: RealtimeDesiredTopology;
	ownerGeneration: number;
	signal: AbortSignal;
};

export type RealtimeTopologyEntryError = {
	id: string;
	kind: string;
	code: string;
	message: string;
};

export class RealtimeTopologyApplyRejectedError extends Error {
	readonly code = "REALTIME_TOPOLOGY_ENTRIES_REJECTED";

	constructor(readonly entries: readonly RealtimeTopologyEntryError[]) {
		super("Realtime topology entries were rejected");
		this.name = "RealtimeTopologyApplyRejectedError";
	}
}

type TopologyRow = {
	sessionKey: string;
	ownerId: string;
	ownerGeneration: number;
	protocolVersion: number;
	tokenHash: string;
	identityHash: string;
	leaseExpiresAt: Date;
	clientSeenAt: Date;
	desiredRevision: number;
	appliedRevision: number;
	desiredTopology: RealtimeDesiredTopology;
};

type DatabaseTopologyRow = Omit<
	TopologyRow,
	"clientSeenAt" | "desiredTopology"
> & {
	updatedAt: Date;
	desiredTopology: unknown;
};

type TopologyMutation =
	| { status: "accepted"; topology: RealtimeDesiredTopology }
	| {
			status: "duplicate" | "stale" | "conflict" | "unsupported" | "invalid";
	  };

type TopologyMutationResult =
	| { status: "unavailable" }
	| {
			status: TopologyMutation["status"];
			row: TopologyRow;
	  };

interface RealtimeTopologyStore {
	open(input: {
		sessionKey: string;
		ownerId: string;
		tokenHash: string;
		identityHash: string;
		topology: RealtimeDesiredTopology;
		leaseMs: number;
	}): Promise<TopologyRow>;
	mutate(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
		mutate: (row: TopologyRow) => TopologyMutation;
	}): Promise<TopologyMutationResult>;
	authorize(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
	}): Promise<TopologyRow | null>;
	getOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<TopologyRow | null>;
	markApplied(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		revision: number;
	}): Promise<boolean>;
	rejectOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		rejectedRevision: number;
		appliedRevision: number;
		appliedTopology: RealtimeDesiredTopology;
	}): Promise<boolean>;
	renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
		clientLeaseMs?: number;
	}): Promise<boolean>;
	removeOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<void>;
	cleanupExpired(): Promise<void>;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashEquals(left: string, right: string): boolean {
	if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
		return false;
	}
	const leftBytes = Buffer.from(left, "hex");
	const rightBytes = Buffer.from(right, "hex");
	return (
		leftBytes.byteLength === rightBytes.byteLength &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, stableValue(entry)]),
	);
}

function hasExactKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	const allowedKeys = new Set(allowed);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

function canonicalizeTopology(
	topology: RealtimeDesiredTopology,
): RealtimeDesiredTopology {
	if (
		!topology ||
		typeof topology !== "object" ||
		topology.protocol !== REALTIME_TOPOLOGY_PROTOCOL ||
		topology.version !== 2 ||
		!Number.isSafeInteger(topology.revision) ||
		topology.revision < 0 ||
		!Array.isArray(topology.subscriptions)
	) {
		throw new Error("Invalid realtime topology envelope");
	}
	const ids = new Set<string>();
	const subscriptions = topology.subscriptions
		.map((raw): RealtimeDesiredSubscription => {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
				throw new Error("Realtime subscription must be an object");
			}
			const entry = raw as unknown as Record<string, unknown>;
			if (
				typeof entry.id !== "string" ||
				entry.id.length === 0 ||
				entry.id.length > 512 ||
				ids.has(entry.id)
			) {
				throw new Error("Realtime topology ids must be non-empty and unique");
			}
			ids.add(entry.id);
			if (entry.kind === "query") {
				if (
					!hasExactKeys(entry, ["kind", "id", "topic", "sinceSeq"]) ||
					!entry.topic ||
					typeof entry.topic !== "object" ||
					Array.isArray(entry.topic) ||
					(entry.sinceSeq !== undefined &&
						(!Number.isSafeInteger(entry.sinceSeq) ||
							(entry.sinceSeq as number) < 0))
				) {
					throw new Error("Invalid realtime query subscription");
				}
				return {
					kind: "query",
					id: entry.id,
					topic: stableValue(entry.topic) as Record<string, unknown>,
					...(entry.sinceSeq === undefined
						? {}
						: { sinceSeq: entry.sinceSeq as number }),
				};
			}
			if (entry.kind === "channel") {
				if (
					!hasExactKeys(entry, [
						"kind",
						"id",
						"channel",
						"params",
						"lastEventId",
					]) ||
					typeof entry.channel !== "string" ||
					entry.channel.length === 0 ||
					!entry.params ||
					typeof entry.params !== "object" ||
					Array.isArray(entry.params) ||
					Object.values(entry.params).some(
						(value) => typeof value !== "string",
					) ||
					(entry.lastEventId !== undefined &&
						typeof entry.lastEventId !== "string")
				) {
					throw new Error("Invalid realtime channel subscription");
				}
				return {
					kind: "channel",
					id: entry.id,
					channel: entry.channel,
					params: stableValue(entry.params) as Record<string, string>,
					...(entry.lastEventId === undefined
						? {}
						: { lastEventId: entry.lastEventId as string }),
				};
			}
			if (entry.kind === "crdt") {
				if (
					!hasExactKeys(entry, ["kind", "id", "bindingId"]) ||
					typeof entry.bindingId !== "string" ||
					entry.bindingId.length === 0 ||
					entry.bindingId.length > 512
				) {
					throw new Error("Invalid realtime CRDT subscription");
				}
				return {
					kind: "crdt",
					id: entry.id,
					bindingId: entry.bindingId,
				};
			}
			throw new Error("Unknown realtime subscription kind");
		})
		.sort((left, right) => left.id.localeCompare(right.id));
	const canonical: RealtimeDesiredTopology = {
		protocol: REALTIME_TOPOLOGY_PROTOCOL,
		version: 2,
		revision: topology.revision,
		subscriptions,
	};
	if (
		new TextEncoder().encode(JSON.stringify(canonical)).byteLength >
		MAX_REALTIME_TOPOLOGY_BYTES
	) {
		throw new Error("Realtime topology exceeds 262144 bytes");
	}
	return canonical;
}

function topologyEquals(
	left: RealtimeDesiredTopology,
	right: RealtimeDesiredTopology,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeTopologyRow(
	row: TopologyRow | DatabaseTopologyRow,
): TopologyRow {
	return {
		...row,
		clientSeenAt: "clientSeenAt" in row ? row.clientSeenAt : row.updatedAt,
		desiredTopology: canonicalizeTopology(
			row.desiredTopology as RealtimeDesiredTopology,
		),
	};
}

export class MemoryRealtimeTopologyStore implements RealtimeTopologyStore {
	private readonly rows = new Map<string, TopologyRow>();
	private generation = 0;

	constructor(private readonly now: () => Date = () => new Date()) {}

	async open(input: {
		sessionKey: string;
		ownerId: string;
		tokenHash: string;
		identityHash: string;
		topology: RealtimeDesiredTopology;
		leaseMs: number;
	}): Promise<TopologyRow> {
		const row: TopologyRow = {
			sessionKey: input.sessionKey,
			ownerId: input.ownerId,
			ownerGeneration: ++this.generation,
			protocolVersion: 2,
			tokenHash: input.tokenHash,
			identityHash: input.identityHash,
			leaseExpiresAt: new Date(this.now().getTime() + input.leaseMs),
			clientSeenAt: this.now(),
			desiredRevision: input.topology.revision,
			appliedRevision: input.topology.revision,
			desiredTopology: input.topology,
		};
		this.rows.set(row.sessionKey, row);
		return structuredClone(row);
	}

	async mutate(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
		mutate: (row: TopologyRow) => TopologyMutation;
	}): Promise<TopologyMutationResult> {
		const row = this.rows.get(input.sessionKey);
		if (
			!row ||
			row.leaseExpiresAt <= this.now() ||
			!hashEquals(row.tokenHash, input.tokenHash) ||
			!hashEquals(row.identityHash, input.identityHash)
		) {
			return { status: "unavailable" };
		}
		const mutation = input.mutate(structuredClone(row));
		row.clientSeenAt = this.now();
		if (mutation.status === "accepted") {
			row.desiredTopology = mutation.topology;
			row.desiredRevision = mutation.topology.revision;
		}
		return { status: mutation.status, row: structuredClone(row) };
	}

	async authorize(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
	}): Promise<TopologyRow | null> {
		const row = this.rows.get(input.sessionKey);
		return row &&
			row.leaseExpiresAt > this.now() &&
			hashEquals(row.tokenHash, input.tokenHash) &&
			hashEquals(row.identityHash, input.identityHash)
			? structuredClone(row)
			: null;
	}

	async getOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<TopologyRow | null> {
		const row = this.rows.get(input.sessionKey);
		return row &&
			row.ownerId === input.ownerId &&
			row.ownerGeneration === input.ownerGeneration &&
			row.leaseExpiresAt > this.now()
			? structuredClone(row)
			: null;
	}

	async markApplied(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		revision: number;
	}): Promise<boolean> {
		const row = await this.getOwned(input);
		if (!row) return false;
		const stored = this.rows.get(input.sessionKey)!;
		stored.appliedRevision = input.revision;
		return true;
	}

	async rejectOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		rejectedRevision: number;
		appliedRevision: number;
		appliedTopology: RealtimeDesiredTopology;
	}): Promise<boolean> {
		const row = await this.getOwned(input);
		if (!row || row.desiredRevision !== input.rejectedRevision) return false;
		const stored = this.rows.get(input.sessionKey)!;
		stored.desiredRevision = input.appliedRevision;
		stored.desiredTopology = input.appliedTopology;
		return true;
	}

	async renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
		clientLeaseMs?: number;
	}): Promise<boolean> {
		const row = this.rows.get(input.sessionKey);
		if (
			!row ||
			row.ownerId !== input.ownerId ||
			row.ownerGeneration !== input.ownerGeneration ||
			row.leaseExpiresAt <= this.now() ||
			(input.clientLeaseMs !== undefined &&
				row.clientSeenAt.getTime() + input.clientLeaseMs <=
					this.now().getTime())
		) {
			return false;
		}
		row.leaseExpiresAt = new Date(this.now().getTime() + input.leaseMs);
		return true;
	}

	async removeOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<void> {
		const row = this.rows.get(input.sessionKey);
		if (
			row?.ownerId === input.ownerId &&
			row.ownerGeneration === input.ownerGeneration
		) {
			this.rows.delete(input.sessionKey);
		}
	}

	async cleanupExpired(): Promise<void> {
		for (const [key, row] of this.rows) {
			if (row.leaseExpiresAt <= this.now()) this.rows.delete(key);
		}
	}
}

export class PostgresRealtimeTopologyStore implements RealtimeTopologyStore {
	constructor(private readonly db: AnyDrizzleClient<any>) {}

	private leaseDeadline(leaseMs: number) {
		return sql`now() + (${leaseMs} * interval '1 millisecond')`;
	}

	async open(input: {
		sessionKey: string;
		ownerId: string;
		tokenHash: string;
		identityHash: string;
		topology: RealtimeDesiredTopology;
		leaseMs: number;
	}): Promise<TopologyRow> {
		const [row] = await this.db
			.insert(questpieRealtimeTopologyTable)
			.values({
				sessionKey: input.sessionKey,
				ownerId: input.ownerId,
				protocolVersion: 2,
				tokenHash: input.tokenHash,
				identityHash: input.identityHash,
				leaseExpiresAt: this.leaseDeadline(input.leaseMs),
				desiredRevision: input.topology.revision,
				appliedRevision: input.topology.revision,
				desiredTopology: input.topology,
			})
			.returning();
		return normalizeTopologyRow(row as DatabaseTopologyRow);
	}

	async mutate(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
		mutate: (row: TopologyRow) => TopologyMutation;
	}): Promise<TopologyMutationResult> {
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(questpieRealtimeTopologyTable)
				.where(
					and(
						eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
						gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
					),
				)
				.for("update");
			if (
				!row ||
				!hashEquals(row.tokenHash, input.tokenHash) ||
				!hashEquals(row.identityHash, input.identityHash)
			) {
				return { status: "unavailable" };
			}
			const typedRow = normalizeTopologyRow(row as DatabaseTopologyRow);
			const mutation = input.mutate(typedRow);
			if (mutation.status === "accepted") {
				const [updated] = await tx
					.update(questpieRealtimeTopologyTable)
					.set({
						desiredRevision: mutation.topology.revision,
						desiredTopology: mutation.topology,
						updatedAt: sql`now()`,
					})
					.where(eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey))
					.returning();
				return {
					status: mutation.status,
					row: normalizeTopologyRow(updated as DatabaseTopologyRow),
				};
			}
			const [touched] = await tx
				.update(questpieRealtimeTopologyTable)
				.set({ updatedAt: sql`now()` })
				.where(eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey))
				.returning();
			return {
				status: mutation.status,
				row: normalizeTopologyRow(touched as DatabaseTopologyRow),
			};
		});
	}

	async authorize(input: {
		sessionKey: string;
		tokenHash: string;
		identityHash: string;
	}): Promise<TopologyRow | null> {
		const [row] = await this.db
			.select()
			.from(questpieRealtimeTopologyTable)
			.where(
				and(
					eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
					gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
				),
			);
		if (
			!row ||
			!hashEquals(row.tokenHash, input.tokenHash) ||
			!hashEquals(row.identityHash, input.identityHash)
		) {
			return null;
		}
		return normalizeTopologyRow(row as DatabaseTopologyRow);
	}

	async getOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<TopologyRow | null> {
		const [row] = await this.db
			.select()
			.from(questpieRealtimeTopologyTable)
			.where(
				and(
					eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
					eq(questpieRealtimeTopologyTable.ownerId, input.ownerId),
					eq(
						questpieRealtimeTopologyTable.ownerGeneration,
						input.ownerGeneration,
					),
					gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
				),
			);
		return row ? normalizeTopologyRow(row as DatabaseTopologyRow) : null;
	}

	async markApplied(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		revision: number;
	}): Promise<boolean> {
		const rows = await this.db
			.update(questpieRealtimeTopologyTable)
			.set({ appliedRevision: input.revision })
			.where(
				and(
					eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
					eq(questpieRealtimeTopologyTable.ownerId, input.ownerId),
					eq(
						questpieRealtimeTopologyTable.ownerGeneration,
						input.ownerGeneration,
					),
					gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
				),
			)
			.returning({ sessionKey: questpieRealtimeTopologyTable.sessionKey });
		return rows.length === 1;
	}

	async rejectOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		rejectedRevision: number;
		appliedRevision: number;
		appliedTopology: RealtimeDesiredTopology;
	}): Promise<boolean> {
		const rows = await this.db
			.update(questpieRealtimeTopologyTable)
			.set({
				desiredRevision: input.appliedRevision,
				desiredTopology: input.appliedTopology,
			})
			.where(
				and(
					eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
					eq(questpieRealtimeTopologyTable.ownerId, input.ownerId),
					eq(
						questpieRealtimeTopologyTable.ownerGeneration,
						input.ownerGeneration,
					),
					eq(
						questpieRealtimeTopologyTable.desiredRevision,
						input.rejectedRevision,
					),
					gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
				),
			)
			.returning({ sessionKey: questpieRealtimeTopologyTable.sessionKey });
		return rows.length === 1;
	}

	async renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
		clientLeaseMs?: number;
	}): Promise<boolean> {
		const predicates = [
			eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
			eq(questpieRealtimeTopologyTable.ownerId, input.ownerId),
			eq(questpieRealtimeTopologyTable.ownerGeneration, input.ownerGeneration),
			gt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`),
		];
		if (input.clientLeaseMs !== undefined) {
			predicates.push(
				gt(
					questpieRealtimeTopologyTable.updatedAt,
					sql`now() - (${input.clientLeaseMs} * interval '1 millisecond')`,
				),
			);
		}
		const rows = await this.db
			.update(questpieRealtimeTopologyTable)
			.set({
				leaseExpiresAt: this.leaseDeadline(input.leaseMs),
			})
			.where(and(...predicates))
			.returning({ sessionKey: questpieRealtimeTopologyTable.sessionKey });
		return rows.length === 1;
	}

	async removeOwned(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
	}): Promise<void> {
		await this.db
			.delete(questpieRealtimeTopologyTable)
			.where(
				and(
					eq(questpieRealtimeTopologyTable.sessionKey, input.sessionKey),
					eq(questpieRealtimeTopologyTable.ownerId, input.ownerId),
					eq(
						questpieRealtimeTopologyTable.ownerGeneration,
						input.ownerGeneration,
					),
				),
			);
	}

	async cleanupExpired(): Promise<void> {
		await this.db
			.delete(questpieRealtimeTopologyTable)
			.where(lt(questpieRealtimeTopologyTable.leaseExpiresAt, sql`now()`));
	}
}

export type RealtimeTopologyResult =
	| { status: "unavailable" }
	| {
			status:
				| "accepted"
				| "duplicate"
				| "stale"
				| "conflict"
				| "unsupported"
				| "invalid";
			revision: number;
			desiredRevision: number;
			appliedRevision: number;
	  };

type LocalHandler = {
	generation: number;
	appliedRevision: number;
	appliedTopology: RealtimeDesiredTopology;
	apply: (input: RealtimeTopologyApplyInput) => Promise<void>;
	onClose: () => Promise<void> | void;
	abortController: AbortController;
	operation: Promise<void>;
	reconciling: boolean;
	reconcilePending: boolean;
	clientLeaseMs?: number;
};

export class RealtimeTopologyCoordinator {
	private readonly ownerId: string;
	private readonly broker?: ChangePublisher;
	private readonly leaseMs: number;
	private readonly heartbeatMs: number;
	private reconcileMs: number;
	private readonly onError: (error: unknown) => void;
	private readonly observer?: RealtimeObserver;
	private readonly handlers = new Map<string, LocalHandler>();
	private heartbeatTimer?: ReturnType<typeof setInterval>;
	private reconcileTimer?: ReturnType<typeof setInterval>;
	private reconcileOperation: Promise<void> | null = null;
	private started = false;

	constructor(
		private readonly store: RealtimeTopologyStore,
		options: {
			broker?: ChangePublisher;
			ownerId?: string;
			now?: () => Date;
			leaseMs?: number;
			heartbeatMs?: number;
			reconcileMs?: number;
			onError?: (error: unknown) => void;
			observer?: RealtimeObserver;
		} = {},
	) {
		this.ownerId = options.ownerId ?? randomUUID();
		this.broker = options.broker;
		this.leaseMs = options.leaseMs ?? 30_000;
		this.heartbeatMs = options.heartbeatMs ?? 10_000;
		this.reconcileMs =
			options.reconcileMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS;
		this.onError = options.onError ?? (() => {});
		this.observer = options.observer;
	}

	private observe(event: RealtimeObservation): void {
		try {
			this.observer?.record(event);
		} catch {
			// Topology observations cannot break control or lease handling.
		}
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		if (this.heartbeatMs > 0) {
			this.heartbeatTimer = setInterval(
				() => void this.heartbeat().catch(this.onError),
				this.heartbeatMs,
			);
		}
		this.startReconcileTimer();
	}

	setReconciliationPollInterval(intervalMs: number): void {
		if (this.reconcileMs === intervalMs) return;
		this.reconcileMs = intervalMs;
		if (this.reconcileTimer) clearInterval(this.reconcileTimer);
		this.reconcileTimer = undefined;
		this.startReconcileTimer();
	}

	private startReconcileTimer(): void {
		if (!this.started || this.reconcileMs <= 0 || this.reconcileTimer) return;
		this.reconcileTimer = setInterval(
			() => void this.reconcile().catch(this.onError),
			this.reconcileMs,
		);
	}

	async open(input: {
		sessionId: string;
		token: string;
		identity: string;
		topology: RealtimeDesiredTopology;
		/** Required only when no physical client connection can signal teardown. */
		clientLeaseMs?: number;
		apply: (input: RealtimeTopologyApplyInput) => Promise<void>;
		onClose: () => Promise<void> | void;
	}): Promise<{
		generation: number;
		signal: AbortSignal;
		close(): Promise<void>;
	}> {
		await this.start();
		if (
			input.clientLeaseMs !== undefined &&
			(!Number.isSafeInteger(input.clientLeaseMs) ||
				input.clientLeaseMs < 1 ||
				input.clientLeaseMs > 5 * 60_000)
		) {
			throw new Error("Invalid realtime client lease");
		}
		const topology = canonicalizeTopology(input.topology);
		const sessionKey = hash(input.sessionId);
		const row = await this.store.open({
			sessionKey,
			ownerId: this.ownerId,
			tokenHash: hash(input.token),
			identityHash: hash(input.identity),
			topology,
			leaseMs: this.leaseMs,
		});
		const abortController = new AbortController();
		this.handlers.set(sessionKey, {
			generation: row.ownerGeneration,
			appliedRevision: topology.revision,
			appliedTopology: topology,
			apply: input.apply,
			onClose: input.onClose,
			abortController,
			operation: Promise.resolve(),
			reconciling: false,
			reconcilePending: false,
			clientLeaseMs: input.clientLeaseMs,
		});
		this.observe({
			type: "topology.lifecycle",
			phase: "open",
			outcome: "accepted",
			desiredRevision: topology.revision,
			appliedRevision: topology.revision,
		});
		return {
			generation: row.ownerGeneration,
			signal: abortController.signal,
			close: () => this.closeLocal(sessionKey, true, false),
		};
	}

	async submit(input: {
		sessionId: string;
		token: string;
		identity: string;
		topology: RealtimeDesiredTopology;
	}): Promise<RealtimeTopologyResult> {
		let topology: RealtimeDesiredTopology;
		try {
			topology = canonicalizeTopology(input.topology);
		} catch {
			const status = input.topology.version === 2 ? "invalid" : "unsupported";
			this.observe({
				type: "topology.lifecycle",
				phase: "submit",
				outcome: status,
			});
			return {
				status,
				revision: 0,
				desiredRevision: 0,
				appliedRevision: 0,
			};
		}
		return this.commit(input, (row) => {
			if (topology.revision < row.desiredRevision) return { status: "stale" };
			if (topology.revision === row.desiredRevision) {
				return topologyEquals(topology, row.desiredTopology)
					? { status: "duplicate" }
					: { status: "conflict" };
			}
			return { status: "accepted", topology };
		});
	}

	/**
	 * Validate a live edge capability without renewing or transferring it.
	 * The returned key is the one-way durable identity used by CRDT bindings.
	 */
	async authorizeSession(input: {
		sessionId: string;
		token: string;
		identity: string;
	}): Promise<{ sessionKey: string; ownerGeneration: number } | null> {
		const sessionKey = hash(input.sessionId);
		const row = await this.store.authorize({
			sessionKey,
			tokenHash: hash(input.token),
			identityHash: hash(input.identity),
		});
		return row
			? {
					sessionKey: row.sessionKey,
					ownerGeneration: row.ownerGeneration,
				}
			: null;
	}

	private async commit(
		input: { sessionId: string; token: string; identity: string },
		mutate: (row: TopologyRow) => TopologyMutation,
	): Promise<RealtimeTopologyResult> {
		const result = await this.store.mutate({
			sessionKey: hash(input.sessionId),
			tokenHash: hash(input.token),
			identityHash: hash(input.identity),
			mutate,
		});
		if (result.status === "unavailable") {
			this.observe({
				type: "topology.lifecycle",
				phase: "submit",
				outcome: "unavailable",
			});
			return result;
		}
		const response = {
			status: result.status,
			revision: result.row.desiredRevision,
			desiredRevision: result.row.desiredRevision,
			appliedRevision: result.row.appliedRevision,
		} as RealtimeTopologyResult;
		this.observe({
			type: "topology.lifecycle",
			phase: "submit",
			outcome: result.status,
			desiredRevision: result.row.desiredRevision,
			appliedRevision: result.row.appliedRevision,
		});
		if (result.status !== "accepted") return response;
		const wake: ChangeWake = {
			kind: "topology-maybe-advanced",
			sessionKey: result.row.sessionKey,
			ownerId: result.row.ownerId,
			ownerGeneration: result.row.ownerGeneration,
			desiredRevision: result.row.desiredRevision,
			reason: "submit",
		};
		try {
			await this.broker?.publish(wake);
		} catch (error) {
			this.onError(error);
		}
		if (result.row.ownerId === this.ownerId) {
			await this.reconcileSession(result.row.sessionKey);
		}
		return response;
	}

	onWake(wake: ChangeWake): void {
		if (
			wake.kind !== "topology-maybe-advanced" ||
			wake.ownerId !== this.ownerId
		) {
			return;
		}
		void this.reconcileSession(wake.sessionKey).catch(this.onError);
	}

	async reconcile(): Promise<void> {
		if (this.reconcileOperation) return this.reconcileOperation;
		this.reconcileOperation = (async () => {
			await Promise.all(
				[...this.handlers.keys()].map((key) => this.reconcileSession(key)),
			);
			await this.store.cleanupExpired();
		})().finally(() => {
			this.reconcileOperation = null;
		});
		return this.reconcileOperation;
	}

	private async reconcileSession(sessionKey: string): Promise<void> {
		const handler = this.handlers.get(sessionKey);
		if (!handler) return;
		if (handler.reconciling) {
			handler.reconcilePending = true;
			await handler.operation;
			return;
		}
		handler.reconciling = true;
		handler.operation = handler.operation
			.catch(() => {})
			.then(async () => {
				do {
					handler.reconcilePending = false;
					await this.runReconcileSession(sessionKey, handler);
				} while (
					handler.reconcilePending &&
					this.handlers.get(sessionKey) === handler
				);
			})
			.finally(() => {
				handler.reconciling = false;
			});
		await handler.operation;
	}

	private async runReconcileSession(
		sessionKey: string,
		handler: LocalHandler,
	): Promise<void> {
		this.observe({
			type: "topology.lifecycle",
			phase: "reconcile",
			outcome: "started",
		});
		let row: TopologyRow | null;
		try {
			row = await this.store.getOwned({
				sessionKey,
				ownerId: this.ownerId,
				ownerGeneration: handler.generation,
			});
		} catch (error) {
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "failed",
			});
			throw error;
		}
		if (!row) {
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "expired",
			});
			this.observe({
				type: "topology.lifecycle",
				phase: "lease",
				outcome: "expired",
			});
			await this.closeLocal(sessionKey, false, true);
			return;
		}
		if (row.desiredRevision <= handler.appliedRevision) {
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "current",
				desiredRevision: row.desiredRevision,
				appliedRevision: handler.appliedRevision,
			});
			return;
		}
		try {
			await handler.apply({
				topology: row.desiredTopology,
				ownerGeneration: handler.generation,
				signal: handler.abortController.signal,
			});
		} catch (error) {
			if (error instanceof RealtimeTopologyApplyRejectedError) {
				const reverted = await this.store.rejectOwned({
					sessionKey,
					ownerId: this.ownerId,
					ownerGeneration: handler.generation,
					rejectedRevision: row.desiredRevision,
					appliedRevision: handler.appliedRevision,
					appliedTopology: handler.appliedTopology,
				});
				this.observe({
					type: "topology.lifecycle",
					phase: "apply",
					outcome: reverted ? "rejected" : "fenced",
					desiredRevision: row.desiredRevision,
					appliedRevision: handler.appliedRevision,
				});
				if (!reverted) {
					await this.closeLocal(sessionKey, false, true);
				}
				return;
			}
			this.observe({
				type: "topology.lifecycle",
				phase: "apply",
				outcome: "failed",
				desiredRevision: row.desiredRevision,
				appliedRevision: handler.appliedRevision,
			});
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "failed",
				desiredRevision: row.desiredRevision,
				appliedRevision: handler.appliedRevision,
			});
			this.onError(error);
			await this.closeLocal(sessionKey, true, true);
			return;
		}
		if (
			handler.abortController.signal.aborted ||
			this.handlers.get(sessionKey) !== handler
		) {
			this.observe({
				type: "topology.lifecycle",
				phase: "apply",
				outcome: "fenced",
			});
			return;
		}
		let marked: boolean;
		try {
			marked = await this.store.markApplied({
				sessionKey,
				ownerId: this.ownerId,
				ownerGeneration: handler.generation,
				revision: row.desiredRevision,
			});
		} catch (error) {
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "failed",
				desiredRevision: row.desiredRevision,
				appliedRevision: handler.appliedRevision,
			});
			throw error;
		}
		if (!marked) {
			this.observe({
				type: "topology.lifecycle",
				phase: "apply",
				outcome: "fenced",
			});
			this.observe({
				type: "topology.lifecycle",
				phase: "reconcile",
				outcome: "fenced",
			});
			await this.closeLocal(sessionKey, false, true);
			return;
		}
		handler.appliedRevision = row.desiredRevision;
		handler.appliedTopology = row.desiredTopology;
		this.observe({
			type: "topology.lifecycle",
			phase: "apply",
			outcome: "applied",
			desiredRevision: row.desiredRevision,
			appliedRevision: row.desiredRevision,
		});
		this.observe({
			type: "topology.lifecycle",
			phase: "reconcile",
			outcome: "applied",
			desiredRevision: row.desiredRevision,
			appliedRevision: row.desiredRevision,
		});
	}

	private async heartbeat(): Promise<void> {
		for (const [sessionKey, handler] of this.handlers) {
			const renewed = await this.store.renew({
				sessionKey,
				ownerId: this.ownerId,
				ownerGeneration: handler.generation,
				leaseMs: this.leaseMs,
				clientLeaseMs: handler.clientLeaseMs,
			});
			if (!renewed) {
				this.observe({
					type: "topology.lifecycle",
					phase: "lease",
					outcome: "expired",
				});
				await this.closeLocal(sessionKey, true, true);
			}
		}
	}

	private async closeLocal(
		sessionKey: string,
		removeOwned: boolean,
		notify: boolean,
	): Promise<void> {
		const handler = this.handlers.get(sessionKey);
		if (!handler) return;
		this.handlers.delete(sessionKey);
		handler.abortController.abort();
		if (removeOwned) {
			await this.store.removeOwned({
				sessionKey,
				ownerId: this.ownerId,
				ownerGeneration: handler.generation,
			});
		}
		if (notify) await handler.onClose();
		this.observe({
			type: "topology.lifecycle",
			phase: "close",
			outcome: "closed",
		});
	}

	async stop(): Promise<void> {
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		if (this.reconcileTimer) clearInterval(this.reconcileTimer);
		this.heartbeatTimer = undefined;
		this.reconcileTimer = undefined;
		for (const key of this.handlers.keys()) {
			await this.closeLocal(key, true, true);
		}
		this.started = false;
	}
}

export function createPostgresRealtimeTopologyCoordinator(
	db: AnyDrizzleClient<any>,
	options: ConstructorParameters<typeof RealtimeTopologyCoordinator>[1] = {},
): RealtimeTopologyCoordinator {
	return new RealtimeTopologyCoordinator(
		new PostgresRealtimeTopologyStore(db),
		options,
	);
}
