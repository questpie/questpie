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

/** Authoritative server policy, separate from durable change capture. */
export function admitRealtimeTopicPolicy<TTopic extends AdmissionTopic>(
	topic: TTopic,
	policy: {
		rowLiveQueries?: boolean;
		collectionRealtime?: boolean;
	},
): TopicAdmissionResult<TTopic> {
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

export class RealtimeAdmissionRegistry {
	private readonly counts = new Map<string, number>();

	constructor(private readonly maximum: number) {}

	acquire(principalKey: string | null): (() => void) | null {
		if (principalKey === null) return () => {};
		const count = this.counts.get(principalKey) ?? 0;
		if (count >= this.maximum) return null;
		this.counts.set(principalKey, count + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = (this.counts.get(principalKey) ?? 1) - 1;
			if (next === 0) this.counts.delete(principalKey);
			else this.counts.set(principalKey, next);
		};
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
