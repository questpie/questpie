import type {
	RealtimeTopicRejectedPayload,
	RealtimeTopicRejectionReason,
} from "#questpie/shared/realtime-error.js";

export type RealtimeAdmissionConfig = {
	maxTopicsPerConnection: number;
	maxConnectionsPerPrincipal: number;
	maxFindLimit: number;
	maxWithDepth: number;
	initialSnapshotConcurrency: number;
	maxBufferedSnapshotBytes: number;
};

export const DEFAULT_REALTIME_ADMISSION: RealtimeAdmissionConfig = {
	maxTopicsPerConnection: 20,
	maxConnectionsPerPrincipal: 5,
	maxFindLimit: 100,
	maxWithDepth: 3,
	initialSnapshotConcurrency: 4,
	maxBufferedSnapshotBytes: 1024 * 1024,
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

	return {
		maxTopicsPerConnection: positiveInteger(
			config?.maxTopicsPerConnection,
			DEFAULT_REALTIME_ADMISSION.maxTopicsPerConnection,
		),
		maxConnectionsPerPrincipal: positiveInteger(
			config?.maxConnectionsPerPrincipal,
			DEFAULT_REALTIME_ADMISSION.maxConnectionsPerPrincipal,
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
		maxBufferedSnapshotBytes: positiveInteger(
			config?.maxBufferedSnapshotBytes,
			DEFAULT_REALTIME_ADMISSION.maxBufferedSnapshotBytes,
		),
	};
}

type AdmissionTopic = {
	id: string;
	resourceType: "collection" | "global";
	resource: string;
	operation?: "find" | "count" | "get";
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

type AdmissionSlot = {
	released: boolean;
	superseded: boolean;
	close?: () => void;
};

export type RealtimeAdmissionRelease = (() => void) & {
	setClose: (close: () => void) => void;
};

function noopAdmissionRelease(): RealtimeAdmissionRelease {
	const release = (() => {}) as RealtimeAdmissionRelease;
	release.setClose = () => {};
	return release;
}

export class RealtimeAdmissionRegistry {
	// principalKey -> (slotKey -> slot). One live connection per slot. A slot keyed
	// by the client's connectionId is REPLACED when that same connection reconnects
	// (ping watchdog, hot-reload, refresh), so a reconnecting tab reoccupies its
	// single slot instead of leaking a fresh one on every reconnect and eventually
	// exhausting the per-principal cap while old, already-dead streams still hold it.
	private readonly principals = new Map<string, Map<string, AdmissionSlot>>();
	// Connections that supply no id each occupy their own slot (the pre-reclaim
	// behavior); a monotonic counter keeps those keys distinct.
	private anonymousSeq = 0;

	constructor(private readonly maximum: number) {}

	acquire(
		principalKey: string | null,
		connectionId?: string | null,
	): RealtimeAdmissionRelease | null {
		if (principalKey === null) return noopAdmissionRelease();
		let slots = this.principals.get(principalKey);
		if (!slots) {
			slots = new Map<string, AdmissionSlot>();
			this.principals.set(principalKey, slots);
		}

		const validConnectionId =
			typeof connectionId === "string" &&
			/^[A-Za-z0-9_-]{1,128}$/.test(connectionId);
		const slotKey = validConnectionId
			? `id:${connectionId}`
			: `anon:${(this.anonymousSeq += 1)}`;

		// Fence and actively close the prior stream before its slot is reused.
		// Replacing only the counter would allow arbitrarily many live streams to
		// share one client-controlled id while counting as one.
		const prior = slots.get(slotKey);
		if (prior) {
			prior.superseded = true;
			prior.released = true;
			slots.delete(slotKey);
			prior.close?.();
		}

		if (slots.size >= this.maximum) return null;

		const slot: AdmissionSlot = { released: false, superseded: false };
		slots.set(slotKey, slot);
		const release = (() => {
			if (slot.released) return;
			slot.released = true;
			// Only vacate the cell if THIS slot still occupies it: a reconnect may
			// have already replaced it, and this release must not evict the new slot.
			const current = this.principals.get(principalKey);
			if (current?.get(slotKey) === slot) {
				current.delete(slotKey);
					if (current.size === 0) this.principals.delete(principalKey);
				}
		}) as RealtimeAdmissionRelease;
		release.setClose = (close) => {
			slot.close = close;
			if (slot.superseded) close();
		};
		return release;
	}
}

const registries = new WeakMap<object, RealtimeAdmissionRegistry>();

export function getRealtimeAdmissionRegistry(
	owner: object,
	maximum: number,
): RealtimeAdmissionRegistry {
	let registry = registries.get(owner);
	if (!registry) {
		registry = new RealtimeAdmissionRegistry(maximum);
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
