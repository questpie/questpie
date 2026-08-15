import { canonicalBytes, compareAscii, digest } from "../canonical";
import type { MigrationPlanV1, SchemaProjectionV1 } from "./contracts";
import {
	classifyProviderDelta,
	maximumClassification,
} from "./migration-classification";
import {
	createSteps,
	destructiveDeltaSteps,
	validateRenames,
} from "./migration-diff";
import type {
	MigrationPlanInput,
	MigrationPlanningResult,
	PlannedMigration,
} from "./migration-planning";
import {
	assertProjection,
	genesis,
	schemaDigest,
	schemaError,
} from "./projection";

export function createMigrationPlan(
	input: MigrationPlanInput & Readonly<{ baseSchema?: undefined }>,
): PlannedMigration;
export function createMigrationPlan(
	input: MigrationPlanInput,
): MigrationPlanningResult;
export function createMigrationPlan(
	input: MigrationPlanInput,
): MigrationPlanningResult {
	const target = assertProjection(input.targetSchema, "target schema");
	const base = input.baseSchema
		? assertProjection(input.baseSchema, "base schema")
		: genesis(target);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			"migration slug must be lower kebab case",
		);
	if (
		base.application.name !== target.application.name ||
		base.application.postgresSchema !== target.application.postgresSchema
	)
		return schemaError(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"base and target application bindings differ",
		);
	const renames = [...(input.renames ?? [])].sort((left, right) =>
		compareAscii(`${left.from}\0${left.to}`, `${right.from}\0${right.to}`),
	);
	validateRenames(base, target, renames);
	const isGenesis =
		(input.baseMigration ?? null) === null && base.collections.length === 0;
	const steps = isGenesis
		? createSteps(target)
		: destructiveDeltaSteps(base, target, renames);
	const providerDelta = classifyProviderDelta(
		base.requiredPostgres,
		target.requiredPostgres,
	);
	if (
		steps.length === 0 &&
		providerDelta === null &&
		canonicalBytes(base) === canonicalBytes(target)
	)
		return { status: "noChanges" };
	const classifiedSteps = [
		...steps,
		...(providerDelta ? [{ classification: providerDelta }] : []),
		...(renames.length > 0 ? [{ classification: "destructive" as const }] : []),
	];
	if (classifiedSteps.length === 0)
		classifiedSteps.push({ classification: "blocked" });
	const plan: MigrationPlanV1 = {
		format: "questpie.migration-plan",
		version: 1,
		application: target.application.name,
		slug: input.slug,
		baseMigration: input.baseMigration ?? null,
		baseSchemaDigest: schemaDigest(base),
		targetSchemaDigest: schemaDigest(target),
		renames,
		requiredPostgres: target.requiredPostgres,
		classification: maximumClassification(classifiedSteps),
		steps,
	};
	return {
		status: "planned",
		plan,
		digest: digest("questpie-migration-plan-v1", plan),
		baseSchema: base,
	};
}
