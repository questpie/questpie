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
	onFrame: (frame: Uint8Array) => Promise<void> | void;
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
	onFrame: (frame: Uint8Array) => Promise<void> | void;
	onError: RealtimeErrorListener;
	onTransportError?: RealtimeErrorListener;
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

/** App-scoped compute-once/deliver-many scheduler for live-query snapshots. */
export class RealtimeRefreshScheduler {
	private readonly groups = new Map<string, SchedulerGroup>();
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
