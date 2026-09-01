export type SelectionNode =
	| Readonly<{ kind: "field"; field: string }>
	| Readonly<{
			kind: "toOne";
			relation: string;
			collection: string;
			policy: PolicyObservation;
			select: readonly SelectionNode[];
	  }>
	| Readonly<{
			kind: "toManyList";
			relation: string;
			collection: string;
			policy: PolicyObservation;
			select: readonly SelectionNode[];
	  }>;

export type PolicyObservation = Readonly<{
	identity: string;
	evidenceCollections: readonly string[];
	tenant: boolean;
}>;

export type DependencyShape = Readonly<{
	collections: readonly string[];
	relations: readonly string[];
	policies: readonly string[];
	tokens: readonly string[];
}>;

export type ChangeFact = Readonly<{
	collection: string;
	relation?: string;
	policy?: string;
	kind: "insert" | "update" | "delete" | "correlationMove" | "policyEvidence";
}>;

function sorted(values: ReadonlySet<string>): readonly string[] {
	return [...values].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}

export function collectSelectionDependencies(
	rootCollection: string,
	rootPolicy: PolicyObservation,
	selection: readonly SelectionNode[],
): DependencyShape {
	const collections = new Set([rootCollection]);
	const relations = new Set<string>();
	const policies = new Set<string>();
	const tokens = new Set([
		"collectionRange",
		"orderingBoundary",
		"pageSentinel",
	]);

	const observePolicy = (policy: PolicyObservation) => {
		policies.add(policy.identity);
		for (const collection of policy.evidenceCollections)
			collections.add(collection);
		if (policy.evidenceCollections.length > 0)
			tokens.add("policyEvidencePoint");
		if (policy.tenant) tokens.add("tenantPartition");
	};
	const visit = (nodes: readonly SelectionNode[]) => {
		for (const node of nodes) {
			if (node.kind === "field") continue;
			relations.add(node.relation);
			collections.add(node.collection);
			tokens.add("relationEndpoint");
			tokens.add("relationMiss");
			observePolicy(node.policy);
			if (node.kind === "toManyList") {
				tokens.add("childOrderingBoundary");
				tokens.add("childListBoundary");
			}
			visit(node.select);
		}
	};

	observePolicy(rootPolicy);
	visit(selection);
	return Object.freeze({
		collections: Object.freeze(sorted(collections)),
		relations: Object.freeze(sorted(relations)),
		policies: Object.freeze(sorted(policies)),
		tokens: Object.freeze(sorted(tokens)),
	});
}

export function changeReachesDependency(
	plan: DependencyShape,
	fact: ChangeFact,
): boolean {
	return (
		plan.collections.includes(fact.collection) ||
		(fact.relation !== undefined && plan.relations.includes(fact.relation)) ||
		(fact.policy !== undefined && plan.policies.includes(fact.policy))
	);
}

export class ObservedResult<Result> {
	#plan: DependencyShape;
	#result: Result;

	constructor(plan: DependencyShape, result: Result) {
		this.#plan = plan;
		this.#result = result;
	}

	read(): Readonly<{ plan: DependencyShape; result: Result }> {
		return Object.freeze({ plan: this.#plan, result: this.#result });
	}

	recompute(next: () => Readonly<{ plan: DependencyShape; result: Result }>) {
		const completed = next();
		this.#plan = completed.plan;
		this.#result = completed.result;
	}
}
