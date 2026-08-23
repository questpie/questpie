import {
	definePostgresStatement,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../postgres/contract";

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

type Protocol = Readonly<{ version: number; checksum: string }>;
type ApplicationBinding = Readonly<{
	application: string;
	postgresSchema: string;
}>;
export type ReadinessMigration = Readonly<{
	identity: string;
	sequence: number;
	parent: string | null;
	checksum: string;
}>;

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL readiness ${label}`);
	return value;
}

function digest(value: unknown, label: string): string {
	const decoded = text(value, label);
	if (!/^[0-9a-f]{64}$/u.test(decoded))
		throw new TypeError(`invalid PostgreSQL readiness ${label}`);
	return decoded;
}

function selectRows(
	result: StatementResult,
	maximum: number | undefined,
	label: string,
): readonly (readonly unknown[])[] {
	if (
		result.command !== "SELECT" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		(maximum !== undefined && result.rowCount > maximum)
	)
		throw new TypeError(`invalid PostgreSQL readiness ${label} result`);
	return result.rows;
}

function statement<Input, Output>(
	input: Readonly<{
		name: string;
		text: string;
		parameterCount: number;
		parameters(value: Input): readonly string[];
		decode(result: StatementResult): Output;
	}>,
): PostgresStatement<Input, Output> {
	return definePostgresStatement(input);
}

const protocolStatement = statement<void, Protocol | null>({
	name: "readiness.protocol.v6",
	text: `SELECT version, checksum
FROM questpie_internal.protocol
WHERE singleton = true`,
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const rows = selectRows(result, 1, "protocol");
		if (rows.length === 0) return null;
		const row = rows[0];
		if (
			row?.length !== 2 ||
			typeof row[0] !== "number" ||
			!Number.isSafeInteger(row[0]) ||
			row[0] < 1
		)
			throw new TypeError("invalid PostgreSQL readiness protocol result");
		return Object.freeze({
			version: row[0],
			checksum: digest(row[1], "protocol checksum"),
		});
	},
});

const applicationBindingStatement = statement<
	ApplicationBinding,
	readonly ApplicationBinding[]
>({
	name: "readiness.application-binding",
	text: `SELECT application_name, postgres_schema
FROM questpie_internal.application_bindings
WHERE application_name = $1 OR postgres_schema = $2
ORDER BY application_name`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.application, "Application Identity"),
		text(input.postgresSchema, "application schema"),
	],
	decode(result) {
		const rows = selectRows(result, 2, "Application binding");
		return Object.freeze(
			rows.map((row) => {
				if (row.length !== 2)
					throw new TypeError(
						"invalid PostgreSQL readiness Application binding result",
					);
				return Object.freeze({
					application: text(row[0], "Application Identity"),
					postgresSchema: text(row[1], "application schema"),
				});
			}),
		);
	},
});

const migrationReceiptsStatement = statement<
	string,
	readonly ReadinessMigration[]
>({
	name: "readiness.migration-receipts",
	text: `SELECT migration_identity, sequence, parent_identity, checksum
FROM questpie_internal.schema_migration_receipts
WHERE application_name = $1
ORDER BY sequence`,
	parameterCount: 1,
	parameters: (application) => [text(application, "Application Identity")],
	decode(result) {
		const rows = selectRows(result, undefined, "migration receipt");
		return Object.freeze(
			rows.map((row) => {
				if (
					row.length !== 4 ||
					typeof row[1] !== "number" ||
					!Number.isSafeInteger(row[1]) ||
					row[1] < 1 ||
					(row[2] !== null && typeof row[2] !== "string")
				)
					throw new TypeError(
						"invalid PostgreSQL readiness migration receipt result",
					);
				return Object.freeze({
					identity: text(row[0], "migration identity"),
					sequence: row[1],
					parent:
						row[2] === null ? null : text(row[2], "migration parent identity"),
					checksum: digest(row[3], "migration checksum"),
				});
			}),
		);
	},
});

function sameMigration(
	actual: ReadinessMigration,
	expected: ReadinessMigration,
): boolean {
	return (
		actual.identity === expected.identity &&
		actual.sequence === expected.sequence &&
		actual.parent === expected.parent &&
		actual.checksum === expected.checksum
	);
}

/**
 * Verifies only the fixed protocol row, Application binding, and committed
 * migration receipts. Full Runtime readiness additionally requires the
 * compiler-owned protocol catalog, Schema Fingerprint, and change-capture
 * projection checks.
 */
export async function verifyPostgresDatabaseReadinessPrerequisites(
	input: Readonly<{
		database: PostgresTransactionRunner;
		protocol: Readonly<{ version: 6; checksum: string }>;
		application: string;
		postgresSchema: string;
		migrationHead: string | null;
		committedMigrations: readonly ReadinessMigration[];
	}>,
): Promise<void> {
	if (input.protocol.version !== 6)
		throw new TypeError("expected PostgreSQL readiness protocol must be v6");
	const expectedProtocol: Protocol = Object.freeze({
		version: input.protocol.version,
		checksum: digest(input.protocol.checksum, "protocol checksum"),
	});
	const application = text(input.application, "Application Identity");
	const postgresSchema = text(input.postgresSchema, "application schema");
	const committed = Object.freeze(
		input.committedMigrations.map((migration, index) => {
			if (
				migration.sequence !== index + 1 ||
				migration.parent !==
					(input.committedMigrations[index - 1]?.identity ?? null)
			)
				throw new TypeError("committed migration chain is invalid");
			return Object.freeze({
				identity: text(migration.identity, "migration identity"),
				sequence: migration.sequence,
				parent:
					migration.parent === null
						? null
						: text(migration.parent, "migration parent identity"),
				checksum: digest(migration.checksum, "migration checksum"),
			});
		}),
	);
	const migrationHead =
		input.migrationHead === null
			? null
			: text(input.migrationHead, "migration head");
	if ((committed.at(-1)?.identity ?? null) !== migrationHead)
		throw new TypeError("committed migration head is invalid");

	await input.database.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		use: async (transaction) => {
			const protocol = await transaction.execute(protocolStatement, undefined);
			if (
				protocol?.version !== expectedProtocol.version ||
				protocol.checksum !== expectedProtocol.checksum
			)
				throw new TypeError("questpie_internal protocol v6 is not installed");
			const bindings = await transaction.execute(applicationBindingStatement, {
				application,
				postgresSchema,
			});
			if (
				bindings.length !== 1 ||
				bindings[0]?.application !== application ||
				bindings[0].postgresSchema !== postgresSchema
			)
				throw new TypeError(
					"PostgreSQL Application binding does not match Runtime Build",
				);
			const receipts = await transaction.execute(
				migrationReceiptsStatement,
				application,
			);
			if (
				receipts.length !== committed.length ||
				receipts.some(
					(receipt, index) =>
						committed[index] === undefined ||
						!sameMigration(receipt, committed[index]),
				)
			)
				throw new TypeError(
					"PostgreSQL migration history does not match Runtime Build",
				);
			if ((receipts.at(-1)?.identity ?? null) !== migrationHead)
				throw new TypeError(
					"PostgreSQL migration head does not match Runtime Build",
				);
		},
	});
}
