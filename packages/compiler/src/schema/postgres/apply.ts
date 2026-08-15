import { SQL } from "bun";

import { digest } from "../../canonical";
import { CompilerDiagnosticError } from "../../diagnostic";
import {
	acquireSessionLock,
	assertBackendPid,
	cancelBackendOnAbort,
	configurePostgresTimeouts,
	lockKey,
	probeCommittedSession,
	resolvePostgresControl,
	withPinnedTransaction,
} from "../../postgres-session";
import type { PostgresCommandControl } from "../../postgres-session";
import { verifyCommittedMigrationChain } from "../committed-migration";
import type { CommittedMigration } from "../contracts";
import type {
	ApplyMigrationsFailure,
	ApplyMigrationsResult,
	SchemaDiagnosticV1,
} from "../postgres-types";
import { bootstrap } from "./bootstrap";
import {
	assertSchemaMatches,
	fingerprint,
	providerObservations,
	schemaExists,
} from "./fingerprint";
import { fail } from "./shared";

const schemaDiagnosticCodes = new Set<string>([
	"QP-SCHEMA-001",
	"QP-SCHEMA-002",
	"QP-SCHEMA-003",
	"QP-SCHEMA-004",
	"QP-SCHEMA-005",
	"QP-SCHEMA-006",
	"QP-SCHEMA-007",
	"QP-SCHEMA-020",
	"QP-SCHEMA-021",
	"QP-SCHEMA-022",
	"QP-SCHEMA-023",
	"QP-SCHEMA-024",
	"QP-SCHEMA-025",
	"QP-SCHEMA-026",
	"QP-SCHEMA-027",
	"QP-SCHEMA-028",
	"QP-SCHEMA-029",
	"QP-SCHEMA-031",
]);

const schemaDiagnosticClasses = new Set<string>([
	"invalidDefinition",
	"duplicateIdentity",
	"invalidReference",
	"unsupportedDefinition",
	"invalidPhysicalName",
	"physicalNameCollision",
	"providerMismatch",
	"destructiveAcknowledgementRequired",
	"planDigestMismatch",
	"stalePlan",
	"checksumMismatch",
	"missingLocalMigration",
	"pendingMigration",
	"unknownAppliedMigration",
	"orderMismatch",
	"applicationBindingMismatch",
	"baseDrift",
	"targetDrift",
	"missingObject",
	"unexpectedObject",
	"changedObject",
	"invalidObject",
	"undeclaredDependency",
	"unplannedDesiredChange",
	"unsupportedPostgres",
	"missingExtension",
	"incompatibleExtension",
	"nonTransactionalDdl",
]);

function isSchemaDiagnosticCode(
	value: string,
): value is SchemaDiagnosticV1["code"] {
	return schemaDiagnosticCodes.has(value);
}

function isSchemaDiagnosticClass(
	value: string,
): value is SchemaDiagnosticV1["class"] {
	return schemaDiagnosticClasses.has(value);
}

function diagnosticComparison(
	code: CompilerDiagnosticError["code"],
): SchemaDiagnosticV1["comparison"] {
	if (["QP-SCHEMA-026", "QP-SCHEMA-027", "QP-SCHEMA-028"].includes(code))
		return "appliedToDatabase";
	if (code === "QP-SCHEMA-007") return "provider";
	if (
		[
			"QP-SCHEMA-023",
			"QP-SCHEMA-024",
			"QP-SCHEMA-025",
			"QP-SCHEMA-029",
		].includes(code)
	)
		return "localToReceipts";
	return null;
}

function schemaDiagnostic(
	error: CompilerDiagnosticError,
	migrationIdentity: string,
	application: string,
): SchemaDiagnosticV1 | null {
	if (
		!isSchemaDiagnosticCode(error.code) ||
		!isSchemaDiagnosticClass(error.diagnosticClass)
	)
		return null;
	const drift = ["QP-SCHEMA-026", "QP-SCHEMA-027", "QP-SCHEMA-028"].includes(
		error.code,
	);
	return {
		format: "questpie.diagnostic",
		version: 1,
		code: error.code,
		class: error.diagnosticClass,
		severity: "error",
		blocking: drift ? "deploy" : "fatal",
		identity: migrationIdentity,
		origins: [],
		summary: error.message,
		expected: null,
		actual: null,
		recovery: drift
			? [
					{
						description: "Inspect and repair the live Schema Fingerprint",
						command: "bunx questpie schema drift",
					},
				]
			: [
					{
						description: "Resolve the blocking migration diagnostic",
						command: null,
					},
				],
		comparison: diagnosticComparison(error.code),
		physicalName: null,
		containerIdentity: `application:${application}`,
	};
}

function sqlstate(error: SQL.PostgresError): string | null {
	const value = error.errno;
	return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value)
		? value
		: null;
}

function migrationFailure(
	error: unknown,
	migrationIdentity: string,
	application: string,
	applied: readonly string[],
	remaining: readonly string[],
): ApplyMigrationsFailure | null {
	if (error instanceof CompilerDiagnosticError) {
		const diagnostic = schemaDiagnostic(error, migrationIdentity, application);
		if (!diagnostic) return null;
		return {
			status: "failed",
			exitCode: 4,
			applied: [...applied],
			failed: migrationIdentity,
			diagnostic,
			remaining: [...remaining],
		};
	}
	if (error instanceof SQL.PostgresError)
		return {
			status: "failed",
			exitCode: 5,
			applied: [...applied],
			failed: migrationIdentity,
			diagnostic: { sqlstate: sqlstate(error) },
			remaining: [...remaining],
		};
	return null;
}

async function assertMigrationBoundary(
	sql: SQL,
	schema: Parameters<typeof assertSchemaMatches>[1],
	boundary: "base" | "target",
	migrationIdentity: string,
): Promise<void> {
	try {
		await assertSchemaMatches(sql, schema);
	} catch (error) {
		if (
			!(error instanceof CompilerDiagnosticError) ||
			error.code !== "QP-SCHEMA-028"
		)
			throw error;
		const message = `${migrationIdentity} ${boundary} Schema Fingerprint does not match the committed artifact`;
		if (boundary === "base")
			throw new CompilerDiagnosticError("QP-SCHEMA-026", "baseDrift", message);
		throw new CompilerDiagnosticError("QP-SCHEMA-027", "targetDrift", message);
	}
}

export async function applyCommittedMigrations(
	input: Readonly<{
		connectionString?: string;
		migrations: readonly CommittedMigration[];
	}> &
		PostgresCommandControl,
): Promise<ApplyMigrationsResult> {
	verifyCommittedMigrationChain(input.migrations);
	const migrations = [...input.migrations];
	for (const migration of migrations) {
		if (migration.plan.steps.some((item) => item.kind.includes("Concurrent")))
			return fail(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`${migration.identity} contains non-transactional DDL`,
			);
	}
	const target = migrations.at(-1)!.targetSchema;
	const application = target.application.name;
	const pool = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	const session = await pool.reserve();
	let stopBackendCancellation = () => {};
	try {
		const firstPid = await probeCommittedSession(session);
		stopBackendCancellation = cancelBackendOnAbort(
			pool,
			firstPid,
			input.signal,
		);
		const control = resolvePostgresControl(input);
		await configurePostgresTimeouts(session, control);
		const [database] = await session<{ name: string }[]>`
			select current_database() as name
		`;
		if (!database)
			return fail(
				"QP-SCHEMA-007",
				"providerMismatch",
				"current database is unavailable",
			);
		await providerObservations(session, target);
		await bootstrap(session, database.name, firstPid, control, input.signal);
		const applicationKey = lockKey(
			"questpie-application-lock-v1",
			database.name,
			application,
		);
		await acquireSessionLock(session, applicationKey, control, input.signal);
		try {
			await assertBackendPid(session, firstPid, "application lock");
			const conflictingBindings = await session<
				{
					applicationName: string;
					schemaName: string;
				}[]
			>`
				select application_name as "applicationName", postgres_schema as "schemaName"
				from questpie_internal.application_bindings
				where application_name = ${application}
				   or postgres_schema = ${target.application.postgresSchema}
			`;
			if (
				conflictingBindings.some(
					(binding) =>
						binding.applicationName !== application ||
						binding.schemaName !== target.application.postgresSchema,
				)
			)
				return fail(
					"QP-SCHEMA-029",
					"applicationBindingMismatch",
					"Application Identity and PostgreSQL schema binding disagree",
				);
			const receipts = await session<
				{
					identity: string;
					sequence: number;
					checksum: string;
					parent: string | null;
					baseSchemaDigest: string;
					targetSchemaDigest: string;
				}[]
			>`
				select migration_identity as identity,
				       sequence,
				       checksum,
				       parent_identity as parent,
				       base_schema_digest as "baseSchemaDigest",
				       target_schema_digest as "targetSchemaDigest"
				from questpie_internal.schema_migration_receipts
				where application_name = ${application}
				order by sequence
			`;
			if (receipts.length > migrations.length)
				return fail(
					"QP-SCHEMA-024",
					"unknownAppliedMigration",
					"database migration history is longer than the local chain",
				);
			for (const [index, receipt] of receipts.entries()) {
				const local = migrations[index];
				if (!local || local.identity !== receipt.identity)
					return fail(
						"QP-SCHEMA-024",
						"unknownAppliedMigration",
						`database receipt ${receipt.identity} is not the exact local prefix at sequence ${index + 1}`,
					);
				if (
					receipt.sequence !== index + 1 ||
					receipt.parent !== local.plan.baseMigration ||
					receipt.baseSchemaDigest !== local.plan.baseSchemaDigest ||
					receipt.targetSchemaDigest !== local.plan.targetSchemaDigest
				)
					return fail(
						"QP-SCHEMA-025",
						"orderMismatch",
						`${receipt.identity} receipt does not match its local chain position`,
					);
				if (local.checksum !== receipt.checksum)
					return fail(
						"QP-SCHEMA-023",
						"checksumMismatch",
						`${receipt.identity} differs from its database receipt`,
					);
			}
			const pending = migrations.slice(receipts.length);
			const applied: string[] = [];
			const firstPending = pending[0];
			if (firstPending)
				try {
					if (
						receipts.length === 0 &&
						(await schemaExists(session, target.application.postgresSchema))
					)
						return migrationFailure(
							new CompilerDiagnosticError(
								"QP-SCHEMA-026",
								"baseDrift",
								"Genesis requires the application schema to be absent before DDL",
							),
							firstPending.identity,
							application,
							applied,
							pending.slice(1).map((item) => item.identity),
						)!;
					if (receipts.length > 0)
						await assertMigrationBoundary(
							session,
							firstPending.baseSchema,
							"base",
							firstPending.identity,
						);
				} catch (error) {
					const failure = migrationFailure(
						error,
						firstPending.identity,
						application,
						applied,
						pending.slice(1).map((item) => item.identity),
					);
					if (failure) return failure;
					throw error;
				}
			for (const [pendingIndex, migration] of pending.entries()) {
				try {
					if (pendingIndex > 0)
						await assertMigrationBoundary(
							session,
							migration.baseSchema,
							"base",
							migration.identity,
						);
					await withPinnedTransaction(
						session,
						firstPid,
						`${migration.identity} transaction`,
						input.signal,
						async (transaction) => {
							if (migration.plan.baseMigration === null)
								await transaction`
							insert into questpie_internal.application_bindings
							(application_name, postgres_schema, created_at)
							values (${application}, ${target.application.postgresSchema}, ${new Date()})
						`;
							const migrationSql = migration.files["up.sql"] ?? "";
							if (migrationSql.length > 0)
								await transaction.unsafe(migrationSql);
							await assertMigrationBoundary(
								transaction,
								migration.targetSchema,
								"target",
								migration.identity,
							);
							await transaction`
						insert into questpie_internal.schema_migration_receipts
						(application_name, migration_identity, sequence, parent_identity, checksum, base_schema_digest, target_schema_digest, applied_at)
						values (${application}, ${migration.identity}, ${Number(migration.identity.slice(0, 6))}, ${migration.plan.baseMigration}, ${migration.checksum}, ${migration.plan.baseSchemaDigest}, ${migration.plan.targetSchemaDigest}, ${new Date()})
					`;
						},
					);
					applied.push(migration.identity);
					await assertMigrationBoundary(
						session,
						migration.targetSchema,
						"target",
						migration.identity,
					);
				} catch (error) {
					const failure = migrationFailure(
						error,
						migration.identity,
						application,
						applied,
						pending.slice(pendingIndex + 1).map((item) => item.identity),
					);
					if (failure) return failure;
					throw error;
				}
			}
			let resultFingerprint;
			try {
				resultFingerprint = await fingerprint(session, target);
			} catch (error) {
				let diagnosticError = error;
				if (
					error instanceof CompilerDiagnosticError &&
					error.code === "QP-SCHEMA-028"
				)
					diagnosticError = new CompilerDiagnosticError(
						"QP-SCHEMA-027",
						"targetDrift",
						`${migrations.at(-1)!.identity} target Schema Fingerprint does not match the committed artifact`,
					);
				const failure = migrationFailure(
					diagnosticError,
					migrations.at(-1)!.identity,
					application,
					applied,
					[],
				);
				if (failure) return failure;
				throw diagnosticError;
			}
			return {
				status: applied.length > 0 ? "applied" : "alreadyApplied",
				applied,
				head: migrations.at(-1)!.identity,
				fingerprintDigest: digest(
					"questpie-schema-fingerprint-v1",
					resultFingerprint.comparable,
				),
			};
		} finally {
			await assertBackendPid(session, firstPid, "application unlock");
			await session`select pg_catalog.pg_advisory_unlock(${applicationKey})`;
		}
	} finally {
		stopBackendCancellation();
		session.release();
		await pool.close();
	}
}
