import { canonicalBytes } from "../canonical";
import type {
	MigrationPlanV1,
	MigrationStepV1,
	SchemaProjectionV1,
} from "./contracts";
import { createMigrationStep } from "./migration-step";
import { childRecords, mapByIdentity, mapIdentityForward } from "./projection";

export interface MigrationStepDependency {
	readonly predecessorStepId: string;
	readonly dependentStepId: string;
}

export function expandReferencedKeyDependencies(
	input: Readonly<{
		base: SchemaProjectionV1;
		target: SchemaProjectionV1;
		renames: MigrationPlanV1["renames"];
		steps: readonly MigrationStepV1[];
	}>,
): Readonly<{
	steps: MigrationStepV1[];
	dependencies: MigrationStepDependency[];
}> {
	const { base, target, renames } = input;
	const steps = [...input.steps];
	const baseCollections = mapByIdentity(base.collections, "base Collection");
	const targetCollections = mapByIdentity(
		target.collections,
		"target Collection",
	);
	const dependencies: MigrationStepDependency[] = [];
	const stepByKindAndIdentity = new Map(
		steps.map((candidate) => [
			`${candidate.kind}\0${candidate.targetIdentity}`,
			candidate,
		]),
	);
	const ensureStep = (candidate: MigrationStepV1): MigrationStepV1 => {
		const key = `${candidate.kind}\0${candidate.targetIdentity}`;
		const existing = stepByKindAndIdentity.get(key);
		if (existing) return existing;
		steps.push(candidate);
		stepByKindAndIdentity.set(key, candidate);
		return candidate;
	};
	const depend = (predecessor: MigrationStepV1, dependent: MigrationStepV1) =>
		dependencies.push({
			predecessorStepId: predecessor.stepId,
			dependentStepId: dependent.stepId,
		});

	for (const droppedConstraint of steps.filter(
		(candidate) => candidate.kind === "dropConstraint",
	)) {
		const referencedCollection = baseCollections.get(
			droppedConstraint.containerIdentity,
		);
		const constraint = referencedCollection
			? childRecords(referencedCollection, "constraints").find(
					(candidate) =>
						candidate.identity === droppedConstraint.targetIdentity,
				)
			: undefined;
		if (
			!constraint ||
			(constraint.kind !== "primaryKey" && constraint.kind !== "unique")
		)
			continue;

		const replacementConstraint = stepByKindAndIdentity.get(
			`addConstraint\0${mapIdentityForward(droppedConstraint.targetIdentity, renames)}`,
		);
		for (const sourceCollection of base.collections) {
			for (const relation of childRecords(sourceCollection, "relations")) {
				if (
					relation.target !== droppedConstraint.containerIdentity ||
					canonicalBytes(relation.references) !==
						canonicalBytes(constraint.fields)
				)
					continue;

				const sourceIdentity = String(sourceCollection.identity);
				const targetSourceIdentity = mapIdentityForward(
					sourceIdentity,
					renames,
				);
				const targetSource = targetCollections.get(targetSourceIdentity);
				if (!targetSource) {
					const dropCollection = stepByKindAndIdentity.get(
						`dropCollection\0${sourceIdentity}`,
					);
					if (dropCollection) depend(dropCollection, droppedConstraint);
					continue;
				}

				const baseRelationIdentity = String(relation.identity);
				const targetRelationIdentity = mapIdentityForward(
					baseRelationIdentity,
					renames,
				);
				const dropRelation = ensureStep(
					createMigrationStep({
						kind: "dropRelation",
						targetIdentity: baseRelationIdentity,
						containerIdentity: sourceIdentity,
						lock: "accessExclusive",
						scansData: true,
						rewritesTable: false,
						reversibleWithoutData: false,
						classification: "destructive",
					}),
				);
				depend(dropRelation, droppedConstraint);

				const targetRelation = childRecords(targetSource, "relations").find(
					(candidate) => candidate.identity === targetRelationIdentity,
				);
				if (!targetRelation) continue;
				const addRelation = ensureStep(
					createMigrationStep({
						kind: "addRelation",
						targetIdentity: targetRelationIdentity,
						containerIdentity: targetSourceIdentity,
						lock: "accessExclusive",
						scansData: true,
						rewritesTable: false,
						reversibleWithoutData: false,
						classification: "destructive",
					}),
				);
				depend(droppedConstraint, addRelation);
				if (replacementConstraint) depend(replacementConstraint, addRelation);
				const referencedTarget = targetCollections.get(
					String(targetRelation.target),
				);
				for (const targetConstraint of referencedTarget
					? childRecords(referencedTarget, "constraints")
					: []) {
					if (
						(targetConstraint.kind === "primaryKey" ||
							targetConstraint.kind === "unique") &&
						canonicalBytes(targetConstraint.fields) ===
							canonicalBytes(targetRelation.references)
					) {
						const addedKey = stepByKindAndIdentity.get(
							`addConstraint\0${String(targetConstraint.identity)}`,
						);
						if (addedKey) depend(addedKey, addRelation);
					}
				}
			}
		}
	}
	for (const addedRelation of steps.filter(
		(candidate) => candidate.kind === "addRelation",
	)) {
		const sourceCollection = targetCollections.get(
			addedRelation.containerIdentity,
		);
		const relation = sourceCollection
			? childRecords(sourceCollection, "relations").find(
					(candidate) => candidate.identity === addedRelation.targetIdentity,
				)
			: undefined;
		if (!relation) continue;
		const referencedTarget = targetCollections.get(String(relation.target));
		for (const targetConstraint of referencedTarget
			? childRecords(referencedTarget, "constraints")
			: []) {
			if (
				(targetConstraint.kind === "primaryKey" ||
					targetConstraint.kind === "unique") &&
				canonicalBytes(targetConstraint.fields) ===
					canonicalBytes(relation.references)
			) {
				const addedKey = stepByKindAndIdentity.get(
					`addConstraint\0${String(targetConstraint.identity)}`,
				);
				if (addedKey) depend(addedKey, addedRelation);
			}
		}
		for (const droppedKey of steps.filter(
			(candidate) => candidate.kind === "dropConstraint",
		)) {
			if (
				mapIdentityForward(droppedKey.containerIdentity, renames) !==
				relation.target
			)
				continue;
			const baseTarget = baseCollections.get(droppedKey.containerIdentity);
			const baseConstraint = baseTarget
				? childRecords(baseTarget, "constraints").find(
						(candidate) => candidate.identity === droppedKey.targetIdentity,
					)
				: undefined;
			if (
				baseConstraint &&
				(baseConstraint.kind === "primaryKey" ||
					baseConstraint.kind === "unique") &&
				canonicalBytes(
					(baseConstraint.fields as readonly unknown[]).map((field) =>
						typeof field === "string"
							? mapIdentityForward(field, renames)
							: field,
					),
				) === canonicalBytes(relation.references)
			)
				depend(droppedKey, addedRelation);
		}
	}
	return { steps, dependencies };
}
