import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { CollectionOperationProgramsV1 } from "../mutation";
import type { EvaluatedExport, NormalizedResource } from "../types";
import type {
	CollectionLifecycleProgramsV1,
	LifecycleIdentity,
	LifecyclePhase,
	LifecycleStatement,
} from "./contract";

type ReachableIssue = Readonly<{
	issue: LifecycleIdentity;
	phase: LifecyclePhase;
	origin: Readonly<{ module: string; line: number; column: number }>;
}>;

export type IssueReachabilityNode = Readonly<{
	identity: string;
	issues: readonly ReachableIssue[];
	calls: readonly string[];
}>;

export function traceIssueReachability(
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

export function issueBearingCollectionIdentities(
	programs: CollectionLifecycleProgramsV1,
	operations?: CollectionOperationProgramsV1,
): readonly string[] {
	if (operations)
		return Object.keys(
			issueBearingCollectionRequirements(programs, operations),
		);
	return programs.programs
		.filter((program) =>
			Object.values(program.phases).some(
				(statements) => issuesInStatements(statements).length > 0,
			),
		)
		.map((program) => program.bindings.collection)
		.sort(compareAscii);
}

export function issueBearingCollectionRequirements(
	programs: CollectionLifecycleProgramsV1,
	operations: CollectionOperationProgramsV1,
): Readonly<Record<string, readonly string[]>> {
	const lifecycleByCollection = new Map<
		string,
		CollectionLifecycleProgramsV1["programs"][number]
	>(programs.programs.map((program) => [program.bindings.collection, program]));
	const operationByIdentity = new Map<
		string,
		CollectionOperationProgramsV1["operations"][number]
	>(operations.operations.map((operation) => [operation.identity, operation]));
	const visit = (
		collection: string,
		ancestors: ReadonlySet<string>,
	): ReadonlySet<string> => {
		if (ancestors.has(collection)) return new Set();
		const program = lifecycleByCollection.get(collection);
		if (!program) return new Set();
		const owners = new Set<string>();
		if (
			Object.values(program.phases).some(
				(statements) => issuesInStatements(statements).length > 0,
			)
		)
			owners.add(collection);
		const nextAncestors = new Set(ancestors).add(collection);
		for (const capability of Object.values(
			program.bindings.capabilities as Readonly<
				Record<string, Readonly<{ identity?: unknown }>>
			>,
		)) {
			if (typeof capability.identity !== "string") continue;
			const operation = operationByIdentity.get(capability.identity);
			if (!operation) continue;
			for (const owner of visit(operation.target, nextAncestors))
				owners.add(owner);
		}
		return owners;
	};
	return Object.freeze(
		Object.fromEntries(
			programs.programs
				.map(
					(program) =>
						[
							program.bindings.collection,
							[...visit(program.bindings.collection, new Set())].sort(
								compareAscii,
							),
						] as const,
				)
				.filter(([, owners]) => owners.length > 0)
				.sort(([left], [right]) => compareAscii(left, right)),
		),
	);
}

function mappingOrigin(resource: NormalizedResource) {
	const span =
		resource.origin.memberSpans.issueMappings ?? resource.origin.span;
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
	evaluatedExports: readonly EvaluatedExport[],
	operations: CollectionOperationProgramsV1,
): void {
	const collections = new Map(
		resources
			.filter((resource) => resource.kind === "collection")
			.map((resource) => [resource.name, resource]),
	);
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
		const collection = [...collections.values()].find(
			(candidate) => candidate.identity === operation.target,
		);
		if (!identity || !program || !collection) continue;
		const authored = evaluatedExports.find(
			(item) =>
				item.logicalPath === collection.origin.logicalPath &&
				item.exportName === collection.origin.exportName,
		);
		const issues: ReachableIssue[] = [];
		for (const phase of [
			"normalize",
			"validate",
			"check",
			"afterWrite",
		] as const) {
			const span = authored?.lifecycleSources[phase]?.span;
			for (const issue of issuesInStatements(program.phases[phase]))
				issues.push({
					issue,
					phase,
					origin: {
						module: collection.origin.logicalPath,
						line: span?.start.line ?? 1,
						column: span?.start.column ?? 1,
					},
				});
		}
		const capabilities = program.bindings.capabilities as Readonly<
			Record<string, Readonly<{ identity?: unknown }>>
		>;
		const calls = Object.values(capabilities)
			.map((capability) =>
				typeof capability.identity === "string"
					? operationNodeByIdentity.get(capability.identity)
					: undefined,
			)
			.filter((target): target is string => target !== undefined)
			.sort(compareAscii);
		nodes.set(identity, Object.freeze({ identity, issues, calls }));
	}
	for (const mutation of resources.filter(
		(resource) => resource.kind === "mutation",
	)) {
		const authoredMappings = (mutation.contract.issueMappings ??
			{}) as Readonly<Record<string, Readonly<Record<string, string>>>>;
		const declaredErrors = (mutation.contract.declaredErrors ?? {}) as Readonly<
			Record<string, Readonly<{ payload: unknown }>>
		>;
		const rootCalls: string[] = [];
		const authoredMutation = evaluatedExports.find(
			(item) =>
				item.logicalPath === mutation.origin.logicalPath &&
				item.exportName === mutation.origin.exportName,
		);
		for (const call of authoredMutation?.mutationCalls ?? []) {
			const collection = collections.get(call.collection);
			if (!collection) continue;
			const node = `${collection.identity}/${call.member}`;
			if (nodes.has(node)) rootCalls.push(node);
		}
		for (const collectionName of Object.keys(authoredMappings).sort(
			compareAscii,
		)) {
			const collection = collections.get(collectionName);
			const baseDetails = {
				phase: "validate" as const,
				origin: mappingOrigin(mutation),
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
				origin: mappingOrigin(mutation),
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
						const call = authoredMutation?.mutationCalls.find((candidate) => {
							const collection = collections.get(candidate.collection);
							return (
								collection &&
								`${collection.identity}/${candidate.member}` === firstCall
							);
						});
						return call
							? {
									module: authoredMutation!.logicalPath,
									line: call.span.start.line,
									column: call.span.start.column,
								}
							: mappingOrigin(mutation);
					})(),
					issue: reachableIssue.issue,
					rewrite: issueRewrite(collectionName, issueName),
				},
			);
		}
	}
}
