import type { SQL } from "bun";

import { digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import {
	fingerprintInOwnedTransaction,
	type SchemaProjectionV1,
	verifyInternalProtocolV6,
} from "../schema";

export interface PostgresRuntimeReadinessSnapshotSql<Transaction> {
	begin<Value>(
		mode: "isolation level repeatable read read only",
		use: (transaction: Transaction) => Promise<Value>,
	): Promise<Value>;
}

export async function inPostgresRuntimeReadinessSnapshot<Transaction, Value>(
	sql: PostgresRuntimeReadinessSnapshotSql<Transaction>,
	use: (transaction: Transaction) => Promise<Value>,
): Promise<Value> {
	let diagnostic: CompilerDiagnosticError | undefined;
	const value = await sql.begin(
		"isolation level repeatable read read only",
		async (transaction) => {
			try {
				return await use(transaction);
			} catch (error) {
				if (!(error instanceof CompilerDiagnosticError)) throw error;
				diagnostic = error;
				return undefined as Value;
			}
		},
	);
	if (diagnostic) throw diagnostic;
	return value;
}

type RuntimeBuildReadiness = Readonly<{
	migrationHead: string | null;
	schemaFingerprint: string;
}>;

type CommittedMigration = Readonly<{
	identity: string;
	sequence: number;
	parent: string | null;
	checksum: string;
}>;

type CommittedMigrations = Readonly<{
	format: "questpie.committed-migrations";
	version: 1;
	head: string | null;
	migrations: readonly CommittedMigration[];
}>;

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function exactKeys(
	value: RecordValue,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	if (
		actual.length !== sorted.length ||
		actual.some((key, index) => key !== sorted[index])
	)
		throw new TypeError(`${label} has invalid keys`);
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${label} must be a nonempty string`);
	return value;
}

function nullableString(value: unknown, label: string): string | null {
	return value === null ? null : string(value, label);
}

function decodeCommittedMigrations(value: unknown): CommittedMigrations {
	const artifact = record(value, "committed migrations");
	exactKeys(
		artifact,
		["format", "version", "head", "migrations"],
		"committed migrations",
	);
	if (
		artifact.format !== "questpie.committed-migrations" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.migrations)
	)
		throw new TypeError("committed migrations artifact is invalid");
	const migrations = artifact.migrations.map((raw, index) => {
		const migration = record(raw, `committed migration ${index}`);
		exactKeys(
			migration,
			["identity", "sequence", "parent", "checksum"],
			`committed migration ${index}`,
		);
		const sequence = migration.sequence;
		if (
			typeof sequence !== "number" ||
			!Number.isSafeInteger(sequence) ||
			sequence < 1
		)
			throw new TypeError(`committed migration ${index} sequence is invalid`);
		return Object.freeze({
			identity: string(
				migration.identity,
				`committed migration ${index} identity`,
			),
			sequence,
			parent: nullableString(
				migration.parent,
				`committed migration ${index} parent`,
			),
			checksum: string(
				migration.checksum,
				`committed migration ${index} checksum`,
			),
		});
	});
	if (
		migrations.some(
			(migration, index) =>
				migration.sequence !== index + 1 ||
				migration.parent !== (migrations[index - 1]?.identity ?? null),
		)
	)
		throw new TypeError("committed migration chain is invalid");
	const head = nullableString(artifact.head, "committed migration head");
	if (head !== (migrations.at(-1)?.identity ?? null))
		throw new TypeError("committed migration head is invalid");
	return Object.freeze({
		format: "questpie.committed-migrations",
		version: 1,
		head,
		migrations: Object.freeze(migrations),
	});
}

export async function verifyPostgresRuntimeReadiness(
	input: Readonly<{
		sql: SQL;
		schema: SchemaProjectionV1;
		committedMigrations: unknown;
		expected: RuntimeBuildReadiness;
	}>,
): Promise<void> {
	const committed = decodeCommittedMigrations(input.committedMigrations);
	if (committed.head !== input.expected.migrationHead)
		throw new TypeError(
			"committed migration head does not match Runtime Build",
		);
	return inPostgresRuntimeReadinessSnapshot(input.sql, (sql) =>
		verifyPostgresRuntimeReadinessInOwnedTransaction({
			sql,
			schema: input.schema,
			committed,
			expected: input.expected,
		}),
	);
}

async function verifyPostgresRuntimeReadinessInOwnedTransaction(
	input: Readonly<{
		sql: SQL;
		schema: SchemaProjectionV1;
		committed: CommittedMigrations;
		expected: RuntimeBuildReadiness;
	}>,
): Promise<void> {
	await verifyInternalProtocolV6(input.sql);
	const applicationName = input.schema.application.name;
	const postgresSchema = input.schema.application.postgresSchema;
	const bindings = await input.sql.unsafe<
		readonly Readonly<{ applicationName: string; postgresSchema: string }>[]
	>(
		'SELECT application_name AS "applicationName", postgres_schema AS "postgresSchema" FROM questpie_internal.application_bindings WHERE application_name = $1 OR postgres_schema = $2 ORDER BY application_name',
		[applicationName, postgresSchema],
	);
	if (
		bindings.length !== 1 ||
		bindings[0]?.applicationName !== applicationName ||
		bindings[0].postgresSchema !== postgresSchema
	)
		throw new TypeError(
			"PostgreSQL Application binding does not match Runtime Build",
		);
	const receipts = await input.sql.unsafe<
		readonly Readonly<{
			identity: string;
			sequence: number;
			parent: string | null;
			checksum: string;
		}>[]
	>(
		"SELECT migration_identity AS identity, sequence, parent_identity AS parent, checksum FROM questpie_internal.schema_migration_receipts WHERE application_name = $1 ORDER BY sequence",
		[applicationName],
	);
	if (
		receipts.length !== input.committed.migrations.length ||
		receipts.some((receipt, index) => {
			const expected = input.committed.migrations[index];
			return (
				!expected ||
				receipt.identity !== expected.identity ||
				receipt.sequence !== expected.sequence ||
				receipt.parent !== expected.parent ||
				receipt.checksum !== expected.checksum
			);
		})
	)
		throw new TypeError(
			"PostgreSQL migration history does not match Runtime Build",
		);
	if ((receipts.at(-1)?.identity ?? null) !== input.expected.migrationHead)
		throw new TypeError(
			"PostgreSQL migration head does not match Runtime Build",
		);
	const liveFingerprint = await fingerprintInOwnedTransaction(
		input.sql,
		input.schema,
	);
	const liveFingerprintDigest = digest(
		"questpie-schema-fingerprint-v1",
		liveFingerprint.comparable,
	);
	if (liveFingerprintDigest !== input.expected.schemaFingerprint)
		throw new TypeError(
			"PostgreSQL Schema Fingerprint does not match Runtime Build",
		);
}
