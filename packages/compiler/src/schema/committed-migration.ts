import { createHash } from "node:crypto";

import { canonicalBytes, compareAscii, digest } from "../canonical";
import type {
	CommittedMigration,
	CommittedMigrationFilesV1,
	MigrationPlanV1,
	SchemaProjectionV1,
} from "./contracts";
import { createMigrationPlan } from "./migration-plan";
import { renderMigrationSql } from "./migration-renderer";
import {
	assertProjection,
	genesis,
	schemaDigest,
	schemaError,
} from "./projection";

type JsonRecord = Readonly<Record<string, unknown>>;

type MigrationPayloadFiles = Omit<CommittedMigrationFilesV1, "checksum.sha256">;

const committedMigrationFileNames = [
	"base-schema.json",
	"checksum.sha256",
	"migration.json",
	"plan.json",
	"target-schema.json",
	"up.sql",
] as const;

function migrationChecksum(files: MigrationPayloadFiles): string {
	return createHash("sha256")
		.update("questpie-migration-v1\0")
		.update(files["migration.json"])
		.update("\0")
		.update(files["plan.json"])
		.update("\0")
		.update(files["base-schema.json"])
		.update("\0")
		.update(files["target-schema.json"])
		.update("\0")
		.update(files["up.sql"])
		.digest("hex");
}

export function createCommittedMigration(
	input: Readonly<{
		plan: MigrationPlanV1;
		baseSchema: SchemaProjectionV1;
		targetSchema: SchemaProjectionV1;
		planDigest: string;
		localMigrations: readonly CommittedMigration[];
		currentSchema: SchemaProjectionV1;
		acceptDestructive?: string;
	}>,
): CommittedMigration {
	const base = assertProjection(input.baseSchema, "base schema");
	const target = assertProjection(input.targetSchema, "target schema");
	const actualPlanDigest = digest("questpie-migration-plan-v1", input.plan);
	if (input.planDigest !== actualPlanDigest)
		return schemaError(
			"QP-SCHEMA-021",
			"planDigestMismatch",
			"Migration Plan Digest does not match the supplied plan",
		);
	if (input.plan.classification === "blocked")
		return schemaError(
			"QP-SCHEMA-031",
			"nonTransactionalDdl",
			"blocked Migration Plan cannot be committed",
		);
	if (
		input.plan.classification === "destructive" &&
		input.acceptDestructive !== actualPlanDigest
	)
		return schemaError(
			"QP-SCHEMA-020",
			"destructiveAcknowledgementRequired",
			"destructive Migration Plan requires its exact digest",
		);
	const current = assertProjection(input.currentSchema, "current schema");
	const replanned = createMigrationPlan({
		targetSchema: current,
		baseSchema: base,
		baseMigration: input.plan.baseMigration,
		slug: input.plan.slug,
		renames: input.plan.renames,
	});
	if (
		replanned.status === "noChanges" ||
		canonicalBytes(replanned.plan) !== canonicalBytes(input.plan) ||
		schemaDigest(target) !== input.plan.targetSchemaDigest
	)
		return schemaError(
			"QP-SCHEMA-022",
			"stalePlan",
			"Definitions or migration history changed after planning",
		);
	if (input.localMigrations.length > 0)
		verifyCommittedMigrationChain(input.localMigrations);
	const head = input.localMigrations.at(-1);
	const parent = head?.identity ?? null;
	const expectedBase = head?.targetSchema ?? genesis(target);
	if (
		input.plan.baseMigration !== parent ||
		canonicalBytes(base) !== canonicalBytes(expectedBase)
	)
		return schemaError(
			"QP-SCHEMA-022",
			"stalePlan",
			"Migration Plan does not extend the exact local migration head",
		);
	const sequence = input.localMigrations.length + 1;
	const identity = `${sequence.toString().padStart(6, "0")}_${input.plan.slug}`;
	const metadata = {
		format: "questpie.committed-migration",
		version: 1,
		identity,
		sequence,
		slug: input.plan.slug,
		parent,
		planDigest: actualPlanDigest,
		baseSchemaDigest: schemaDigest(base),
		targetSchemaDigest: schemaDigest(target),
		requiredPostgres: target.requiredPostgres,
		transaction: "required",
		sqlRenderer: "questpie-postgres-ddl-v1",
	};
	const upSql = renderMigrationSql(input.plan, target, base);
	const payloadFiles: MigrationPayloadFiles = {
		"migration.json": canonicalBytes(metadata),
		"plan.json": canonicalBytes(input.plan),
		"base-schema.json": canonicalBytes(base),
		"target-schema.json": canonicalBytes(target),
		"up.sql": upSql,
	};
	const checksum = migrationChecksum(payloadFiles);
	const files: CommittedMigrationFilesV1 = {
		...payloadFiles,
		"checksum.sha256": `${checksum}\n`,
	};
	return {
		identity,
		checksum,
		plan: input.plan,
		baseSchema: base,
		targetSchema: target,
		files,
	};
}

export function verifyCommittedMigration(migration: CommittedMigration): void {
	const names = Object.keys(migration.files).sort(compareAscii);
	if (canonicalBytes(names) !== canonicalBytes(committedMigrationFileNames))
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} does not contain the exact six-file contract`,
		);
	const payloadFiles: MigrationPayloadFiles = {
		"migration.json": migration.files["migration.json"],
		"plan.json": migration.files["plan.json"],
		"base-schema.json": migration.files["base-schema.json"],
		"target-schema.json": migration.files["target-schema.json"],
		"up.sql": migration.files["up.sql"],
	};
	const actualChecksum = migrationChecksum(payloadFiles);
	if (
		migration.files["checksum.sha256"] !== `${actualChecksum}\n` ||
		migration.checksum !== actualChecksum
	)
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} checksum is invalid`,
		);
	let metadata: JsonRecord;
	let plan: MigrationPlanV1;
	let base: SchemaProjectionV1;
	let target: SchemaProjectionV1;
	try {
		metadata = JSON.parse(payloadFiles["migration.json"]) as JsonRecord;
		plan = JSON.parse(payloadFiles["plan.json"]) as MigrationPlanV1;
		base = assertProjection(
			JSON.parse(payloadFiles["base-schema.json"]),
			"committed base schema",
		);
		target = assertProjection(
			JSON.parse(payloadFiles["target-schema.json"]),
			"committed target schema",
		);
	} catch {
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} contains invalid artifact JSON`,
		);
	}
	const sequence = Number(metadata.sequence);
	const parent = metadata.parent === null ? null : String(metadata.parent);
	const expectedIdentity = `${sequence.toString().padStart(6, "0")}_${String(metadata.slug)}`;
	const expectedPlanDigest = digest("questpie-migration-plan-v1", plan);
	if (
		canonicalBytes(metadata) !== payloadFiles["migration.json"] ||
		canonicalBytes(plan) !== payloadFiles["plan.json"] ||
		canonicalBytes(base) !== payloadFiles["base-schema.json"] ||
		canonicalBytes(target) !== payloadFiles["target-schema.json"] ||
		metadata.format !== "questpie.committed-migration" ||
		metadata.version !== 1 ||
		!Number.isSafeInteger(sequence) ||
		sequence < 1 ||
		expectedIdentity !== migration.identity ||
		metadata.identity !== migration.identity ||
		metadata.slug !== plan.slug ||
		metadata.planDigest !== expectedPlanDigest ||
		metadata.baseSchemaDigest !== schemaDigest(base) ||
		metadata.targetSchemaDigest !== schemaDigest(target) ||
		plan.baseSchemaDigest !== schemaDigest(base) ||
		plan.targetSchemaDigest !== schemaDigest(target) ||
		plan.application !== target.application.name ||
		canonicalBytes(metadata.requiredPostgres) !==
			canonicalBytes(target.requiredPostgres) ||
		canonicalBytes(plan.requiredPostgres) !==
			canonicalBytes(target.requiredPostgres) ||
		metadata.transaction !== "required" ||
		metadata.sqlRenderer !== "questpie-postgres-ddl-v1" ||
		base.application.name !== target.application.name ||
		base.application.postgresSchema !== target.application.postgresSchema ||
		parent !== plan.baseMigration ||
		(sequence === 1 ? parent !== null : parent === null) ||
		canonicalBytes(plan) !== canonicalBytes(migration.plan) ||
		canonicalBytes(base) !== canonicalBytes(migration.baseSchema) ||
		canonicalBytes(target) !== canonicalBytes(migration.targetSchema) ||
		renderMigrationSql(plan, target, base) !== payloadFiles["up.sql"]
	)
		return schemaError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${migration.identity} artifacts disagree with one another`,
		);
}

export function verifyCommittedMigrationChain(
	migrations: readonly CommittedMigration[],
): void {
	if (migrations.length === 0)
		return schemaError(
			"QP-SCHEMA-024",
			"missingLocalMigration",
			"no committed migration exists",
		);
	for (const [index, migration] of migrations.entries()) {
		verifyCommittedMigration(migration);
		const metadata = JSON.parse(
			migration.files["migration.json"],
		) as JsonRecord;
		const sequence = index + 1;
		const previous = migrations[index - 1];
		const expectedParent = previous?.identity ?? null;
		if (
			metadata.sequence !== sequence ||
			migration.identity.slice(0, 6) !== sequence.toString().padStart(6, "0") ||
			migration.plan.baseMigration !== expectedParent ||
			metadata.parent !== expectedParent ||
			(previous !== undefined &&
				canonicalBytes(migration.baseSchema) !==
					canonicalBytes(previous.targetSchema)) ||
			(previous === undefined && migration.baseSchema.collections.length !== 0)
		)
			return schemaError(
				"QP-SCHEMA-025",
				"orderMismatch",
				`${migration.identity} does not extend the exact local migration prefix`,
			);
	}
}
