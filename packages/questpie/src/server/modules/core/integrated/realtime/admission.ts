import type {
	RealtimeTopicRejectedPayload,
	RealtimeTopicRejectionReason,
} from "#questpie/shared/realtime-error.js";

export type RealtimeAdmissionConfig = {
	maxTopicsPerConnection: number;
	maxConnectionsPerPrincipal: number;
	/**
	 * Node-wide ceiling on connections that carry no principal at all. This is
	 * one shared bucket, not a per-client one: an unauthenticated caller
	 * supplies nothing the server can trust to tell it apart from the next
	 * caller, so any per-client key would be a cap that never binds.
	 */
	maxAnonymousConnections: number;
	maxFindLimit: number;
	maxWithDepth: number;
	initialSnapshotConcurrency: number;
	maxBufferedSnapshotBytes: number;
	maxDeltaFindLimit: number;
	estimatedDeltaRowBytes: number;
	maxBufferedDeltaEvents: number;
	maxBufferedDeltaBytes: number;
	deltaHydrationConcurrency: number;
	deltaRebootstrapIntervalMs: number;
};

export const DEFAULT_REALTIME_ADMISSION: RealtimeAdmissionConfig = {
	maxTopicsPerConnection: 20,
	maxConnectionsPerPrincipal: 5,
	// At the default 8s keepalive every admitted connection sustains roughly two
	// scheduler queries per interval, so 200 anonymous streams is about 50
	// standing queries/second — one node's worth of headroom, and 40x the
	// authenticated per-principal cap so a public site only meets it under flood.
	maxAnonymousConnections: 200,
	maxFindLimit: 100,
	maxWithDepth: 3,
	initialSnapshotConcurrency: 4,
	maxBufferedSnapshotBytes: 1024 * 1024,
	maxDeltaFindLimit: 384,
	estimatedDeltaRowBytes: 2048,
	maxBufferedDeltaEvents: 512,
	maxBufferedDeltaBytes: 1024 * 1024,
	deltaHydrationConcurrency: 4,
	deltaRebootstrapIntervalMs: 60_000,
};

export function resolveRealtimeAdmissionConfig(
	config?: Partial<RealtimeAdmissionConfig>,
): RealtimeAdmissionConfig {
	const positiveInteger = (value: unknown, fallback: number) =>
		Number.isFinite(value) && Number.isInteger(value) && (value as number) >= 1
			? (value as number)
			: fallback;
	const nonNegativeInteger = (value: unknown, fallback: number) =>
		Number.isFinite(value) && Number.isInteger(value) && (value as number) >= 0
			? (value as number)
			: fallback;

	const maxBufferedSnapshotBytes = positiveInteger(
		config?.maxBufferedSnapshotBytes,
		DEFAULT_REALTIME_ADMISSION.maxBufferedSnapshotBytes,
	);
	const estimatedDeltaRowBytes = positiveInteger(
		config?.estimatedDeltaRowBytes,
		DEFAULT_REALTIME_ADMISSION.estimatedDeltaRowBytes,
	);
	const maxBufferedDeltaBytes = positiveInteger(
		config?.maxBufferedDeltaBytes,
		DEFAULT_REALTIME_ADMISSION.maxBufferedDeltaBytes,
	);
	const deltaBootstrapCapacity = Math.max(
		1,
		Math.floor(
			Math.min(maxBufferedSnapshotBytes, maxBufferedDeltaBytes) /
				estimatedDeltaRowBytes,
		),
	);

	return {
		maxTopicsPerConnection: positiveInteger(
			config?.maxTopicsPerConnection,
			DEFAULT_REALTIME_ADMISSION.maxTopicsPerConnection,
		),
		maxConnectionsPerPrincipal: positiveInteger(
			config?.maxConnectionsPerPrincipal,
			DEFAULT_REALTIME_ADMISSION.maxConnectionsPerPrincipal,
		),
		maxAnonymousConnections: positiveInteger(
			config?.maxAnonymousConnections,
			DEFAULT_REALTIME_ADMISSION.maxAnonymousConnections,
		),
		maxFindLimit: positiveInteger(
			config?.maxFindLimit,
			DEFAULT_REALTIME_ADMISSION.maxFindLimit,
		),
		maxWithDepth: nonNegativeInteger(
			config?.maxWithDepth,
			DEFAULT_REALTIME_ADMISSION.maxWithDepth,
		),
		initialSnapshotConcurrency: positiveInteger(
			config?.initialSnapshotConcurrency,
			DEFAULT_REALTIME_ADMISSION.initialSnapshotConcurrency,
		),
		maxBufferedSnapshotBytes,
		maxDeltaFindLimit: Math.min(
			positiveInteger(
				config?.maxDeltaFindLimit,
				DEFAULT_REALTIME_ADMISSION.maxDeltaFindLimit,
			),
			deltaBootstrapCapacity,
		),
		estimatedDeltaRowBytes,
		maxBufferedDeltaEvents: positiveInteger(
			config?.maxBufferedDeltaEvents,
			DEFAULT_REALTIME_ADMISSION.maxBufferedDeltaEvents,
		),
		maxBufferedDeltaBytes,
		deltaHydrationConcurrency: positiveInteger(
			config?.deltaHydrationConcurrency,
			DEFAULT_REALTIME_ADMISSION.deltaHydrationConcurrency,
		),
		deltaRebootstrapIntervalMs: positiveInteger(
			config?.deltaRebootstrapIntervalMs,
			DEFAULT_REALTIME_ADMISSION.deltaRebootstrapIntervalMs,
		),
	};
}

type AdmissionTopic = {
	id: string;
	resourceType: "collection" | "global";
	resource: string;
	operation?: "find" | "count" | "get";
	mode?: "snapshot" | "delta";
	limit?: number;
	with?: Record<string, unknown>;
} & Record<string, unknown>;

export type TopicAdmissionResult<TTopic extends AdmissionTopic> =
	| { accepted: true; topic: TTopic & { limit?: number } }
	| {
			accepted: false;
			message: string;
			reason: RealtimeTopicRejectionReason;
			requestedLimit?: number;
			configuredLimit?: number;
			/** What the server counted when it refused. */
			observed?: number;
	  };

export class RealtimeTopicAdmissionError extends Error {
	constructor(readonly payload: RealtimeTopicRejectedPayload) {
		super(payload.message);
		this.name = "RealtimeTopicAdmissionError";
	}
}

export function realtimeTopicRejectedPayload(
	topic: AdmissionTopic,
	rejection: Extract<TopicAdmissionResult<AdmissionTopic>, { accepted: false }>,
): RealtimeTopicRejectedPayload {
	return {
		code: "REALTIME_TOPIC_REJECTED",
		message: rejection.message,
		topicId: topic.id,
		resource: topic.resource,
		operation:
			topic.resourceType === "global" ? "get" : (topic.operation ?? "find"),
		retryable: false,
		details: {
			reason: rejection.reason,
			...(rejection.requestedLimit !== undefined
				? { requestedLimit: rejection.requestedLimit }
				: {}),
			...(rejection.configuredLimit !== undefined
				? { configuredLimit: rejection.configuredLimit }
				: {}),
			...(rejection.observed !== undefined
				? { observed: rejection.observed }
				: {}),
		},
	};
}

function withDepth(withConfig: Record<string, unknown> | undefined): number {
	if (!withConfig) return 0;
	let maximum = 0;
	for (const value of Object.values(withConfig)) {
		if (!value) continue;
		let depth = 1;
		if (typeof value === "object" && !Array.isArray(value)) {
			const nested = (value as { with?: Record<string, unknown> }).with;
			depth += withDepth(nested);
		}
		maximum = Math.max(maximum, depth);
	}
	return maximum;
}

export function admitRealtimeTopic<TTopic extends AdmissionTopic>(
	topic: TTopic,
	config: RealtimeAdmissionConfig,
): TopicAdmissionResult<TTopic> {
	if (topic.with && withDepth(topic.with) > config.maxWithDepth) {
		return {
			accepted: false,
			message: `Topic exceeds maximum relation depth of ${config.maxWithDepth}`,
			reason: "relation_depth",
			configuredLimit: config.maxWithDepth,
		};
	}
	if ((topic.operation ?? "find") !== "find") {
		return { accepted: true, topic: { ...topic } };
	}
	if (topic.mode === "delta" && topic.limit === undefined) {
		return { accepted: true, topic: { ...topic } };
	}

	const limit = topic.limit ?? config.maxFindLimit;
	if (!Number.isInteger(limit) || limit < 1 || limit > config.maxFindLimit) {
		return {
			accepted: false,
			message: `Topic limit must be between 1 and ${config.maxFindLimit}`,
			reason: "query_limit",
			requestedLimit: limit,
			configuredLimit: config.maxFindLimit,
		};
	}

	return { accepted: true, topic: { ...topic, limit } };
}

/** Authoritative server policy for one topic, checked strongest switch first. */
export function admitRealtimeTopicPolicy<TTopic extends AdmissionTopic>(
	topic: TTopic,
	policy: {
		changeCapture?: boolean;
		rowLiveQueries?: boolean;
		collectionRealtime?: boolean;
	},
): TopicAdmissionResult<TTopic> {
	// Capture off means there is no outbox to serve from, so it outranks the
	// read-side switches — refusing here is the only alternative to a
	// subscription that connects and then never emits.
	if (policy.changeCapture === false) {
		return {
			accepted: false,
			message:
				"Realtime change capture is disabled by server policy; collection and global topics cannot be served",
			reason: "change_capture_disabled",
		};
	}
	if (policy.rowLiveQueries === false) {
		return {
			accepted: false,
			message: "Row live queries are disabled by server policy",
			reason: "row_live_queries_disabled",
		};
	}
	if (
		topic.resourceType === "collection" &&
		policy.collectionRealtime === false
	) {
		return {
			accepted: false,
			message: "Direct realtime subscriptions are disabled for this collection",
			reason: "collection_realtime_disabled",
		};
	}
	return { accepted: true, topic: { ...topic } };
}

/** Keepalive default, shared with the route so the slot TTL tracks it. */
export const DEFAULT_REALTIME_KEEP_ALIVE_INTERVAL_MS = 8000;

/**
 * How many keepalive beats a connection may fail to prove itself alive before
 * its slot is reclaimable. The lease is renewed by evidence the peer drained
 * the stream, so this only sets how long a peer that stopped reading — or one
 * whose socket died without the runtime saying so — keeps holding a slot.
 */
export const REALTIME_SLOT_KEEPALIVE_BEATS = 4;

/**
 * Slot lease length. Derived from the keepalive rather than a constant of its
 * own: the keepalive is the only traffic an idle-but-live stream generates, so
 * it is what bounds "the longest legitimate idle stream". A TTL shorter than a
 * few beats would evict live sessions.
 */
export function realtimeSlotTtlMs(keepAliveIntervalMs: number): number {
	const interval =
		Number.isFinite(keepAliveIntervalMs) && keepAliveIntervalMs >= 1
			? keepAliveIntervalMs
			: DEFAULT_REALTIME_KEEP_ALIVE_INTERVAL_MS;
	return interval * REALTIME_SLOT_KEEPALIVE_BEATS;
}

type AdmissionSlot = {
	expiresAt: number;
	released: boolean;
	close?: () => void;
};

export type RealtimeAdmissionLease = {
	/** Hand the slot back. Idempotent, and safe after eviction. */
	release: () => void;
	/** Extend the lease. Callers must only call this on proof of life. */
	renew: (now?: number) => void;
	/** How the registry tears down a stream whose lease lapsed. */
	setClose: (close: () => void) => void;
};

export type RealtimeAdmissionDecision =
	| { admitted: true; lease: RealtimeAdmissionLease; observed: number }
	| { admitted: false; observed: number; configuredLimit: number };

export type RealtimeAdmissionOptions = {
	maximum: number;
	/**
	 * Lease length in ms. `Number.POSITIVE_INFINITY` opts a transport out of TTL
	 * reclamation — only valid when that transport owns another liveness check.
	 */
	ttlMs: number;
	now?: number;
};

/**
 * Per-process connection slots, held as leases rather than a bare count.
 *
 * A slot used to be released only by an explicit teardown, which made every
 * release path a property of the runtime: if nothing propagated the client's
 * disconnect, the count was immortal for the lifetime of the process and the
 * principal was locked out until a restart. A lease expires on wall clock
 * instead, so reclamation needs no cooperation from the runtime — and expiry
 * closes the abandoned stream, so the scheduler groups, topology heartbeat and
 * keepalive registration behind it go with it.
 *
 * Sweeping is lazy: it runs on admission, which is the only moment the count
 * matters and the only moment the process is guaranteed to still be serving.
 * A background timer here would keep the process alive and outlive the app.
 */
export class RealtimeAdmissionRegistry {
	private readonly buckets = new Map<string, Set<AdmissionSlot>>();
	private nextFullSweepAt = Number.NEGATIVE_INFINITY;

	acquire(
		key: string,
		options: RealtimeAdmissionOptions,
	): RealtimeAdmissionDecision {
		const now = options.now ?? Date.now();
		this.sweepAll(now, options.ttlMs);
		const slots = this.sweepBucket(key, now);

		if (slots.size >= options.maximum) {
			return {
				admitted: false,
				observed: slots.size,
				configuredLimit: options.maximum,
			};
		}

		const slot: AdmissionSlot = {
			expiresAt: now + options.ttlMs,
			released: false,
		};
		slots.add(slot);
		return {
			admitted: true,
			observed: slots.size,
			lease: {
				release: () => {
					if (slot.released) return;
					slot.released = true;
					const bucket = this.buckets.get(key);
					if (!bucket) return;
					bucket.delete(slot);
					if (bucket.size === 0) this.buckets.delete(key);
				},
				renew: (renewedAt) => {
					if (slot.released) return;
					slot.expiresAt = (renewedAt ?? Date.now()) + options.ttlMs;
				},
				setClose: (close) => {
					slot.close = close;
				},
			},
		};
	}

	/** Live slots in one bucket. Diagnostics; expired slots are not counted. */
	observed(key: string, now: number = Date.now()): number {
		let live = 0;
		for (const slot of this.buckets.get(key) ?? []) {
			if (slot.expiresAt > now) live += 1;
		}
		return live;
	}

	private sweepBucket(key: string, now: number): Set<AdmissionSlot> {
		let slots = this.buckets.get(key);
		if (!slots) {
			slots = new Set<AdmissionSlot>();
			this.buckets.set(key, slots);
			return slots;
		}
		evictExpired(slots, now);
		return slots;
	}

	private sweepAll(now: number, ttlMs: number): void {
		if (now < this.nextFullSweepAt) return;
		// One pass per lease window is enough to keep abandoned streams from
		// accumulating under principals that never reconnect.
		this.nextFullSweepAt =
			now + (Number.isFinite(ttlMs) ? Math.max(1000, ttlMs) : 60_000);
		for (const [key, slots] of this.buckets) {
			evictExpired(slots, now);
			if (slots.size === 0) this.buckets.delete(key);
		}
	}
}

function evictExpired(slots: Set<AdmissionSlot>, now: number): void {
	const expired: AdmissionSlot[] = [];
	for (const slot of slots) {
		if (slot.expiresAt <= now) expired.push(slot);
	}
	// Vacate first, then tear down: `close()` re-enters `release()`, and the
	// slot must already be gone so that release cannot evict its replacement.
	for (const slot of expired) {
		slots.delete(slot);
		slot.released = true;
	}
	for (const slot of expired) {
		try {
			slot.close?.();
		} catch {
			// One abandoned stream must not stop the sweep.
		}
	}
}

const registries = new WeakMap<object, RealtimeAdmissionRegistry>();

export function getRealtimeAdmissionRegistry(
	owner: object,
): RealtimeAdmissionRegistry {
	let registry = registries.get(owner);
	if (!registry) {
		registry = new RealtimeAdmissionRegistry();
		registries.set(owner, registry);
	}
	return registry;
}

export function realtimePrincipalKey(context: {
	principal?: {
		kind: string;
		user?: { id?: unknown };
		tokenId?: unknown;
	} | null;
	session?: { user?: { id?: unknown }; session?: { id?: unknown } } | null;
}): string | null {
	const userId = context.principal?.user?.id ?? context.session?.user?.id;
	if (typeof userId === "string" && userId) return `user:${userId}`;
	const tokenId = context.principal?.tokenId;
	if (typeof tokenId === "string" && tokenId) return `oauth:${tokenId}`;
	const sessionId = context.session?.session?.id;
	return typeof sessionId === "string" && sessionId
		? `session:${sessionId}`
		: null;
}

/**
 * The bucket every unauthenticated connection shares.
 *
 * Deliberately *not* per connection. The obvious alternative — key on the
 * server-issued edge session id, the way anonymous channel readers do — gives
 * every connection its own bucket, which is a cap that can never bind: it is
 * how these connections came to be unlimited in the first place. The other
 * alternative, keying on the remote address, means trusting a forwarded-for
 * header the framework does not own and a proxy can collapse or a client can
 * forge. One shared bucket is the honest shape for what this registry actually
 * is: a per-node resource guard. It bounds the node; it does not pretend to be
 * a per-visitor quota.
 */
export const ANONYMOUS_ADMISSION_KEY = "anonymous";

/**
 * Pick the admission bucket and the cap that applies to it. One site, so an
 * unauthenticated connection can never end up with no cap at all.
 */
export function realtimeAdmissionBucket(
	context: Parameters<typeof realtimePrincipalKey>[0],
	config: Pick<
		RealtimeAdmissionConfig,
		"maxConnectionsPerPrincipal" | "maxAnonymousConnections"
	>,
): { key: string; maximum: number; anonymous: boolean } {
	const principalKey = realtimePrincipalKey(context);
	return principalKey === null
		? {
				key: ANONYMOUS_ADMISSION_KEY,
				maximum: config.maxAnonymousConnections,
				anonymous: true,
			}
		: {
				key: principalKey,
				maximum: config.maxConnectionsPerPrincipal,
				anonymous: false,
			};
}

export function createConcurrencyLimiter(maximum: number) {
	const limit =
		Number.isFinite(maximum) && maximum >= 1 ? Math.floor(maximum) : 1;
	let active = 0;
	const pending: Array<() => void> = [];
	return async <T>(operation: () => Promise<T>): Promise<T> => {
		if (active >= limit) {
			await new Promise<void>((resolve) => pending.push(resolve));
		}
		active += 1;
		try {
			return await operation();
		} finally {
			active -= 1;
			pending.shift()?.();
		}
	};
}
