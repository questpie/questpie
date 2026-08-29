import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
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
): readonly string[] {
	return programs.programs
		.filter((program) =>
			Object.values(program.phases).some(
				(statements) => issuesInStatements(statements).length > 0,
			),
		)
		.map((program) => program.bindings.collection)
		.sort(compareAscii);
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
): void {
	const collections = new Map(
		resources
			.filter((resource) => resource.kind === "collection")
			.map((resource) => [resource.name, resource]),
	);
	const programsByCollection = new Map(
		programs.programs.map((program) => [program.bindings.collection, program]),
	);
	for (const mutation of resources.filter(
		(resource) => resource.kind === "mutation",
	)) {
		const authoredMappings = (mutation.contract.issueMappings ??
			{}) as Readonly<Record<string, Readonly<Record<string, string>>>>;
		const declaredErrors = (mutation.contract.declaredErrors ?? {}) as Readonly<
			Record<string, Readonly<{ payload: unknown }>>
		>;
		for (const [collectionName, mappings] of Object.entries(
			authoredMappings,
		).sort(([left], [right]) => compareAscii(left, right))) {
			const collection = collections.get(collectionName);
			const root = `collection:${collectionName}/create`;
			const baseDetails = {
				phase: "validate" as const,
				origin: mappingOrigin(mutation),
				operation: mutation.identity,
				path: [mutation.identity, root],
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
			const program = programsByCollection.get(
				collection.identity as LifecycleIdentity,
			);
			const authored = evaluatedExports.find(
				(item) =>
					item.logicalPath === collection.origin.logicalPath &&
					item.exportName === collection.origin.exportName,
			);
			const directIssues: ReachableIssue[] = [];
			if (program)
				for (const phase of [
					"normalize",
					"validate",
					"check",
					"afterWrite",
				] as const) {
					const span = authored?.lifecycleSources[phase]?.span;
					for (const issue of issuesInStatements(program.phases[phase]))
						directIssues.push({
							issue,
							phase,
							origin: {
								module: collection.origin.logicalPath,
								line: span?.start.line ?? 1,
								column: span?.start.column ?? 1,
							},
						});
				}
			const reachable = traceIssueReachability(
				root,
				new Map([
					[
						root,
						Object.freeze({ identity: root, issues: directIssues, calls: [] }),
					],
				]),
			);
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
			const mappedIdentities = new Set(
				Object.keys(mappings).map((name) => identities[name]),
			);
			for (const reachableIssue of [...reachable.values()].sort((left, right) =>
				compareAscii(left.issue, right.issue),
			)) {
				if (mappedIdentities.has(reachableIssue.issue)) continue;
				const issueName = Object.entries(identities).find(
					([, identity]) => identity === reachableIssue.issue,
				)?.[0];
				if (!issueName) continue;
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-027",
					"missingIssueMapping",
					`${mutation.identity} is missing a mapping for ${reachableIssue.issue}`,
					{
						phase: reachableIssue.phase,
						origin: reachableIssue.origin,
						mappingOrigin: mappingOrigin(mutation),
						operation: mutation.identity,
						path: [mutation.identity, ...reachableIssue.path],
						issue: reachableIssue.issue,
						rewrite: issueRewrite(collectionName, issueName),
					},
				);
			}
		}
	}
}
