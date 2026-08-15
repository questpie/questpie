import { SQL } from "bun";

import { digest } from "../../canonical";
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
import type { ApplyMigrationsResult } from "../postgres-types";
import { bootstrap } from "./bootstrap";
import {
	assertSchemaMatches,
	fingerprint,
	providerObservations,
	schemaExists,
} from "./fingerprint";
import { fail } from "./shared";

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
			if (receipts.length === 0) {
				if (await schemaExists(session, target.application.postgresSchema))
					return fail(
						"QP-SCHEMA-028",
						"baseDrift",
						"Genesis requires the application schema to be absent before DDL",
					);
			} else if (pending[0]) {
				await assertSchemaMatches(session, pending[0].baseSchema);
			}
			const applied: string[] = [];
			for (const migration of pending) {
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
						if (migrationSql.length > 0) await transaction.unsafe(migrationSql);
						await assertSchemaMatches(transaction, migration.targetSchema);
						await transaction`
						insert into questpie_internal.schema_migration_receipts
						(application_name, migration_identity, sequence, parent_identity, checksum, base_schema_digest, target_schema_digest, applied_at)
						values (${application}, ${migration.identity}, ${Number(migration.identity.slice(0, 6))}, ${migration.plan.baseMigration}, ${migration.checksum}, ${migration.plan.baseSchemaDigest}, ${migration.plan.targetSchemaDigest}, ${new Date()})
					`;
					},
				);
				await assertSchemaMatches(session, migration.targetSchema);
				applied.push(migration.identity);
			}
			const resultFingerprint = await fingerprint(session, target);
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
