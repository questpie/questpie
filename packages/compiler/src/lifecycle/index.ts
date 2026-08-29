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
import { lowerLifecyclePhase, type LifecycleOrigin } from "./lower";
import {
	issueBearingCollectionRequirements,
	validateIssueMappings,
} from "./reachability";

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

function invokedCapabilities(
	statements: readonly import("./contract").LifecycleStatement[],
): readonly LifecycleIdentity[] {
	return statements.flatMap((statement) =>
		statement.op === "effect"
			? [statement.value.identity]
			: statement.op === "if"
				? [
						...invokedCapabilities(statement.consequent),
						...invokedCapabilities(statement.otherwise),
					]
				: [],
	);
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
): LifecycleBindings {
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
					operation.member === "create" || operation.member === "update",
			)
			.map((operation) => [
				`data.${operation.target.slice("collection:".length)}.${operation.member}`,
				Object.freeze({
					kind: "write",
					identity: operation.identity,
					argumentKeys:
						operation.member === "create"
							? Object.freeze(["input", "values"])
							: Object.freeze(["key", "patch", "values"]),
				}) satisfies LifecycleCapabilityBinding,
			]),
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
			const invoked = new Set(
				Object.values(phases).flatMap(invokedCapabilities),
			);
			const retainedCapabilities = Object.freeze(
				Object.fromEntries(
					Object.entries(bindings.capabilities).filter(([, capability]) =>
						invoked.has(capability.identity),
					),
				),
			);
			const retainedOperations = Object.freeze(
				[...new Set([...bindings.operations, ...invoked])].sort(compareAscii),
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
