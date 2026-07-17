import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";

import { questpieRealtimeTopologyTable } from "./collection.js";
import type { RealtimeObservation, RealtimeObserver } from "./observer.js";
import type { RealtimeControlFrame } from "./sse-control.js";
import type { ChangeBroker, ChangeWake } from "./transport.js";

export const REALTIME_TOPOLOGY_PROTOCOL = "questpie-realtime-topology" as const;
export const MAX_REALTIME_TOPOLOGY_BYTES = 262_144;

export type RealtimeTopologyTopic = {
	id: string;
	topic: Record<string, unknown>;
	sinceSeq?: number;
};

export type RealtimeTopologyChannel = {
	id: string;
	channel: string;
	params: Record<string, string>;
	lastEventId?: string;
};

export type RealtimeDesiredTopology = {
	protocol: typeof REALTIME_TOPOLOGY_PROTOCOL;
	version: 1;
	revision: number;
	topics: RealtimeTopologyTopic[];
	channels: RealtimeTopologyChannel[];
};

type TopologyRow = {
	sessionKey: string;
	ownerId: string;
	ownerGeneration: number;
	protocolVersion: number;
	tokenHash: string;
	identityHash: string;
	leaseExpiresAt: Date;
	desiredRevision: number;
	appliedRevision: number;
	desiredTopology: RealtimeDesiredTopology;
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
	renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
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

function canonicalizeTopology(
	topology: RealtimeDesiredTopology,
): RealtimeDesiredTopology {
	const ids = new Set<string>();
	const topics = topology.topics
		.map((entry) => ({
			id: entry.id,
			topic: stableValue(entry.topic) as Record<string, unknown>,
			...(entry.sinceSeq === undefined ? {} : { sinceSeq: entry.sinceSeq }),
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	const channels = topology.channels
		.map((entry) => ({
			id: entry.id,
			channel: entry.channel,
			params: stableValue(entry.params) as Record<string, string>,
			...(entry.lastEventId === undefined
				? {}
				: { lastEventId: entry.lastEventId }),
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	for (const entry of [...topics, ...channels]) {
		if (!entry.id || ids.has(entry.id)) {
			throw new Error("Realtime topology ids must be non-empty and unique");
		}
		ids.add(entry.id);
	}
	if (
		topology.protocol !== REALTIME_TOPOLOGY_PROTOCOL ||
		topology.version !== 1 ||
		!Number.isSafeInteger(topology.revision) ||
		topology.revision < 0
	) {
		throw new Error("Invalid realtime topology envelope");
	}
	const canonical: RealtimeDesiredTopology = {
		protocol: REALTIME_TOPOLOGY_PROTOCOL,
		version: 1,
		revision: topology.revision,
		topics,
		channels,
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

function normalizeTopologyRow(row: TopologyRow): TopologyRow {
	return {
		...row,
		desiredTopology: canonicalizeTopology(row.desiredTopology),
	};
}

function applyLegacyFrames(
	current: RealtimeDesiredTopology,
	frames: RealtimeControlFrame[],
): TopologyMutation {
	const topics = new Map(current.topics.map((entry) => [entry.id, entry]));
	const channels = new Map(current.channels.map((entry) => [entry.id, entry]));
	for (const frame of frames) {
		if (frame.type === "remove_topic") {
			topics.delete(frame.topicId);
			continue;
		}
		if (frame.type === "unsubscribe_channel") {
			channels.delete(frame.subscriptionId);
			continue;
		}
		if (frame.type === "add_topic") {
			const next = canonicalizeTopology({
				...current,
				topics: [
					{
						id: frame.topicId,
						topic: frame.topic,
						...(frame.sinceSeq === undefined
							? {}
							: { sinceSeq: frame.sinceSeq }),
					},
				],
				channels: [],
			}).topics[0]!;
			const existing = topics.get(frame.topicId);
			if (existing && JSON.stringify(existing) !== JSON.stringify(next)) {
				return { status: "conflict" };
			}
			topics.set(frame.topicId, next);
			continue;
		}
		const next = canonicalizeTopology({
			...current,
			topics: [],
			channels: [
				{
					id: frame.subscriptionId,
					channel: frame.channel,
					params: frame.params,
					...(frame.lastEventId === undefined
						? {}
						: { lastEventId: frame.lastEventId }),
				},
			],
		}).channels[0]!;
		const existing = channels.get(frame.subscriptionId);
		if (existing && JSON.stringify(existing) !== JSON.stringify(next)) {
			return { status: "conflict" };
		}
		channels.set(frame.subscriptionId, next);
	}
	const topology = canonicalizeTopology({
		...current,
		revision: current.revision + 1,
		topics: [...topics.values()],
		channels: [...channels.values()],
	});
	const withoutRevision = { ...topology, revision: current.revision };
	if (topologyEquals(current, withoutRevision)) return { status: "duplicate" };
	return { status: "accepted", topology };
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
			protocolVersion: 1,
			tokenHash: input.tokenHash,
			identityHash: input.identityHash,
			leaseExpiresAt: new Date(this.now().getTime() + input.leaseMs),
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
		if (mutation.status === "accepted") {
			row.desiredTopology = mutation.topology;
			row.desiredRevision = mutation.topology.revision;
		}
		return { status: mutation.status, row: structuredClone(row) };
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

	async renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
	}): Promise<boolean> {
		const row = await this.getOwned(input);
		if (!row) return false;
		this.rows.get(input.sessionKey)!.leaseExpiresAt = new Date(
			this.now().getTime() + input.leaseMs,
		);
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
				protocolVersion: 1,
				tokenHash: input.tokenHash,
				identityHash: input.identityHash,
				leaseExpiresAt: this.leaseDeadline(input.leaseMs),
				desiredRevision: input.topology.revision,
				appliedRevision: input.topology.revision,
				desiredTopology: input.topology,
			})
			.returning();
		return normalizeTopologyRow(row as TopologyRow);
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
			const typedRow = normalizeTopologyRow(row as TopologyRow);
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
					row: normalizeTopologyRow(updated as TopologyRow),
				};
			}
			return { status: mutation.status, row: typedRow };
		});
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
		return row ? normalizeTopologyRow(row as TopologyRow) : null;
	}

	async markApplied(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		revision: number;
	}): Promise<boolean> {
		const rows = await this.db
			.update(questpieRealtimeTopologyTable)
			.set({ appliedRevision: input.revision, updatedAt: sql`now()` })
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

	async renew(input: {
		sessionKey: string;
		ownerId: string;
		ownerGeneration: number;
		leaseMs: number;
	}): Promise<boolean> {
		const rows = await this.db
			.update(questpieRealtimeTopologyTable)
			.set({
				leaseExpiresAt: this.leaseDeadline(input.leaseMs),
				updatedAt: sql`now()`,
			})
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
	apply: (topology: RealtimeDesiredTopology) => Promise<void>;
	onClose: () => Promise<void> | void;
	operation: Promise<void>;
};

export class RealtimeTopologyCoordinator {
	private readonly ownerId: string;
	private readonly broker?: ChangeBroker;
	private readonly leaseMs: number;
	private readonly heartbeatMs: number;
	private readonly reconcileMs: number;
	private readonly onError: (error: unknown) => void;
	private readonly observer?: RealtimeObserver;
	private readonly handlers = new Map<string, LocalHandler>();
	private heartbeatTimer?: ReturnType<typeof setInterval>;
	private reconcileTimer?: ReturnType<typeof setInterval>;
	private started = false;

	constructor(
		private readonly store: RealtimeTopologyStore,
		options: {
			broker?: ChangeBroker;
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
		this.reconcileMs = options.reconcileMs ?? 1_000;
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
		if (this.reconcileMs > 0) {
			this.reconcileTimer = setInterval(
				() => void this.reconcile().catch(this.onError),
				this.reconcileMs,
			);
		}
	}

	async open(input: {
		sessionId: string;
		token: string;
		identity: string;
		topology: RealtimeDesiredTopology;
		apply: (topology: RealtimeDesiredTopology) => Promise<void>;
		onClose: () => Promise<void> | void;
	}): Promise<{ generation: number; close(): Promise<void> }> {
		await this.start();
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
		this.handlers.set(sessionKey, {
			generation: row.ownerGeneration,
			appliedRevision: topology.revision,
			apply: input.apply,
			onClose: input.onClose,
			operation: Promise.resolve(),
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
			const status = input.topology.version === 1 ? "invalid" : "unsupported";
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

	async submitLegacy(input: {
		sessionId: string;
		token: string;
		identity: string;
		frames: RealtimeControlFrame[];
	}): Promise<RealtimeTopologyResult> {
		return this.commit(input, (row) =>
			applyLegacyFrames(row.desiredTopology, input.frames),
		);
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
		await Promise.all(
			[...this.handlers.keys()].map((key) => this.reconcileSession(key)),
		);
		await this.store.cleanupExpired();
	}

	private async reconcileSession(sessionKey: string): Promise<void> {
		const handler = this.handlers.get(sessionKey);
		if (!handler) return;
		handler.operation = handler.operation
			.catch(() => {})
			.then(async () => {
				this.observe({
					type: "topology.lifecycle",
					phase: "reconcile",
					outcome: "started",
				});
				const row = await this.store.getOwned({
					sessionKey,
					ownerId: this.ownerId,
					ownerGeneration: handler.generation,
				});
				if (!row) {
					this.observe({
						type: "topology.lifecycle",
						phase: "lease",
						outcome: "expired",
					});
					await this.closeLocal(sessionKey, false, true);
					return;
				}
				if (row.desiredRevision <= handler.appliedRevision) return;
				try {
					await handler.apply(row.desiredTopology);
				} catch (error) {
					this.observe({
						type: "topology.lifecycle",
						phase: "apply",
						outcome: "failed",
						desiredRevision: row.desiredRevision,
						appliedRevision: handler.appliedRevision,
					});
					this.onError(error);
					await this.closeLocal(sessionKey, true, true);
					return;
				}
				const marked = await this.store.markApplied({
					sessionKey,
					ownerId: this.ownerId,
					ownerGeneration: handler.generation,
					revision: row.desiredRevision,
				});
				if (!marked) {
					this.observe({
						type: "topology.lifecycle",
						phase: "apply",
						outcome: "fenced",
					});
					await this.closeLocal(sessionKey, false, true);
					return;
				}
				handler.appliedRevision = row.desiredRevision;
				this.observe({
					type: "topology.lifecycle",
					phase: "apply",
					outcome: "applied",
					desiredRevision: row.desiredRevision,
					appliedRevision: row.desiredRevision,
				});
			});
		await handler.operation;
	}

	private async heartbeat(): Promise<void> {
		for (const [sessionKey, handler] of this.handlers) {
			const renewed = await this.store.renew({
				sessionKey,
				ownerId: this.ownerId,
				ownerGeneration: handler.generation,
				leaseMs: this.leaseMs,
			});
			if (!renewed) {
				this.observe({
					type: "topology.lifecycle",
					phase: "lease",
					outcome: "expired",
				});
				await this.closeLocal(sessionKey, false, true);
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
