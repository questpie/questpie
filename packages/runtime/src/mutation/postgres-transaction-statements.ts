import { runtimeArtifactDigest } from "../application/artifact-protocol";
import {
	definePostgresStatement,
	type PostgresParameter,
	type PostgresStatement,
} from "../postgres/contract";

type RecordValue = Readonly<Record<string, unknown>>;
type DecodedRow = Readonly<Record<string, unknown>>;

type ResultColumnContract = Readonly<{
	key: string;
	codec: "bytea" | "text" | "timestamptz";
	nullable: boolean;
}>;

type StatementContract = Readonly<{
	parameterCount: number;
	command: "INSERT" | "SELECT" | "UPDATE";
	affectedRows: readonly [minimum: number, maximum: number];
	returnedRows: readonly [minimum: number, maximum: number];
	columns: readonly ResultColumnContract[];
}>;

const statementContracts: Readonly<Record<string, StatementContract>> =
	Object.freeze({
		"mutation.dispatch.event.insert": {
			parameterCount: 7,
			command: "INSERT",
			affectedRows: [1, 1],
			returnedRows: [0, 0],
			columns: [],
		},
		"mutation.dispatch.intent.accept": {
			parameterCount: 2,
			command: "UPDATE",
			affectedRows: [0, 1],
			returnedRows: [0, 1],
			columns: [{ key: "dispatchId", codec: "text", nullable: false }],
		},
		"mutation.dispatch.intent.insert": {
			parameterCount: 12,
			command: "INSERT",
			affectedRows: [1, 1],
			returnedRows: [0, 0],
			columns: [],
		},
		"mutation.dispatch.kernel.mark": {
			parameterCount: 0,
			command: "SELECT",
			affectedRows: [1, 1],
			returnedRows: [1, 1],
			columns: [{ key: "enabled", codec: "text", nullable: false }],
		},
		"mutation.dispatch.run.insert": {
			parameterCount: 16,
			command: "INSERT",
			affectedRows: [0, 1],
			returnedRows: [0, 1],
			columns: [{ key: "runId", codec: "text", nullable: false }],
		},
		"mutation.receipt.claim": {
			parameterCount: 7,
			command: "INSERT",
			affectedRows: [0, 1],
			returnedRows: [0, 1],
			columns: [
				{ key: "transactionId", codec: "text", nullable: false },
				{ key: "operationTime", codec: "timestamptz", nullable: false },
			],
		},
		"mutation.receipt.commit": {
			parameterCount: 8,
			command: "UPDATE",
			affectedRows: [1, 1],
			returnedRows: [0, 0],
			columns: [],
		},
		"mutation.receipt.read": {
			parameterCount: 6,
			command: "SELECT",
			affectedRows: [1, 1],
			returnedRows: [1, 1],
			columns: [
				{ key: "inputDigest", codec: "text", nullable: false },
				{ key: "outcome", codec: "text", nullable: false },
				{ key: "resultBytes", codec: "bytea", nullable: true },
				{ key: "transactionId", codec: "text", nullable: false },
			],
		},
	});

const expectedIdentities = Object.freeze(
	Object.keys(statementContracts).sort(),
);

export type LinkedPostgresMutationTransactionStatement = Readonly<{
	identity: string;
	statement: PostgresStatement<
		readonly PostgresParameter[],
		readonly DecodedRow[]
	>;
}>;

export type LinkedPostgresMutationTransactionStatements = Readonly<{
	statements: readonly LinkedPostgresMutationTransactionStatement[];
	get(identity: string): LinkedPostgresMutationTransactionStatement | undefined;
}>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`invalid PostgreSQL Mutation ${label}`);
	return value as RecordValue;
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value))
		throw new TypeError(`invalid PostgreSQL Mutation ${label}`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`invalid PostgreSQL Mutation ${label}`);
	return value;
}

function integer(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new TypeError(`invalid PostgreSQL Mutation ${label}`);
	return value as number;
}

function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => actual[index] !== key)
	)
		throw new TypeError(`invalid PostgreSQL Mutation ${label}`);
}

function decodeScalar(
	value: unknown,
	codec: string,
	nullable: boolean,
): unknown {
	if (value === null && nullable) return null;
	if (codec === "text" && typeof value === "string" && value.length > 0)
		return value;
	if (codec === "bytea" && value instanceof Uint8Array) return value;
	if (
		codec === "timestamptz" &&
		value instanceof Date &&
		Number.isFinite(value.getTime())
	)
		return new Date(value.getTime());
	throw new TypeError("invalid PostgreSQL Mutation result scalar");
}

function placeholders(statement: string, parameterCount: number): void {
	const tokens = [...statement.matchAll(/\$([0-9]+)/gu)].map(
		(match) => match[1]!,
	);
	const positions = new Set(tokens.map(Number));
	if (
		tokens.some(
			(token) =>
				String(Number(token)) !== token ||
				Number(token) < 1 ||
				Number(token) > parameterCount,
		) ||
		positions.size !== parameterCount ||
		Array.from({ length: parameterCount }, (_, index) => index + 1).some(
			(position) => !positions.has(position),
		)
	)
		throw new TypeError("invalid PostgreSQL Mutation placeholders");
}

function linkStatement(
	rawValue: unknown,
	contract: StatementContract,
): LinkedPostgresMutationTransactionStatement {
	const raw = record(rawValue, "statement");
	exact(
		raw,
		["identity", "text", "parameterCount", "result"],
		"statement keys",
	);
	const identity = text(raw.identity, "statement identity");
	const statementText = text(raw.text, "statement text");
	const parameterCount = integer(raw.parameterCount, "parameter count");
	const result = record(raw.result, "result");
	exact(
		result,
		["command", "affectedRows", "returnedRows", "columns"],
		"result keys",
	);
	const command = text(result.command, "result command");
	const affectedRows = record(result.affectedRows, "affected rows");
	const returnedRows = record(result.returnedRows, "returned rows");
	exact(affectedRows, ["minimum", "maximum"], "affected row keys");
	exact(returnedRows, ["minimum", "maximum"], "returned row keys");
	const affectedMinimum = integer(affectedRows.minimum, "affected minimum");
	const affectedMaximum = integer(affectedRows.maximum, "affected maximum");
	const returnedMinimum = integer(returnedRows.minimum, "returned minimum");
	const returnedMaximum = integer(returnedRows.maximum, "returned maximum");
	const columns = array(result.columns, "result columns").map((value) => {
		const column = record(value, "result column");
		exact(column, ["key", "codec", "nullable"], "result column keys");
		if (typeof column.nullable !== "boolean")
			throw new TypeError("invalid PostgreSQL Mutation result nullability");
		return Object.freeze({
			key: text(column.key, "result column key"),
			codec: text(column.codec, "result column codec"),
			nullable: column.nullable,
		});
	});
	const normalizedContract = {
		parameterCount,
		command,
		affectedRows: [affectedMinimum, affectedMaximum],
		returnedRows: [returnedMinimum, returnedMaximum],
		columns,
	};
	if (JSON.stringify(normalizedContract) !== JSON.stringify(contract))
		throw new TypeError("invalid PostgreSQL Mutation fixed result contract");
	placeholders(statementText, parameterCount);
	const statement = definePostgresStatement({
		name: identity,
		text: statementText,
		parameterCount,
		parameters(input) {
			if (!Array.isArray(input) || input.length !== parameterCount)
				throw new TypeError("invalid PostgreSQL Mutation parameters");
			return Object.freeze([...input]);
		},
		decode(output) {
			if (
				output.command !== command ||
				output.rowCount === null ||
				output.rowCount < affectedMinimum ||
				output.rowCount > affectedMaximum ||
				output.rows.length < returnedMinimum ||
				output.rows.length > returnedMaximum ||
				(columns.length > 0 && output.rowCount !== output.rows.length)
			)
				throw new TypeError("invalid PostgreSQL Mutation result shape");
			return Object.freeze(
				output.rows.map((row) => {
					if (row.length !== columns.length)
						throw new TypeError("invalid PostgreSQL Mutation result width");
					return Object.freeze(
						Object.fromEntries(
							columns.map((column, index) => [
								column.key,
								decodeScalar(row[index], column.codec, column.nullable),
							]),
						),
					);
				}),
			);
		},
	});
	return Object.freeze({ identity, statement });
}

export function linkPostgresMutationTransactionStatements(
	input: Readonly<{
		artifact: string;
		expectedDigest: string;
	}>,
): LinkedPostgresMutationTransactionStatements {
	const decoded = record(JSON.parse(input.artifact), "statements artifact");
	exact(
		decoded,
		["format", "version", "statements", "digest"],
		"statements artifact keys",
	);
	const rawStatements = array(decoded.statements, "statements");
	const actualIdentities = rawStatements.map((value) =>
		text(record(value, "statement").identity, "statement identity"),
	);
	if (
		actualIdentities.length !== expectedIdentities.length ||
		expectedIdentities.some(
			(identity, index) => actualIdentities[index] !== identity,
		)
	)
		throw new TypeError(
			"invalid PostgreSQL Mutation complete fixed statement set",
		);
	const unsigned = {
		format: decoded.format,
		version: decoded.version,
		statements: rawStatements,
	};
	if (
		decoded.format !== "questpie.postgres-mutation-transaction-statements" ||
		decoded.version !== 1 ||
		decoded.digest !== input.expectedDigest ||
		runtimeArtifactDigest(
			"questpie-postgres-mutation-transaction-statements-v1",
			unsigned,
		) !== decoded.digest
	)
		throw new TypeError("invalid PostgreSQL Mutation statements digest");
	const linked = Object.freeze(
		rawStatements.map((statement, index) =>
			linkStatement(statement, statementContracts[expectedIdentities[index]!]!),
		),
	);
	const byIdentity = new Map(linked.map((entry) => [entry.identity, entry]));
	return Object.freeze({
		statements: linked,
		get: (identity: string) => byIdentity.get(identity),
	});
}
