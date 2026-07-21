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

const DELTA_SHAPE_RULES: ReadonlyArray<
	(topic: DeliveryTopic, relationNames: ReadonlySet<string>) => boolean
> = [
	(topic) => topic.mode === "delta",
	(topic) => topic.resourceType === "collection",
	(topic) => (topic.operation ?? "find") === "find",
	(topic) => topic.limit === undefined,
	(topic) => topic.offset === undefined,
	(topic) => topic.orderBy === undefined,
	(topic) => topic.with === undefined,
	(topic) => topic.columns?.id !== false,
	(topic) => !visitRealtimeWhereFields(topic.where, () => {}).hasRaw,
	(topic, relationNames) =>
		!whereReferencesRelations(topic.where, relationNames),
];

/** Resolve the requested topic mode through the frozen shape-subset predicate. */
export function classifyRealtimeDelivery(
	topic: DeliveryTopic,
	relationNames: ReadonlySet<string> = new Set(),
): RealtimeDeliveryMode {
	return DELTA_SHAPE_RULES.every((rule) => rule(topic, relationNames))
		? "delta"
		: "snapshot";
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
