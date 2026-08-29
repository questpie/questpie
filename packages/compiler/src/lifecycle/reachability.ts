import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { CollectionOperationProgramsV1 } from "../mutation";
import type { NormalizedResource } from "../types";
import type {
	CollectionLifecycleProgramsV1,
	LifecycleIdentity,
	LifecyclePhase,
	LifecycleStatement,
} from "./contract";
import type { LifecycleOrigin } from "./lower";

export type CollectionIssueOrigins = ReadonlyMap<
	LifecycleIdentity,
	ReadonlyMap<LifecyclePhase, ReadonlyMap<LifecycleIdentity, LifecycleOrigin>>
>;

type ReachableIssue = Readonly<{
	issue: LifecycleIdentity;
	phase: LifecyclePhase;
	origin: Readonly<{ module: string; line: number; column: number }>;
}>;

type IssueReachabilityNode = Readonly<{
	identity: string;
	issues: readonly ReachableIssue[];
	calls: readonly string[];
}>;

function traceIssueReachability(
	root: string,
	nodes: ReadonlyMap<string, IssueReachabilityNode>,
): ReadonlyMap<
	LifecycleIdentity,
	Readonly<ReachableIssue & { path: readonly string[] }>
> {
	const reachable = new Map<
		LifecycleIdentity,
		Readonly<ReachableIssue & { path: readonly string[] }>
	>();
	const visit = (
		identity: string,
		path: readonly string[],
		ancestors: ReadonlySet<string>,
	) => {
		if (ancestors.has(identity)) return;
		const node = nodes.get(identity);
		if (!node)
			throw new TypeError(`unknown lifecycle reachability node ${identity}`);
		const nextAncestors = new Set(ancestors).add(identity);
		for (const issue of node.issues)
			if (!reachable.has(issue.issue))
				reachable.set(
					issue.issue,
					Object.freeze({ ...issue, path: [...path, identity] }),
				);
		for (const target of node.calls)
			visit(target, [...path, identity], nextAncestors);
	};
	visit(root, [], new Set());
	return reachable;
}

function issuesInStatements(
	statements: readonly LifecycleStatement[],
): readonly LifecycleIdentity[] {
	return statements.flatMap((statement) =>
		statement.op === "throwIssue"
			? [statement.issue]
			: statement.op === "if"
				? [
						...issuesInStatements(statement.consequent),
						...issuesInStatements(statement.otherwise),
					]
				: [],
	);
}

function callsInStatements(
	statements: readonly LifecycleStatement[],
): readonly LifecycleIdentity[] {
	return statements.flatMap((statement) =>
		statement.op === "effect"
			? [statement.value.identity]
			: statement.op === "if"
				? [
						...callsInStatements(statement.consequent),
						...callsInStatements(statement.otherwise),
					]
				: [],
	);
}

function buildIssueReachabilityGraph(
	programs: CollectionLifecycleProgramsV1,
	operations: CollectionOperationProgramsV1,
	originFor: (
		collection: LifecycleIdentity,
		phase: LifecyclePhase,
		issue: LifecycleIdentity,
	) => ReachableIssue["origin"] = (collection) => ({
		module: collection,
		line: 1,
		column: 1,
	}),
): Readonly<{
	nodes: ReadonlyMap<string, IssueReachabilityNode>;
	operationNodeByIdentity: ReadonlyMap<string, string>;
}> {
	const programsByCollection = new Map(
		programs.programs.map((program) => [program.bindings.collection, program]),
	);
	const operationNodeByIdentity = new Map<string, string>();
	for (const operation of operations.operations)
		if (
			(operation.member === "create" || operation.member === "update") &&
			programsByCollection.has(operation.target)
		)
			operationNodeByIdentity.set(
				operation.identity,
				`${operation.target}/${operation.member}`,
			);
	const nodes = new Map<string, IssueReachabilityNode>();
	for (const operation of operations.operations) {
		const identity = operationNodeByIdentity.get(operation.identity);
		const program = programsByCollection.get(operation.target);
		if (!identity || !program) continue;
		const issues = (
			["normalize", "validate", "check", "afterWrite"] as const
		).flatMap((phase) =>
			issuesInStatements(program.phases[phase]).map((issue) => ({
				issue,
				phase,
				origin: originFor(program.bindings.collection, phase, issue),
			})),
		);
		const calls = Object.values(program.phases)
			.flatMap(callsInStatements)
			.map((identity) => operationNodeByIdentity.get(identity))
			.filter((target): target is string => target !== undefined)
			.sort(compareAscii);
		nodes.set(identity, Object.freeze({ identity, issues, calls }));
	}
	return Object.freeze({ nodes, operationNodeByIdentity });
}

export function issueBearingCollectionRequirements(
	programs: CollectionLifecycleProgramsV1,
	operations: CollectionOperationProgramsV1,
): Readonly<Record<string, readonly string[]>> {
	const { nodes } = buildIssueReachabilityGraph(programs, operations);
	return Object.freeze(
		Object.fromEntries(
			programs.programs
				.map((program) => {
					const issues = new Set<string>();
					for (const root of nodes.keys())
						if (root.startsWith(`${program.bindings.collection}/`))
							for (const issue of traceIssueReachability(root, nodes).keys())
								issues.add(issue);
					return [
						program.bindings.collection,
						[...issues].sort(compareAscii),
					] as const;
				})
				.filter(([, issues]) => issues.length > 0)
				.sort(([left], [right]) => compareAscii(left, right)),
		),
	);
}

function mappingOrigin(
	resource: NormalizedResource,
	collection?: string,
	issue?: string,
) {
	const span =
		(collection && issue
			? resource.origin.memberSpans[`issueMapping:${collection}/${issue}`]
			: undefined) ??
		(collection
			? resource.origin.memberSpans[`issueMapping:${collection}`]
			: undefined) ??
		resource.origin.memberSpans.issueMappings ??
		resource.origin.span;
	return span
		? {
				module: resource.origin.logicalPath,
				line: span.start.line,
				column: span.start.column,
			}
		: { module: resource.origin.logicalPath, line: 1, column: 1 };
}

function issueRewrite(collection: string, issue: string): string {
	return `add issueMappings: { ${collection}: { ${issue}: "declaredError" } } with a payloadless error declared by this Mutation`;
}

export function validateIssueMappings(
	resources: readonly NormalizedResource[],
	programs: CollectionLifecycleProgramsV1,
	operations: CollectionOperationProgramsV1,
	issueOrigins: CollectionIssueOrigins,
): void {
	const collections = new Map(
		resources
			.filter((resource) => resource.kind === "collection")
			.map((resource) => [resource.name, resource]),
	);
	const { nodes, operationNodeByIdentity } = buildIssueReachabilityGraph(
		programs,
		operations,
		(collectionIdentity, phase, issue) => {
			const collection = [...collections.values()].find(
				(candidate) => candidate.identity === collectionIdentity,
			);
			return (
				issueOrigins.get(collectionIdentity)?.get(phase)?.get(issue) ?? {
					module: collection?.origin.logicalPath ?? collectionIdentity,
					line: collection?.origin.span?.start.line ?? 1,
					column: collection?.origin.span?.start.column ?? 1,
				}
			);
		},
	);
	for (const mutation of resources.filter(
		(resource) => resource.kind === "mutation",
	)) {
		const authoredMappings = (mutation.contract.issueMappings ??
			{}) as Readonly<Record<string, Readonly<Record<string, string>>>>;
		const declaredErrors = (mutation.contract.declaredErrors ?? {}) as Readonly<
			Record<string, Readonly<{ payload: unknown }>>
		>;
		const rootCalls: string[] = [];
		if (mutation.value.kind === "frameworkGeneratedCollectionOperation") {
			const kernelIdentity = mutation.value.kernelIdentity;
			const generatedTarget =
				typeof kernelIdentity === "string"
					? operationNodeByIdentity.get(kernelIdentity)
					: undefined;
			if (generatedTarget) rootCalls.push(generatedTarget);
		}
		for (const collectionName of Object.keys(authoredMappings).sort(
			compareAscii,
		)) {
			const collection = collections.get(collectionName);
			const baseDetails = {
				phase: "validate" as const,
				origin: mappingOrigin(mutation, collectionName),
				operation: mutation.identity,
				path: [mutation.identity],
			};
			if (!collection)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-027",
					"invalidIssueMapping",
					`${mutation.identity} maps an unknown Collection ${collectionName}`,
					{
						...baseDetails,
						rewrite: `remove ${collectionName} or map a generated Collection capability`,
					},
				);
			for (const node of nodes.keys())
				if (node.startsWith(`${collection.identity}/`)) rootCalls.push(node);
		}
		const root = mutation.identity;
		const graph = new Map(nodes);
		graph.set(
			root,
			Object.freeze({
				identity: root,
				issues: [],
				calls: [...new Set(rootCalls)].sort(compareAscii),
			}),
		);
		const reachable = traceIssueReachability(root, graph);
		for (const [collectionName, mappings] of Object.entries(
			authoredMappings,
		).sort(([left], [right]) => compareAscii(left, right))) {
			const collection = collections.get(collectionName)!;
			const baseDetails = {
				phase: "validate" as const,
				origin: mappingOrigin(mutation, collectionName),
				operation: mutation.identity,
				path: [mutation.identity],
			};
			const identities = (collection.contract.issues ?? {}) as Readonly<
				Record<string, LifecycleIdentity>
			>;
			for (const [issueName, mappedError] of Object.entries(mappings).sort(
				([left], [right]) => compareAscii(left, right),
			)) {
				const issue = identities[issueName];
				const declaration = declaredErrors[mappedError];
				if (!issue || !reachable.has(issue) || declaration?.payload !== null)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-027",
						"invalidIssueMapping",
						`${mutation.identity} has an invalid mapping for ${collectionName}.${issueName}`,
						{
							...baseDetails,
							origin: mappingOrigin(mutation, collectionName, issueName),
							issue: issue ?? `issue:${collectionName}/${issueName}`,
							mappedError,
							rewrite: issueRewrite(collectionName, issueName),
						},
					);
			}
		}
		for (const reachableIssue of [...reachable.values()].sort((left, right) =>
			compareAscii(left.issue, right.issue),
		)) {
			const owner = [...collections.entries()].find(([, collection]) =>
				Object.values(collection.contract.issues ?? {}).includes(
					reachableIssue.issue,
				),
			);
			if (!owner) continue;
			const [collectionName, collection] = owner;
			const identities = (collection.contract.issues ?? {}) as Readonly<
				Record<string, LifecycleIdentity>
			>;
			const issueName = Object.entries(identities).find(
				([, identity]) => identity === reachableIssue.issue,
			)?.[0];
			if (!issueName || authoredMappings[collectionName]?.[issueName]) continue;
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-027",
				"missingIssueMapping",
				`${mutation.identity} is missing a mapping for ${reachableIssue.issue}`,
				{
					phase: reachableIssue.phase,
					origin: reachableIssue.origin,
					mappingOrigin: mappingOrigin(mutation),
					operation: mutation.identity,
					path: reachableIssue.path,
					callOrigin: (() => {
						const firstCall = reachableIssue.path[1];
						const admitted = [...collections.entries()].find(
							([, candidate]) =>
								typeof firstCall === "string" &&
								firstCall.startsWith(`${candidate.identity}/`),
						)?.[0];
						return mappingOrigin(mutation, admitted);
					})(),
					issue: reachableIssue.issue,
					rewrite: issueRewrite(collectionName, issueName),
				},
			);
		}
	}
}
