import { deriveDeltaOp, type RealtimeDeliveryMode } from "./delta.js";
import {
	realtimeOperation,
	type RealtimeObservation,
	type RealtimeObserver,
} from "./observer.js";
import { encodeSseEvent } from "./sse-client-transport.js";
import type {
	RealtimeChangeEvent,
	RealtimeErrorListener,
	RealtimeTopics,
} from "./types.js";

type RealtimeSource = {
	record?(event: RealtimeObservation): void;
	getLatestSeq(): Promise<number>;
	getResumeState?(sinceSeq: number): Promise<{
		latestSeq: number;
		reset: boolean;
	}>;
	subscribe(
		listener: (event: RealtimeChangeEvent) => void,
		topics: RealtimeTopics,
		errorListener?: RealtimeErrorListener,
	): () => void;
};

type AccessContext = {
	session?: { session?: { id?: unknown } } | null;
	principal?: {
		kind: string;
		session?: { id?: unknown };
		tokenId?: unknown;
	} | null;
	locale?: string;
	stage?: string;
	accessMode?: string;
};

export type RealtimeAccessCacheKeyResolver<TContext = AccessContext> = (
	context: TContext,
) => string | null | undefined | Promise<string | null | undefined>;

export async function resolveRealtimeAccessKey<TContext extends AccessContext>(
	edgeSessionId: string,
	context: TContext,
	resolver?: RealtimeAccessCacheKeyResolver<TContext>,
): Promise<string> {
	let identity: string | undefined;
	if (resolver) {
		try {
			const sharedKey = await resolver(context);
			if (sharedKey) identity = `shared:${sharedKey}`;
		} catch {
			// An invalid opt-in must fail safe to the session-scoped default.
		}
	}

	if (!identity) {
		const principal = context.principal;
		const sessionId = principal?.session?.id ?? context.session?.session?.id;
		if (typeof sessionId === "string" && sessionId) {
			identity = `session:${sessionId}`;
		} else if (
			principal?.kind === "oauth" &&
			typeof principal.tokenId === "string" &&
			principal.tokenId
		) {
			identity = `oauth:${principal.tokenId}`;
		} else {
			identity = `edge:${edgeSessionId}`;
		}
	}

	return JSON.stringify([
		identity,
		context.locale ?? "",
		context.stage ?? "",
		context.accessMode ?? "",
	]);
}

type Subscriber = {
	topicId: string;
	onFrame: (
		frame: Uint8Array,
		delivery?: RealtimeDeliveryMode,
	) => Promise<void> | void;
	onError: RealtimeErrorListener;
	onTransportError?: RealtimeErrorListener;
};

type SchedulerGroup = {
	key: string;
	topicId: string;
	topics: RealtimeTopics;
	sinceSeq?: number;
	compute: () => Promise<unknown>;
	subscribers: Set<Subscriber>;
	unsubscribe: () => void;
	lastSeq: number;
	lastHash?: string;
	lastFrame?: Uint8Array;
	refreshInFlight: boolean;
	refreshQueued: boolean;
	nextReset: boolean;
	disposed: boolean;
};

export type RefreshSubscriptionInput = {
	key: string;
	topicId: string;
	topics: RealtimeTopics;
	sinceSeq?: number;
	compute: () => Promise<unknown>;
	onFrame: (
		frame: Uint8Array,
		delivery?: RealtimeDeliveryMode,
	) => Promise<void> | void;
	onError: RealtimeErrorListener;
	onTransportError?: RealtimeErrorListener;
	mode?: RealtimeDeliveryMode;
	hydrateRows?: (recordIds: string[]) => Promise<unknown>;
	maxDeltaQueueEvents?: number;
	maxDeltaQueueBytes?: number;
};

const sha256 = async (value: string): Promise<string> => {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
};

type DeltaSubscriber = Subscriber & {
	ready: boolean;
	pending: Array<{ frame: Uint8Array; delivery: RealtimeDeliveryMode }>;
	pendingBytes: number;
	rebootstrap: boolean;
};

type DeltaGroup = {
	key: string;
	topics: RealtimeTopics;
	compute: () => Promise<unknown>;
	hydrateRows: (recordIds: string[]) => Promise<unknown>;
	subscribers: Set<DeltaSubscriber>;
	unsubscribe: () => void;
	queue: RealtimeChangeEvent[];
	queueBytes: number;
	maxQueueEvents: number;
	maxQueueBytes: number;
	latestSeq: number;
	lastDeliveredSeq: number;
	rowHashes: Map<string, string>;
	ready: boolean;
	processing: boolean;
	resetQueued: boolean;
	disposed: boolean;
};

function snapshotRows(data: unknown): unknown[] {
	if (Array.isArray(data)) return data;
	if (data && typeof data === "object") {
		const docs = (data as { docs?: unknown }).docs;
		if (Array.isArray(docs)) return docs;
	}
	return [];
}

function rowKey(row: unknown): string | null {
	if (!row || typeof row !== "object") return null;
	const id = (row as { id?: unknown }).id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function eventRecordIds(event: RealtimeChangeEvent): string[] | null {
	if (event.operation === "bulk_update" || event.operation === "bulk_delete") {
		const ids = event.payload?.recordIds;
		if (!ids || ids.length === 0) return null;
		return ids.map(String);
	}
	return event.recordId === null || event.recordId === undefined
		? null
		: [String(event.recordId)];
}

/** App-scoped compute-once/deliver-many scheduler for live-query snapshots. */
export class RealtimeRefreshScheduler {
	private readonly groups = new Map<string, SchedulerGroup>();
	private readonly deltaGroups = new Map<string, DeltaGroup>();
	private readonly pendingComputations: Array<() => void> = [];
	private activeComputations = 0;

	constructor(
		private readonly realtime: RealtimeSource,
		private readonly maxConcurrency = 10,
		private readonly observer?: RealtimeObserver,
	) {}

	private observe(event: RealtimeObservation): void {
		try {
			this.observer?.record(event);
		} catch {
			// Observability cannot break refresh delivery.
		}
	}

	subscribe(input: RefreshSubscriptionInput): () => void {
		if (input.mode === "delta") return this.subscribeDelta(input);

		let group = this.groups.get(input.key);
		let created = false;
		if (!group) {
			created = true;
			group = {
				key: input.key,
				topicId: input.topicId,
				topics: input.topics,
				sinceSeq: input.sinceSeq,
				compute: input.compute,
				subscribers: new Set(),
				unsubscribe: () => {},
				lastSeq: 0,
				refreshInFlight: false,
				refreshQueued: false,
				nextReset: false,
				disposed: false,
			};
			this.groups.set(input.key, group);
			group.unsubscribe = this.realtime.subscribe(
				(event) => this.requestRefresh(group!, event.seq),
				input.topics,
				(error) => this.reportTransportError(group!, error),
			);
		}

		const subscriber: Subscriber = {
			topicId: input.topicId,
			onFrame: input.onFrame,
			onError: input.onError,
			onTransportError: input.onTransportError,
		};
		group.subscribers.add(subscriber);

		if (group.lastFrame) {
			void Promise.resolve(input.onFrame(group.lastFrame)).catch(input.onError);
		} else if (created) {
			void this.initialize(group);
		}

		return () => {
			if (!group!.subscribers.delete(subscriber)) return;
			if (group!.subscribers.size > 0) return;
			group!.disposed = true;
			group!.unsubscribe();
			this.groups.delete(group!.key);
		};
	}

	private subscribeDelta(input: RefreshSubscriptionInput): () => void {
		if (!input.hydrateRows) {
			throw new Error("Delta subscriptions require hydrateRows");
		}
		let group = this.deltaGroups.get(input.key);
		if (!group) {
			group = {
				key: input.key,
				topics: input.topics,
				compute: input.compute,
				hydrateRows: input.hydrateRows,
				subscribers: new Set(),
				unsubscribe: () => {},
				queue: [],
				queueBytes: 0,
				maxQueueEvents: input.maxDeltaQueueEvents ?? 512,
				maxQueueBytes: input.maxDeltaQueueBytes ?? 1024 * 1024,
				latestSeq: 0,
				lastDeliveredSeq: 0,
				rowHashes: new Map(),
				ready: false,
				processing: false,
				resetQueued: false,
				disposed: false,
			};
			this.deltaGroups.set(input.key, group);
			group.unsubscribe = this.realtime.subscribe(
				(event) => this.onDeltaChange(group!, event),
				input.topics,
				(error) => this.reportDeltaTransportError(group!, error),
			);
		}

		const subscriber: DeltaSubscriber = {
			topicId: input.topicId,
			onFrame: input.onFrame,
			onError: input.onError,
			onTransportError: input.onTransportError,
			ready: false,
			pending: [],
			pendingBytes: 0,
			rebootstrap: false,
		};
		group.subscribers.add(subscriber);
		void this.bootstrapDeltaSubscriber(group, subscriber);

		return () => {
			if (!group!.subscribers.delete(subscriber)) return;
			if (group!.subscribers.size > 0) return;
			group!.disposed = true;
			group!.unsubscribe();
			this.deltaGroups.delete(group!.key);
		};
	}

	private async bootstrapDeltaSubscriber(
		group: DeltaGroup,
		subscriber: DeltaSubscriber,
	): Promise<void> {
		try {
			do {
				subscriber.rebootstrap = false;
				subscriber.pending = [];
				subscriber.pendingBytes = 0;
				const bootstrapSeq = group.ready
					? group.lastDeliveredSeq
					: await this.realtime.getLatestSeq();
				group.latestSeq = Math.max(group.latestSeq, bootstrapSeq);
				group.lastDeliveredSeq = Math.max(group.lastDeliveredSeq, bootstrapSeq);
				const data = await this.runBounded(group.compute);
				if (group.disposed || !group.subscribers.has(subscriber)) return;
				if (!group.ready) {
					await this.replaceDeltaHashes(group, snapshotRows(data));
					group.ready = true;
					void this.processDeltaQueue(group);
				}
				await subscriber.onFrame(
					encodeSseEvent("snapshot", {
						topicId: subscriber.topicId,
						seq: bootstrapSeq,
						data,
						reset: false,
					}),
					"snapshot",
				);
				while (!subscriber.rebootstrap && subscriber.pending.length > 0) {
					const { frame, delivery } = subscriber.pending.shift()!;
					subscriber.pendingBytes -= frame.byteLength;
					await subscriber.onFrame(frame, delivery);
				}
			} while (subscriber.rebootstrap && !group.disposed);
			subscriber.ready = true;
		} catch (error) {
			subscriber.onError(error);
		}
	}

	private onDeltaChange(group: DeltaGroup, event: RealtimeChangeEvent): void {
		if (group.disposed) return;
		group.latestSeq = Math.max(group.latestSeq, event.seq);
		const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
		if (
			group.queue.length + 1 > group.maxQueueEvents ||
			group.queueBytes + bytes > group.maxQueueBytes
		) {
			group.queue = [];
			group.queueBytes = 0;
			group.resetQueued = true;
		} else {
			group.queue.push(event);
			group.queueBytes += bytes;
		}
		if (group.ready) void this.processDeltaQueue(group);
	}

	private async processDeltaQueue(group: DeltaGroup): Promise<void> {
		if (group.processing || group.disposed || !group.ready) return;
		group.processing = true;
		try {
			while (!group.disposed && (group.resetQueued || group.queue.length > 0)) {
				if (group.resetQueued) {
					group.resetQueued = false;
					group.queue = [];
					group.queueBytes = 0;
					await this.resetDeltaGroup(group);
					continue;
				}

				const events = group.queue.splice(0);
				group.queueBytes = 0;
				if (
					events.some(
						(event) =>
							event.resourceType !== group.topics.resourceType ||
							event.resource !== group.topics.resource ||
							eventRecordIds(event) === null,
					)
				) {
					group.resetQueued = true;
					continue;
				}

				const ids = [
					...new Set(events.flatMap((event) => eventRecordIds(event)!)),
				];
				const hydrated = snapshotRows(await group.hydrateRows(ids));
				const rowsById = new Map<string, unknown>();
				for (const row of hydrated) {
					const key = rowKey(row);
					if (key !== null) rowsById.set(key, row);
				}

				for (const event of events) {
					for (const key of eventRecordIds(event)!) {
						const row = rowsById.get(key);
						const previousHash = group.rowHashes.get(key);
						const operation = deriveDeltaOp({
							present: row !== undefined,
							operation: event.operation,
							beforeMatch: previousHash !== undefined,
						});
						if (row !== undefined) {
							const hash = await sha256(JSON.stringify(row));
							group.rowHashes.set(key, hash);
							if (operation !== "noop" && hash !== previousHash) {
								this.deliverDeltaEvent(
									group,
									operation,
									{
										type: operation,
										seq: event.seq,
										...(event.txid ? { txid: event.txid } : {}),
										key,
										row,
									},
									"delta",
								);
							}
						} else if (operation === "delete") {
							group.rowHashes.delete(key);
							this.deliverDeltaEvent(
								group,
								"delete",
								{
									type: "delete",
									seq: event.seq,
									...(event.txid ? { txid: event.txid } : {}),
									key,
								},
								"delta",
							);
						}
					}
					group.lastDeliveredSeq = Math.max(group.lastDeliveredSeq, event.seq);
					this.deliverDeltaEvent(
						group,
						"up-to-date",
						{
							type: "up-to-date",
							seq: event.seq,
							...(event.txid ? { txid: event.txid } : {}),
							meta: { totalDocs: group.rowHashes.size },
						},
						"delta",
					);
				}
			}
		} catch (error) {
			this.reportDeltaError(group, error);
		} finally {
			group.processing = false;
			if (group.resetQueued || group.queue.length > 0) {
				void this.processDeltaQueue(group);
			}
		}
	}

	private async resetDeltaGroup(group: DeltaGroup): Promise<void> {
		const seq = await this.realtime.getLatestSeq();
		const data = await this.runBounded(group.compute);
		await this.replaceDeltaHashes(group, snapshotRows(data));
		group.latestSeq = Math.max(group.latestSeq, seq);
		group.lastDeliveredSeq = Math.max(group.lastDeliveredSeq, seq);
		this.deliverDeltaEvent(
			group,
			"snapshot",
			{
				seq,
				data,
				reset: true,
			},
			"snapshot",
		);
	}

	private async replaceDeltaHashes(
		group: DeltaGroup,
		rows: unknown[],
	): Promise<void> {
		group.rowHashes.clear();
		for (const row of rows) {
			const key = rowKey(row);
			if (key !== null)
				group.rowHashes.set(key, await sha256(JSON.stringify(row)));
		}
	}

	private deliverDeltaEvent(
		group: DeltaGroup,
		event: string,
		data: Record<string, unknown>,
		delivery: RealtimeDeliveryMode,
	): void {
		for (const subscriber of group.subscribers) {
			const frame = encodeSseEvent(event, {
				...data,
				topicId: subscriber.topicId,
			});
			if (subscriber.ready) {
				void Promise.resolve(subscriber.onFrame(frame, delivery)).catch(
					subscriber.onError,
				);
				continue;
			}
			if (
				subscriber.pending.length + 1 > group.maxQueueEvents ||
				subscriber.pendingBytes + frame.byteLength > group.maxQueueBytes
			) {
				subscriber.pending = [];
				subscriber.pendingBytes = 0;
				subscriber.rebootstrap = true;
				continue;
			}
			subscriber.pending.push({ frame, delivery });
			subscriber.pendingBytes += frame.byteLength;
		}
	}

	private reportDeltaError(group: DeltaGroup, error: unknown): void {
		for (const subscriber of group.subscribers) subscriber.onError(error);
	}

	private reportDeltaTransportError(group: DeltaGroup, error: unknown): void {
		for (const subscriber of group.subscribers) {
			(subscriber.onTransportError ?? subscriber.onError)(error);
		}
	}

	private async initialize(group: SchedulerGroup): Promise<void> {
		try {
			let resume: { latestSeq: number; reset: boolean };
			if (group.sinceSeq !== undefined && this.realtime.getResumeState) {
				resume = await this.realtime.getResumeState(group.sinceSeq);
			} else {
				resume = {
					latestSeq: await this.realtime.getLatestSeq(),
					reset: false,
				};
			}
			const { latestSeq } = resume;
			if (
				group.sinceSeq !== undefined &&
				latestSeq === group.sinceSeq &&
				!resume.reset
			) {
				group.lastSeq = latestSeq;
				this.observe({ type: "resume", outcome: "current" });
				return;
			}
			group.nextReset = resume.reset;
			if (group.sinceSeq !== undefined) {
				this.observe({
					type: "resume",
					outcome: resume.reset ? "reset" : "replay",
				});
			}
			this.requestRefresh(group, latestSeq);
		} catch (error) {
			this.reportError(group, error);
		}
	}

	private requestRefresh(group: SchedulerGroup, seq: number): void {
		if (group.disposed) return;
		group.lastSeq = Math.max(group.lastSeq, seq);
		if (group.refreshInFlight) {
			group.refreshQueued = true;
			return;
		}
		group.refreshInFlight = true;
		void this.refresh(group);
	}

	private async refresh(group: SchedulerGroup): Promise<void> {
		const operation = realtimeOperation(group.topics.operation);
		try {
			do {
				group.refreshQueued = false;
				const startedAt = performance.now();
				this.observe({
					type: "refresh.started",
					operation,
					subscribers: group.subscribers.size,
				});
				const data = await this.runBounded(group.compute);
				if (group.disposed) return;
				const serialized = JSON.stringify(data);
				const hash = await sha256(serialized);
				if (hash === group.lastHash) {
					this.observe({
						type: "refresh.suppressed",
						operation,
						subscribers: group.subscribers.size,
					});
					continue;
				}

				group.lastHash = hash;
				group.lastFrame = encodeSseEvent("snapshot", {
					topicId: group.topicId,
					seq: group.lastSeq,
					data,
					reset: group.nextReset,
				});
				group.nextReset = false;
				const frame = group.lastFrame;
				this.observe({
					type: "refresh.completed",
					operation,
					subscribers: group.subscribers.size,
					durationMs: performance.now() - startedAt,
					frameBytes: frame.byteLength,
				});
				for (const subscriber of group.subscribers) {
					void Promise.resolve(subscriber.onFrame(frame)).catch(
						subscriber.onError,
					);
				}
			} while (group.refreshQueued && !group.disposed);
		} catch (error) {
			this.observe({
				type: "refresh.failed",
				operation,
				subscribers: group.subscribers.size,
			});
			this.reportError(group, error);
		} finally {
			group.refreshInFlight = false;
		}
	}

	private reportError(group: SchedulerGroup, error: unknown): void {
		for (const subscriber of group.subscribers) subscriber.onError(error);
	}

	private reportTransportError(group: SchedulerGroup, error: unknown): void {
		for (const subscriber of group.subscribers) {
			(subscriber.onTransportError ?? subscriber.onError)(error);
		}
	}

	private async runBounded<T>(compute: () => Promise<T>): Promise<T> {
		if (this.activeComputations >= this.maxConcurrency) {
			await new Promise<void>((resolve) =>
				this.pendingComputations.push(resolve),
			);
		}
		this.activeComputations += 1;
		try {
			return await compute();
		} finally {
			this.activeComputations -= 1;
			this.pendingComputations.shift()?.();
		}
	}
}

const schedulers = new WeakMap<object, RealtimeRefreshScheduler>();

export function getRealtimeRefreshScheduler(
	owner: object,
	realtime: RealtimeSource,
): RealtimeRefreshScheduler {
	let scheduler = schedulers.get(owner);
	if (!scheduler) {
		scheduler = new RealtimeRefreshScheduler(
			realtime,
			10,
			realtime.record
				? { record: (event) => realtime.record?.(event) }
				: undefined,
		);
		schedulers.set(owner, scheduler);
	}
	return scheduler;
}
