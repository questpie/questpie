import { compareAscii, digest } from "../canonical";
import type { CollectionOperationProgramsV1 } from "../mutation";
import type { EvaluatedExport, NormalizedResource } from "../types";
import {
	LIFECYCLE_INTERPRETER,
	LIFECYCLE_PROGRAM_FORMAT,
	type CollectionLifecycleProgramsV1,
	type LifecycleCapabilityBinding,
	type LifecycleBindings,
	type LifecycleIdentity,
	type LifecyclePhase,
} from "./contract";
import {
	lowerLifecyclePhase,
	type LifecycleCapabilityCandidate,
	type LifecycleOrigin,
} from "./lower";
import {
	issueBearingCollectionRequirements,
	validateIssueMappings,
} from "./reachability";
import { analyzeLifecycleStatements } from "./statement-analysis";

export type {
	CollectionLifecycleProgramsV1,
	CollectionLifecycleProgramV1,
	LifecycleBindings,
	LifecycleExpression,
	LifecyclePhase,
	LifecycleStatement,
} from "./contract";

export interface CompiledCollectionLifecycle {
	readonly artifact: CollectionLifecycleProgramsV1;
	readonly issueRequirements: Readonly<Record<string, readonly string[]>>;
}

function operationsFor(
	collection: NormalizedResource,
	resources: readonly NormalizedResource[],
): readonly LifecycleIdentity[] {
	return resources
		.filter((resource) => resource.kind === "mutation")
		.filter((resource) => {
			const mappings = resource.contract.issueMappings as
				| Readonly<Record<string, unknown>>
				| undefined;
			return mappings?.[collection.name] !== undefined;
		})
		.map((resource) => resource.identity as LifecycleIdentity)
		.sort(compareAscii);
}

function bindingsFor(
	applicationName: string,
	collection: NormalizedResource,
	resources: readonly NormalizedResource[],
	operations: CollectionOperationProgramsV1,
): Omit<LifecycleBindings, "capabilities"> &
	Readonly<{
		capabilities: Readonly<Record<string, LifecycleCapabilityCandidate>>;
	}> {
	const fields = collection.contract.fields as readonly Readonly<{
		path: readonly string[];
	}>[];
	const issues = (collection.contract.issues ?? {}) as Readonly<
		Record<string, LifecycleIdentity>
	>;
	const capabilities = Object.fromEntries(
		operations.operations
			.filter(
				(operation) =>
					operation.member === "get" ||
					operation.member === "create" ||
					operation.member === "update",
			)
			.map((operation) => {
				const prefixed = (
					prefix: string,
					paths: readonly (readonly string[])[],
				) => paths.map((path) => `${prefix}.${path.join(".")}`);
				if (operation.member === "get") {
					return [
						`data.${operation.target.slice("collection:".length)}.get`,
						Object.freeze({
							kind: "read",
							identity: operation.identity,
							argumentKeys: Object.freeze(
								[
									...prefixed("key", operation.keyFields),
									...prefixed("select", operation.selectedFieldPaths),
								].sort(compareAscii),
							),
							argumentRoots: Object.freeze(["key", "select"]),
							requiredArgumentKeys: Object.freeze(
								prefixed("key", operation.keyFields).sort(compareAscii),
							),
							requiredArgumentRoots: Object.freeze(["key", "select"]),
							requireNonEmptyWriteLane: false,
							requireNonEmptySelect: true,
							cardinality: "one",
							first: true,
							maxRows: 1,
						}) satisfies LifecycleCapabilityCandidate,
					];
				}
				const argumentKeys = [
					...(operation.member === "update"
						? prefixed("key", operation.keyFields)
						: []),
					...prefixed(
						operation.member === "create" ? "input" : "patch",
						operation.callerInputFields,
					),
					...prefixed("values", operation.trustedValueFields),
				].sort(compareAscii);
				const requiredArgumentKeys = [
					...(operation.member === "update"
						? prefixed("key", operation.keyFields)
						: []),
					...prefixed(
						operation.member === "create" ? "input" : "patch",
						operation.requiredCallerInputFields,
					),
					...prefixed("values", operation.requiredTrustedValueFields),
				].sort(compareAscii);
				const requiredArgumentRoots =
					operation.member === "create" ? ["input"] : ["key"];
				const argumentRoots = [
					operation.member === "create" ? "input" : "key",
					...(operation.member === "update" &&
					operation.callerInputFields.length > 0
						? ["patch"]
						: []),
					...(operation.trustedValueFields.length > 0 ? ["values"] : []),
				].sort(compareAscii);
				return [
					`data.${operation.target.slice("collection:".length)}.${operation.member}`,
					Object.freeze({
						kind: "write",
						identity: operation.identity,
						argumentKeys: Object.freeze(argumentKeys),
						argumentRoots: Object.freeze(argumentRoots),
						requiredArgumentKeys: Object.freeze(requiredArgumentKeys),
						requiredArgumentRoots: Object.freeze(requiredArgumentRoots),
						requireNonEmptyWriteLane: operation.member === "update",
						requireNonEmptySelect: false,
					}) satisfies LifecycleCapabilityCandidate,
				];
			}),
	);
	return Object.freeze({
		schema: `schema:${applicationName}`,
		collection: collection.identity as LifecycleIdentity,
		fields: Object.freeze(
			Object.fromEntries(
				fields.map(({ path }) => [
					path.at(-1)!,
					`${collection.identity}/field:${path.join("/")}` as LifecycleIdentity,
				]),
			),
		),
		issues: Object.freeze({ ...issues }),
		capabilities: Object.freeze(capabilities),
		operations: Object.freeze(operationsFor(collection, resources)),
		jobs: Object.freeze([]),
	});
}

export function projectCollectionLifecyclePrograms(
	input: Readonly<{
		applicationName: string;
		runtimeBuild: string;
		resources: readonly NormalizedResource[];
		evaluatedExports: readonly EvaluatedExport[];
		operations: CollectionOperationProgramsV1;
	}>,
): CompiledCollectionLifecycle {
	const issueOrigins = new Map<
		LifecycleIdentity,
		ReadonlyMap<LifecyclePhase, ReadonlyMap<LifecycleIdentity, LifecycleOrigin>>
	>();
	const programs = input.resources
		.filter((resource) => resource.kind === "collection")
		.flatMap((collection) => {
			const authored = input.evaluatedExports.find(
				(item) =>
					item.logicalPath === collection.origin.logicalPath &&
					item.exportName === collection.origin.exportName,
			);
			if (!authored || Object.keys(authored.lifecycleSources).length === 0)
				return [];
			const bindings = bindingsFor(
				input.applicationName,
				collection,
				input.resources,
				input.operations,
			);
			const originsByPhase = new Map<
				LifecyclePhase,
				ReadonlyMap<LifecycleIdentity, LifecycleOrigin>
			>();
			const phases = Object.fromEntries(
				(["normalize", "validate", "check", "afterWrite"] as const).map(
					(phase) => {
						const source = authored.lifecycleSources[phase];
						const lowered = source
							? lowerLifecyclePhase(
									phase,
									source.source,
									authored.logicalPath,
									source.span,
									bindings,
								)
							: null;
						originsByPhase.set(phase, lowered?.issueOrigins ?? new Map());
						return [phase, lowered?.statements ?? []];
					},
				),
			) as Readonly<Record<LifecyclePhase, readonly never[]>>;
			issueOrigins.set(bindings.collection, originsByPhase);
			const invokedCapabilities = Object.values(phases).flatMap(
				(statements) => analyzeLifecycleStatements(statements).capabilities,
			);
			const invoked = new Map<LifecycleIdentity, readonly string[]>();
			for (const capability of invokedCapabilities)
				invoked.set(capability.identity, capability.argumentKeys);
			const retainedCapabilities = Object.freeze(
				Object.fromEntries(
					Object.entries(bindings.capabilities).flatMap(
						([name, capability]) => {
							const argumentKeys = invoked.get(capability.identity);
							return argumentKeys
								? [
										[
											name,
											capability.kind === "read"
												? (Object.freeze({
														kind: capability.kind,
														identity: capability.identity,
														argumentKeys: Object.freeze(argumentKeys),
														cardinality: capability.cardinality,
														first: capability.first,
														maxRows: capability.maxRows,
													}) satisfies LifecycleCapabilityBinding)
												: (Object.freeze({
														kind: capability.kind,
														identity: capability.identity,
														argumentKeys: Object.freeze(argumentKeys),
													}) satisfies LifecycleCapabilityBinding),
										],
									]
								: [];
						},
					),
				),
			);
			const retainedOperations = Object.freeze(
				[...new Set([...bindings.operations, ...invoked.keys()])].sort(
					compareAscii,
				),
			);
			const retainedBindings = Object.freeze({
				...bindings,
				capabilities: retainedCapabilities,
				operations: retainedOperations,
			});
			const contract = {
				format: LIFECYCLE_PROGRAM_FORMAT,
				interpreter: LIFECYCLE_INTERPRETER,
				runtimeBuild: input.runtimeBuild,
				reentryLimit: 8,
				bindings: retainedBindings,
				phases,
			};
			return [
				Object.freeze({
					...contract,
					digest: digest("questpie.collection-lifecycle-program.v1", contract),
				}),
			];
		})
		.sort((left, right) =>
			compareAscii(left.bindings.collection, right.bindings.collection),
		);
	const projection = Object.freeze({
		format: "questpie.collection-lifecycle-programs",
		version: 1,
		programs: Object.freeze(programs),
	});
	validateIssueMappings(
		input.resources,
		projection,
		input.operations,
		issueOrigins,
	);
	return Object.freeze({
		artifact: projection,
		issueRequirements: issueBearingCollectionRequirements(
			projection,
			input.operations,
		),
	});
}

export function bindCollectionLifecyclePrograms(
	operations: CollectionOperationProgramsV1,
	lifecycle: CollectionLifecycleProgramsV1,
): CollectionOperationProgramsV1 {
	const digests = new Map(
		lifecycle.programs.map((program) => [
			program.bindings.collection,
			program.digest,
		]),
	);
	return Object.freeze({
		...operations,
		operations: Object.freeze(
			operations.operations.map((operation) => {
				const lifecycleProgramDigest = digests.get(operation.target);
				return lifecycleProgramDigest &&
					(operation.member === "create" || operation.member === "update")
					? Object.freeze({ ...operation, lifecycleProgramDigest })
					: operation;
			}),
		),
	});
}
