import type {
	RealtimeChangeEvent,
	RealtimeEqualityProjection,
	RealtimeEqualityValue,
} from "./types.js";

export type RealtimeRoutingOutcome = "match" | "miss" | "unknown";

export type RealtimeRoutingAnchor = Readonly<{
	field: string;
	values: readonly RealtimeEqualityValue[];
}>;

export type RealtimeRoutingFeature =
	| "raw"
	| "relation"
	| "unsupported_operator"
	| "oversized_in"
	| "ambiguous_value";

type ProjectionGuard = (
	projection: RealtimeEqualityProjection | null | undefined,
) => RealtimeRoutingOutcome;

export type RealtimeTopicRoutingPlan = Readonly<{
	anchors: readonly RealtimeRoutingAnchor[];
	features: ReadonlySet<RealtimeRoutingFeature>;
	guard: ProjectionGuard;
}>;

const MAX_ROUTING_IN_VALUES = 128;
const LOGICAL_KEYS = new Set(["AND", "OR", "NOT"]);

function isRoutingScalar(value: unknown): value is RealtimeEqualityValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function and(
	outcomes: readonly RealtimeRoutingOutcome[],
): RealtimeRoutingOutcome {
	if (outcomes.some((outcome) => outcome === "miss")) return "miss";
	return outcomes.every((outcome) => outcome === "match") ? "match" : "unknown";
}

function or(
	outcomes: readonly RealtimeRoutingOutcome[],
): RealtimeRoutingOutcome {
	if (outcomes.some((outcome) => outcome === "match")) return "match";
	return outcomes.every((outcome) => outcome === "miss") ? "miss" : "unknown";
}

function not(outcome: RealtimeRoutingOutcome): RealtimeRoutingOutcome {
	if (outcome === "match") return "miss";
	if (outcome === "miss") return "match";
	return "unknown";
}

function fieldGuard(
	field: string,
	values: readonly RealtimeEqualityValue[],
): ProjectionGuard {
	return (projection) => {
		if (!projection || !(field in projection)) return "unknown";
		const projected = projection[field];
		if (!isRoutingScalar(projected)) return "unknown";
		return values.some((value) => value === projected) ? "match" : "miss";
	};
}

type CompiledNode = {
	guard: ProjectionGuard;
	anchors: RealtimeRoutingAnchor[];
	features: Set<RealtimeRoutingFeature>;
};

function unknownNode(feature: RealtimeRoutingFeature): CompiledNode {
	return {
		guard: () => "unknown",
		anchors: [],
		features: new Set([feature]),
	};
}

function combineNodes(
	nodes: readonly CompiledNode[],
	operator: "AND" | "OR",
): CompiledNode {
	if (nodes.length === 0) return unknownNode("ambiguous_value");
	const features = new Set(nodes.flatMap((node) => [...node.features]));
	return {
		guard: (projection) =>
			(operator === "AND" ? and : or)(
				nodes.map((node) => node.guard(projection)),
			),
		anchors: operator === "AND" ? nodes.flatMap((node) => node.anchors) : [],
		features,
	};
}

function compileField(
	field: string,
	value: unknown,
	relationNames: ReadonlySet<string>,
): CompiledNode {
	if (relationNames.has(field)) return unknownNode("relation");

	let values: readonly RealtimeEqualityValue[];
	if (isRoutingScalar(value)) {
		values = [value];
	} else if (value && typeof value === "object" && !Array.isArray(value)) {
		const operators = Object.keys(value);
		if (operators.length !== 1) return unknownNode("unsupported_operator");
		if (operators[0] === "eq") {
			const equalValue = (value as { eq?: unknown }).eq;
			if (!isRoutingScalar(equalValue)) return unknownNode("ambiguous_value");
			values = [equalValue];
		} else if (operators[0] === "in") {
			const candidates = (value as { in?: unknown }).in;
			if (!Array.isArray(candidates) || candidates.length === 0) {
				return unknownNode("ambiguous_value");
			}
			if (candidates.length > MAX_ROUTING_IN_VALUES) {
				return unknownNode("oversized_in");
			}
			if (!candidates.every(isRoutingScalar)) {
				return unknownNode("ambiguous_value");
			}
			values = candidates;
		} else {
			return unknownNode("unsupported_operator");
		}
	} else {
		return unknownNode("ambiguous_value");
	}

	return {
		guard: fieldGuard(field, values),
		anchors: [{ field, values }],
		features: new Set(),
	};
}

function compileNode(
	where: unknown,
	relationNames: ReadonlySet<string>,
): CompiledNode {
	if (!where || typeof where !== "object" || Array.isArray(where)) {
		return unknownNode("ambiguous_value");
	}

	const nodes: CompiledNode[] = [];
	for (const [key, value] of Object.entries(where)) {
		if (key === "RAW") {
			nodes.push(unknownNode("raw"));
			continue;
		}
		if (!LOGICAL_KEYS.has(key)) {
			nodes.push(compileField(key, value, relationNames));
			continue;
		}

		if (key !== "NOT" && !Array.isArray(value)) {
			nodes.push(unknownNode("ambiguous_value"));
			continue;
		}
		if (
			key === "NOT" &&
			(!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				Object.keys(value).length === 0)
		) {
			nodes.push(unknownNode("ambiguous_value"));
			continue;
		}
		const branches = key === "NOT" ? [value] : (value as unknown[]);
		const compiledBranches = branches.map((branch) =>
			compileNode(branch, relationNames),
		);
		if (key === "NOT") {
			const child = combineNodes(compiledBranches, "AND");
			nodes.push({
				guard: (projection) => not(child.guard(projection)),
				anchors: [],
				features: child.features,
			});
		} else {
			nodes.push(combineNodes(compiledBranches, key === "AND" ? "AND" : "OR"));
		}
	}

	if (nodes.length === 0) {
		return {
			guard: () => "match",
			anchors: [],
			features: new Set(),
		};
	}
	return combineNodes(nodes, "AND");
}

/** Compile a payload-local optimization. It never grants access or row membership. */
export function compileRealtimeTopicRouting(
	where: unknown,
	relationNames: ReadonlySet<string> = new Set(),
): RealtimeTopicRoutingPlan {
	if (where === undefined) {
		return {
			guard: () => "match",
			anchors: [],
			features: new Set(),
		};
	}
	const compiled = compileNode(where, relationNames);
	return {
		guard: compiled.guard,
		anchors: compiled.anchors,
		features: compiled.features,
	};
}

function relevantProjections(
	event: RealtimeChangeEvent,
): Array<RealtimeEqualityProjection | null | undefined> | null {
	if (event.operation === "create") return [event.payload?.after];
	if (event.operation === "delete") return [event.payload?.before];
	if (event.operation === "update") {
		return [event.payload?.before, event.payload?.after];
	}
	return null;
}

/** Skip only when every row state relevant to the change is proven unrelated. */
export function evaluateRealtimeChangeRouting(
	plan: RealtimeTopicRoutingPlan,
	event: RealtimeChangeEvent,
): RealtimeRoutingOutcome {
	const projections = relevantProjections(event);
	if (!projections) return "unknown";
	const outcomes = projections.map(plan.guard);
	if (outcomes.some((outcome) => outcome === "match")) return "match";
	return outcomes.every((outcome) => outcome === "miss") ? "miss" : "unknown";
}

function scalarKey(value: RealtimeEqualityValue): string {
	return `${value === null ? "null" : typeof value}:${String(value)}`;
}

type FieldIndex<T> = {
	all: Set<T>;
	values: Map<string, Set<T>>;
};

/**
 * Index subscriptions by positive required anchors. Missing projections always
 * fall back to all groups registered for that anchor field.
 */
export class RealtimeCandidateRouter<T> {
	private readonly unanchored = new Set<T>();
	private readonly fields = new Map<string, FieldIndex<T>>();
	private readonly plans = new Map<T, RealtimeTopicRoutingPlan>();

	add(value: T, plan: RealtimeTopicRoutingPlan): void {
		this.delete(value);
		this.plans.set(value, plan);
		if (plan.anchors.length === 0) {
			this.unanchored.add(value);
			return;
		}
		for (const anchor of plan.anchors) {
			let index = this.fields.get(anchor.field);
			if (!index) {
				index = { all: new Set(), values: new Map() };
				this.fields.set(anchor.field, index);
			}
			index.all.add(value);
			for (const candidate of anchor.values) {
				const key = scalarKey(candidate);
				let values = index.values.get(key);
				if (!values) {
					values = new Set();
					index.values.set(key, values);
				}
				values.add(value);
			}
		}
	}

	delete(value: T): void {
		const plan = this.plans.get(value);
		if (!plan) return;
		this.plans.delete(value);
		this.unanchored.delete(value);
		for (const anchor of plan.anchors) {
			const index = this.fields.get(anchor.field);
			if (!index) continue;
			index.all.delete(value);
			for (const candidate of anchor.values) {
				const key = scalarKey(candidate);
				const values = index.values.get(key);
				values?.delete(value);
				if (values?.size === 0) index.values.delete(key);
			}
			if (index.all.size === 0) this.fields.delete(anchor.field);
		}
	}

	candidates(event: RealtimeChangeEvent): Set<T> {
		const candidates = new Set(this.unanchored);
		const projections = relevantProjections(event);
		if (!projections) {
			for (const index of this.fields.values()) {
				for (const value of index.all) candidates.add(value);
			}
			return candidates;
		}

		for (const [field, index] of this.fields) {
			if (
				projections.some(
					(projection) =>
						!projection ||
						!(field in projection) ||
						!isRoutingScalar(projection[field]),
				)
			) {
				for (const value of index.all) candidates.add(value);
				continue;
			}
			for (const projection of projections) {
				const matching = index.values.get(scalarKey(projection![field]!));
				if (!matching) continue;
				for (const value of matching) candidates.add(value);
			}
		}
		return candidates;
	}
}
