export type RealtimeTopicOperation = "find" | "count" | "get";

/**
 * Every reason a topic can be refused. This must stay the same set the server
 * actually produces — a reason the server emits and this union cannot express
 * is a rejection no client can classify, which is how a filled connection cap
 * once went undiagnosed for weeks.
 */
export type RealtimeTopicRejectionReason =
	| "query_limit"
	| "relation_depth"
	| "snapshot_bytes"
	| "row_live_queries_disabled"
	| "collection_realtime_disabled"
	| "connection_limit"
	| "subscription_limit"
	| "access"
	| "not_found"
	| "operation_shape"
	| "since_seq_invalid"
	| "activation_rejected";

const REALTIME_TOPIC_REJECTION_REASONS = new Set<string>([
	"query_limit",
	"relation_depth",
	"snapshot_bytes",
	"row_live_queries_disabled",
	"collection_realtime_disabled",
	"connection_limit",
	"subscription_limit",
	"access",
	"not_found",
	"operation_shape",
	"since_seq_invalid",
	"activation_rejected",
] satisfies RealtimeTopicRejectionReason[]);

export type RealtimeTopicRejectedDetails = {
	reason: RealtimeTopicRejectionReason;
	requestedLimit?: number;
	configuredLimit?: number;
	/**
	 * What the server counted when it refused. With `configuredLimit` these two
	 * numbers are the whole diagnosis for `connection_limit` and
	 * `subscription_limit` — without them the client can only say "refused".
	 */
	observed?: number;
};

/** Public, payload-safe rejection emitted for one realtime topic. */
export type RealtimeTopicRejectedPayload = {
	code: "REALTIME_TOPIC_REJECTED";
	message: string;
	topicId: string;
	resource: string;
	operation: RealtimeTopicOperation;
	retryable: false;
	details: RealtimeTopicRejectedDetails;
};

export function isRealtimeTopicRejectedPayload(
	value: unknown,
): value is RealtimeTopicRejectedPayload {
	if (!value || typeof value !== "object") return false;
	const payload = value as Partial<RealtimeTopicRejectedPayload>;
	return (
		payload.code === "REALTIME_TOPIC_REJECTED" &&
		typeof payload.message === "string" &&
		typeof payload.topicId === "string" &&
		typeof payload.resource === "string" &&
		(payload.operation === "find" ||
			payload.operation === "count" ||
			payload.operation === "get") &&
		payload.retryable === false &&
		Boolean(payload.details) &&
		REALTIME_TOPIC_REJECTION_REASONS.has(payload.details?.reason as string)
	);
}
