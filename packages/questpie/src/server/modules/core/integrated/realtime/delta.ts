import type { RealtimeStreamEvent } from "#questpie/client/realtime/stream.js";

import type { RealtimeOperation } from "./types.js";

export type RealtimeDeliveryMode = "snapshot" | "delta";

export type RealtimeDeltaFrame<TData = unknown> = RealtimeStreamEvent<TData>;

type DeliveryTopic = {
	mode?: RealtimeDeliveryMode;
	resourceType: "collection" | "global";
	operation?: "find" | "count" | "get";
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	columns?: Record<string, boolean>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
};

const LOGICAL_WHERE_KEYS = new Set(["AND", "OR", "NOT"]);

type WhereVisitor = (
	field: string,
	value: unknown,
	context: { underLogical: boolean },
) => void;

/** Visit field references in a where tree without guessing relation shapes. */
export function visitRealtimeWhereFields(
	where: unknown,
	visit: WhereVisitor,
	underLogical = false,
): { hasRaw: boolean; hasLogical: boolean } {
	if (!where || typeof where !== "object" || Array.isArray(where)) {
		return { hasRaw: false, hasLogical: false };
	}

	let hasRaw = false;
	let hasLogical = false;
	for (const [key, value] of Object.entries(where)) {
		if (key === "RAW") {
			hasRaw = true;
			continue;
		}
		if (LOGICAL_WHERE_KEYS.has(key)) {
			hasLogical = true;
			const branches = Array.isArray(value) ? value : [value];
			for (const branch of branches) {
				const nested = visitRealtimeWhereFields(branch, visit, true);
				hasRaw ||= nested.hasRaw;
				hasLogical ||= nested.hasLogical;
			}
			continue;
		}
		visit(key, value, { underLogical });
	}

	return { hasRaw, hasLogical };
}

export function whereReferencesRelations(
	where: unknown,
	relationNames: ReadonlySet<string>,
): boolean {
	let referencesRelation = false;
	visitRealtimeWhereFields(where, (field) => {
		if (relationNames.has(field)) referencesRelation = true;
	});
	return referencesRelation;
}

export type RealtimeDeliveryClassificationReason =
	| "eligible"
	| "requested_snapshot"
	| "resource_type"
	| "operation"
	| "limit"
	| "offset"
	| "order_by"
	| "with"
	| "missing_id"
	| "raw_where"
	| "relation_where"
	| "native_deltas_disabled"
	| "transport_snapshot";

export type RealtimeDeliveryDecision = Readonly<{
	mode: RealtimeDeliveryMode;
	reason: RealtimeDeliveryClassificationReason;
}>;

/** Explain the first frozen shape rule that prevents native row deltas. */
export function classifyRealtimeDeliveryDecision(
	topic: DeliveryTopic,
	relationNames: ReadonlySet<string> = new Set(),
): RealtimeDeliveryDecision {
	if (topic.mode !== "delta") {
		return { mode: "snapshot", reason: "requested_snapshot" };
	}
	if (topic.resourceType !== "collection") {
		return { mode: "snapshot", reason: "resource_type" };
	}
	if ((topic.operation ?? "find") !== "find") {
		return { mode: "snapshot", reason: "operation" };
	}
	if (topic.limit !== undefined) {
		return { mode: "snapshot", reason: "limit" };
	}
	if (topic.offset !== undefined) {
		return { mode: "snapshot", reason: "offset" };
	}
	if (topic.orderBy !== undefined) {
		return { mode: "snapshot", reason: "order_by" };
	}
	if (topic.with !== undefined) {
		return { mode: "snapshot", reason: "with" };
	}
	if (topic.columns?.id === false) {
		return { mode: "snapshot", reason: "missing_id" };
	}
	if (visitRealtimeWhereFields(topic.where, () => {}).hasRaw) {
		return { mode: "snapshot", reason: "raw_where" };
	}
	if (whereReferencesRelations(topic.where, relationNames)) {
		return { mode: "snapshot", reason: "relation_where" };
	}
	return { mode: "delta", reason: "eligible" };
}

/** Resolve the requested topic mode through the frozen shape-subset predicate. */
export function classifyRealtimeDelivery(
	topic: DeliveryTopic,
	relationNames: ReadonlySet<string> = new Set(),
): RealtimeDeliveryMode {
	return classifyRealtimeDeliveryDecision(topic, relationNames).mode;
}

export type RealtimeDeltaOp = "insert" | "update" | "delete" | "noop";

/** Derive a keyed operation after the current row was authoritatively hydrated. */
export function deriveDeltaOp(input: {
	present: boolean;
	operation: RealtimeOperation;
	beforeMatch?: boolean | null;
}): RealtimeDeltaOp {
	if (input.present) {
		if (input.operation === "create" || input.beforeMatch === false) {
			return "insert";
		}
		return "update";
	}

	if (input.operation === "create" || input.beforeMatch === false) {
		return "noop";
	}
	return "delete";
}
