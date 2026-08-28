import { compareAscii, digest } from "../canonical";
import type { CollectionOperationProgramsV1 } from "../mutation";
import type { EvaluatedExport, NormalizedResource } from "../types";
import {
	LIFECYCLE_INTERPRETER,
	LIFECYCLE_PROGRAM_FORMAT,
	type CollectionLifecycleProgramsV1,
	type LifecycleBindings,
	type LifecycleIdentity,
	type LifecyclePhase,
} from "./contract";
import { lowerLifecyclePhase } from "./lower";

export type {
	CollectionLifecycleProgramsV1,
	CollectionLifecycleProgramV1,
	LifecycleBindings,
	LifecycleExpression,
	LifecyclePhase,
	LifecycleStatement,
} from "./contract";

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
): LifecycleBindings {
	const fields = collection.contract.fields as readonly Readonly<{
		path: readonly string[];
	}>[];
	const issues = (collection.contract.issues ?? {}) as Readonly<
		Record<string, LifecycleIdentity>
	>;
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
		capabilities: Object.freeze({}),
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
	}>,
): CollectionLifecycleProgramsV1 {
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
			);
			const phases = Object.fromEntries(
				(["normalize", "validate", "check", "afterWrite"] as const).map(
					(phase) => {
						const source = authored.lifecycleSources[phase];
						return [
							phase,
							source
								? lowerLifecyclePhase(
										phase,
										source.source,
										authored.logicalPath,
										source.span,
										bindings,
									)
								: [],
						];
					},
				),
			) as Readonly<Record<LifecyclePhase, readonly never[]>>;
			const contract = {
				format: LIFECYCLE_PROGRAM_FORMAT,
				interpreter: LIFECYCLE_INTERPRETER,
				runtimeBuild: input.runtimeBuild,
				reentryLimit: 8,
				bindings,
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
	return Object.freeze({
		format: "questpie.collection-lifecycle-programs",
		version: 1,
		programs: Object.freeze(programs),
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
