import type {
	definePostgresAdministrativeStatement,
	definePostgresStatement,
	PostgresTransactionRunner,
	verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction,
} from "@questpie/runtime/bundle-core-types";

import { digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import {
	internalProtocolV9Checksum,
	type SchemaProjectionV1,
	verifyPostgresDatabaseSchemaReadiness,
} from "../schema";

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

export async function verifyPostgresDatabaseRuntimeReadiness(
	input: Readonly<{
		database: PostgresTransactionRunner;
		runtime: Readonly<{
			definePostgresAdministrativeStatement: typeof definePostgresAdministrativeStatement;
			definePostgresStatement: typeof definePostgresStatement;
			verifyReadinessPrerequisites: typeof verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction;
		}>;
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
	let diagnostic: CompilerDiagnosticError | undefined;
	await input.database.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		use: async (transaction) => {
			try {
				await input.runtime.verifyReadinessPrerequisites({
					transaction,
					protocol: { version: 9, checksum: internalProtocolV9Checksum },
					application: input.schema.application.name,
					postgresSchema: input.schema.application.postgresSchema,
					migrationHead: committed.head,
					committedMigrations: committed.migrations,
				});
				const fingerprint = await verifyPostgresDatabaseSchemaReadiness(
					transaction,
					input.schema,
					input.runtime.definePostgresStatement,
					input.runtime.definePostgresAdministrativeStatement,
				);
				const fingerprintDigest = digest(
					"questpie-schema-fingerprint-v1",
					fingerprint.comparable,
				);
				if (fingerprintDigest !== input.expected.schemaFingerprint)
					throw new TypeError(
						"PostgreSQL Schema Fingerprint does not match Runtime Build",
					);
			} catch (error) {
				if (!(error instanceof CompilerDiagnosticError)) throw error;
				diagnostic = error;
			}
		},
	});
	if (diagnostic) throw diagnostic;
}
