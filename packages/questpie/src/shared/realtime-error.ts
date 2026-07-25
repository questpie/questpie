export type RealtimeTopicOperation = "find" | "count" | "get";

export type RealtimeTopicRejectionReason =
	| "query_limit"
	| "relation_depth"
	| "snapshot_bytes"
	| "row_live_queries_disabled"
	| "collection_realtime_disabled";

export type RealtimeTopicRejectedDetails = {
	reason: RealtimeTopicRejectionReason;
	requestedLimit?: number;
	configuredLimit?: number;
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
		(payload.details?.reason === "query_limit" ||
			payload.details?.reason === "relation_depth" ||
			payload.details?.reason === "snapshot_bytes" ||
			payload.details?.reason === "row_live_queries_disabled" ||
			payload.details?.reason === "collection_realtime_disabled")
	);
}
