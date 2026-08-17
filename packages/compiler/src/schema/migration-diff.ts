import { canonicalBytes, compareAscii } from "../canonical";
import type {
	MigrationPlanV1,
	MigrationStepKindV1,
	MigrationStepV1,
	SchemaProjectionV1,
} from "./contracts";
import {
	classifyAddedField,
	classifyChangedField,
	GeneratedInvariantClassifications,
} from "./migration-classification";
import type { MigrationClassification } from "./migration-classification";
import {
	expandReferencedKeyDependencies,
	type MigrationStepDependency,
} from "./migration-dependencies";
import { createMigrationStep as step } from "./migration-step";
import {
	childRecords,
	mapByIdentity,
	mapIdentityBackward,
	mapIdentityForward,
	schemaError,
} from "./projection";

type JsonRecord = Readonly<Record<string, unknown>>;

const kindRank: readonly MigrationStepKindV1[] = [
	"createApplicationSchema",
	"renameCollection",
	"createCollection",
	"renameField",
	"renameConstraint",
	"renameRelationConstraint",
	"renameIndex",
	"addField",
	"alterField",
	"addConstraint",
	"addRelation",
	"addIndex",
	"dropChangeCapture",
	"addChangeCapture",
	"dropIndex",
	"dropRelation",
	"dropConstraint",
	"dropField",
	"dropCollection",
] as const;

function sortSteps(
	steps: MigrationStepV1[],
	renames: MigrationPlanV1["renames"] = [],
	dependencies: readonly MigrationStepDependency[] = [],
): MigrationStepV1[] {
	const replacements: Readonly<Record<string, MigrationStepKindV1>> = {
		addConstraint: "dropConstraint",
		addRelation: "dropRelation",
		addIndex: "dropIndex",
	};
	const compare = (left: MigrationStepV1, right: MigrationStepV1) => {
		const kindOrder =
			kindRank.indexOf(left.kind) - kindRank.indexOf(right.kind);
		return (
			kindOrder ||
			compareAscii(left.targetIdentity, right.targetIdentity) ||
			compareAscii(left.stepId, right.stepId)
		);
	};
	const pending = [...steps];
	const sorted: MigrationStepV1[] = [];
	const explicitPredecessors = new Map<string, Set<string>>();
	for (const dependency of dependencies) {
		const predecessors =
			explicitPredecessors.get(dependency.dependentStepId) ?? new Set<string>();
		predecessors.add(dependency.predecessorStepId);
		explicitPredecessors.set(dependency.dependentStepId, predecessors);
	}
	while (pending.length > 0) {
		const ready = pending
			.filter(
				(candidate) =>
					!pending.some((predecessor) =>
						explicitPredecessors.get(candidate.stepId)?.has(predecessor.stepId),
					) &&
					!pending.some(
						(predecessor) =>
							mapIdentityForward(predecessor.targetIdentity, renames) ===
								candidate.targetIdentity &&
							predecessor.kind === replacements[candidate.kind],
					),
			)
			.sort(compare);
		const next = ready[0];
		if (!next)
			return schemaError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				"migration step dependency cycle",
			);
		sorted.push(next);
		pending.splice(pending.indexOf(next), 1);
	}
	return sorted;
}

export function createSteps(
	target: SchemaProjectionV1,
	includeChangeCapture = true,
): MigrationStepV1[] {
	const steps: MigrationStepV1[] = [
		step({
			kind: "createApplicationSchema",
			targetIdentity: `application:${target.application.name}`,
			containerIdentity: `application:${target.application.name}`,
			lock: "none",
			scansData: false,
			rewritesTable: false,
			reversibleWithoutData: true,
			classification: "safe",
		}),
	];
	for (const collection of target.collections) {
		const identity = String(collection.identity);
		steps.push(
			step({
				kind: "createCollection",
				targetIdentity: identity,
				containerIdentity: `application:${target.application.name}`,
				lock: "accessExclusive",
				scansData: false,
				rewritesTable: false,
				reversibleWithoutData: true,
				classification: "safe",
			}),
		);
		for (const constraint of childRecords(collection, "constraints"))
			steps.push(
				step({
					kind: "addConstraint",
					targetIdentity: String(constraint.identity),
					containerIdentity: identity,
					lock: "shareRowExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "guarded",
				}),
			);
		for (const relation of childRecords(collection, "relations"))
			steps.push(
				step({
					kind: "addRelation",
					targetIdentity: String(relation.identity),
					containerIdentity: identity,
					lock: "shareRowExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "guarded",
				}),
			);
		for (const index of childRecords(collection, "indexes"))
			steps.push(
				step({
					kind: "addIndex",
					targetIdentity: String(index.identity),
					containerIdentity: identity,
					lock: "share",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "safe",
				}),
			);
	}
	if (includeChangeCapture && target.changeCapture)
		steps.push(
			step({
				kind: "addChangeCapture",
				targetIdentity: `application:${target.application.name}/changeCapture`,
				containerIdentity: `application:${target.application.name}`,
				lock: "shareRowExclusive",
				scansData: false,
				rewritesTable: false,
				reversibleWithoutData: true,
				classification: "safe",
			}),
		);
	return sortSteps(steps);
}

function allRenameable(schema: SchemaProjectionV1): Map<string, JsonRecord> {
	const result = mapByIdentity(schema.collections, "Collection");
	for (const collection of schema.collections)
		for (const field of childRecords(collection, "fields"))
			result.set(String(field.identity), field);
	return result;
}

export function validateRenames(
	base: SchemaProjectionV1,
	target: SchemaProjectionV1,
	renames: MigrationPlanV1["renames"],
): void {
	const baseObjects = allRenameable(base);
	const targetObjects = allRenameable(target);
	const from = new Set<string>();
	const to = new Set<string>();
	for (const mapping of renames) {
		const fromField = mapping.from.includes("/field:");
		const toField = mapping.to.includes("/field:");
		if (
			mapping.from === mapping.to ||
			fromField !== toField ||
			from.has(mapping.from) ||
			to.has(mapping.to) ||
			!baseObjects.has(mapping.from) ||
			!targetObjects.has(mapping.to)
		)
			return schemaError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`rename mapping ${mapping.from}=${mapping.to} is not one-to-one over the base and target`,
			);
		const renamedFieldChange = fromField
			? classifyChangedField(
					baseObjects.get(mapping.from) ?? {},
					targetObjects.get(mapping.to) ?? {},
				)
			: null;
		if (renamedFieldChange?.classification === "blocked")
			return schemaError(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`rename mapping ${mapping.from}=${mapping.to} is not type-compatible`,
			);
		from.add(mapping.from);
		to.add(mapping.to);
	}
}

function semanticComparable(
	value: unknown,
	renames: MigrationPlanV1["renames"],
): unknown {
	if (typeof value === "string") return mapIdentityForward(value, renames);
	if (Array.isArray(value))
		return value.map((item) => semanticComparable(item, renames));
	if (!value || typeof value !== "object") return value;
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (
			key === "postgresName" ||
			key === "constraintPostgresName" ||
			key === "path"
		)
			continue;
		result[key] = semanticComparable(item, renames);
	}
	return result;
}

function deltaKind(
	key: "fields" | "constraints" | "relations" | "indexes",
	operation: "add" | "drop" | "rename",
): MigrationStepKindV1 {
	if (key === "fields")
		return operation === "add"
			? "addField"
			: operation === "drop"
				? "dropField"
				: "renameField";
	if (key === "constraints")
		return operation === "add"
			? "addConstraint"
			: operation === "drop"
				? "dropConstraint"
				: "renameConstraint";
	if (key === "relations")
		return operation === "add"
			? "addRelation"
			: operation === "drop"
				? "dropRelation"
				: "renameRelationConstraint";
	return operation === "add"
		? "addIndex"
		: operation === "drop"
			? "dropIndex"
			: "renameIndex";
}

export function destructiveDeltaSteps(
	base: SchemaProjectionV1,
	target: SchemaProjectionV1,
	renames: MigrationPlanV1["renames"],
): MigrationStepV1[] {
	validateRenames(base, target, renames);
	const baseCollections = mapByIdentity(base.collections, "base Collection");
	const targetCollections = mapByIdentity(
		target.collections,
		"target Collection",
	);
	const steps: MigrationStepV1[] = [];
	const baseHasChangeCapture = base.changeCapture !== undefined;
	const targetHasChangeCapture = target.changeCapture !== undefined;
	if (baseHasChangeCapture !== targetHasChangeCapture) {
		if (baseHasChangeCapture)
			steps.push(
				step({
					kind: "dropChangeCapture",
					targetIdentity: `application:${target.application.name}/changeCapture`,
					containerIdentity: `application:${target.application.name}`,
					lock: "shareRowExclusive",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "destructive",
				}),
			);
		if (targetHasChangeCapture)
			steps.push(
				step({
					kind: "addChangeCapture",
					targetIdentity: `application:${target.application.name}/changeCapture`,
					containerIdentity: `application:${target.application.name}`,
					lock: "shareRowExclusive",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "safe",
				}),
			);
	}
	for (const targetCollection of target.collections) {
		const targetIdentity = String(targetCollection.identity);
		const baseIdentity = mapIdentityBackward(targetIdentity, renames);
		const baseCollection = baseCollections.get(baseIdentity);
		if (!baseCollection) {
			steps.push(
				...createSteps(
					{ ...target, collections: [targetCollection] },
					false,
				).slice(1),
			);
			continue;
		}
		if (baseCollection.postgresName !== targetCollection.postgresName)
			steps.push(
				step({
					kind: "renameCollection",
					targetIdentity,
					containerIdentity: `application:${target.application.name}`,
					lock: "accessExclusive",
					scansData: false,
					rewritesTable: false,
					reversibleWithoutData: true,
					classification: "destructive",
				}),
			);
		const generatedInvariants = new GeneratedInvariantClassifications();
		for (const key of [
			"fields",
			"constraints",
			"relations",
			"indexes",
		] as const) {
			const before = mapByIdentity(
				childRecords(baseCollection, key),
				`base ${key}`,
			);
			const matchedBase = new Set<string>();
			for (const targetValue of childRecords(targetCollection, key)) {
				const targetChildIdentity = String(targetValue.identity);
				const baseChildIdentity = mapIdentityBackward(
					targetChildIdentity,
					renames,
				);
				const baseValue = before.get(baseChildIdentity);
				if (!baseValue) {
					const isField = key === "fields";
					const classification: MigrationClassification = isField
						? classifyAddedField(targetValue)
						: generatedInvariants.forConstraint(targetChildIdentity, "guarded");
					steps.push(
						step({
							kind: deltaKind(key, "add"),
							targetIdentity: targetChildIdentity,
							containerIdentity: targetIdentity,
							lock: "accessExclusive",
							scansData: classification !== "safe",
							rewritesTable: false,
							reversibleWithoutData: classification !== "blocked",
							classification,
						}),
					);
					continue;
				}
				matchedBase.add(baseChildIdentity);
				const physicalName =
					key === "relations" ? "constraintPostgresName" : "postgresName";
				const physicalChanged =
					baseValue[physicalName] !== targetValue[physicalName];
				const semanticChanged =
					canonicalBytes(semanticComparable(baseValue, renames)) !==
					canonicalBytes(semanticComparable(targetValue, []));
				if (physicalChanged)
					steps.push(
						step({
							kind: deltaKind(key, "rename"),
							targetIdentity: targetChildIdentity,
							containerIdentity: targetIdentity,
							lock: "accessExclusive",
							scansData: false,
							rewritesTable: false,
							reversibleWithoutData: true,
							classification: "destructive",
						}),
					);
				if (semanticChanged) {
					if (key === "fields") {
						const change = generatedInvariants.classify(baseValue, targetValue);
						if (change?.effect === "alterField")
							steps.push(
								step({
									kind: "alterField",
									targetIdentity: targetChildIdentity,
									containerIdentity: targetIdentity,
									lock: "accessExclusive",
									scansData: true,
									rewritesTable: true,
									reversibleWithoutData: false,
									classification: change.classification,
								}),
							);
					} else {
						const classification = generatedInvariants.forConstraint(
							targetChildIdentity,
							"destructive",
						);
						steps.push(
							step({
								kind: deltaKind(key, "drop"),
								targetIdentity: baseChildIdentity,
								containerIdentity: baseIdentity,
								lock: "accessExclusive",
								scansData: true,
								rewritesTable: false,
								reversibleWithoutData: false,
								classification,
							}),
							step({
								kind: deltaKind(key, "add"),
								targetIdentity: targetChildIdentity,
								containerIdentity: targetIdentity,
								lock: "accessExclusive",
								scansData: true,
								rewritesTable: false,
								reversibleWithoutData: false,
								classification,
							}),
						);
					}
				}
			}
			for (const baseValue of childRecords(baseCollection, key)) {
				const baseChildIdentity = String(baseValue.identity);
				if (!matchedBase.has(baseChildIdentity)) {
					const classification = generatedInvariants.forConstraint(
						baseChildIdentity,
						"destructive",
					);
					steps.push(
						step({
							kind: deltaKind(key, "drop"),
							targetIdentity: baseChildIdentity,
							containerIdentity: baseIdentity,
							lock: "accessExclusive",
							scansData: true,
							rewritesTable: false,
							reversibleWithoutData: false,
							classification,
						}),
					);
				}
			}
		}
	}
	for (const baseCollection of base.collections) {
		const baseIdentity = String(baseCollection.identity);
		if (!targetCollections.has(mapIdentityForward(baseIdentity, renames)))
			steps.push(
				step({
					kind: "dropCollection",
					targetIdentity: baseIdentity,
					containerIdentity: `application:${target.application.name}`,
					lock: "accessExclusive",
					scansData: true,
					rewritesTable: false,
					reversibleWithoutData: false,
					classification: "destructive",
				}),
			);
	}
	const expanded = expandReferencedKeyDependencies({
		base,
		target,
		renames,
		steps,
	});
	return sortSteps(expanded.steps, renames, expanded.dependencies);
}
