import type {
	DefinePostgresStatement,
	DefinePostgresAdministrativeStatement,
	PostgresDatabaseOperation,
	PostgresFailureCode,
	PostgresErrorPhase,
	PostgresRetryDisposition,
	PostgresStatement,
	PostgresStatementOperation,
	statementBrand as statementBrandType,
	transactionBrand as transactionBrandType,
} from "./contract-types";

export type {
	MigrationPostgres,
	MigrationPostgresSession,
	PostgresControl,
	PostgresDatabase,
	PostgresDatabaseConfiguration,
	PostgresFailureCode,
	PostgresJson,
	PostgresJsonValue,
	PostgresParameter,
	PostgresDatabaseOperation,
	PostgresStatement,
	PostgresStatementOperation,
	PostgresTransaction,
	PostgresTransactionMode,
	PostgresTransactionRunner,
} from "./contract-types";

export const statementBrand: typeof statementBrandType = Symbol(
	"questpie.postgres.statement",
) as typeof statementBrandType;
export const transactionBrand: typeof transactionBrandType = Symbol(
	"questpie.postgres.transaction",
) as typeof transactionBrandType;

const databaseOperations = new Set<PostgresDatabaseOperation>([
	"SELECT",
	"INSERT",
	"UPDATE",
	"DELETE",
	"CALL",
]);

function statementName(value: string): boolean {
	return /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value);
}

function defineStatement<
	Input,
	Output,
	Operation extends PostgresStatementOperation,
>(
	input: Omit<
		PostgresStatement<Input, Output, Operation>,
		typeof statementBrand
	>,
): PostgresStatement<Input, Output, Operation> {
	if (!statementName(input.name))
		throw new TypeError("invalid PostgreSQL statement name");
	if (typeof input.text !== "string" || input.text.trim().length === 0)
		throw new TypeError("invalid PostgreSQL statement text");
	if (!Number.isSafeInteger(input.parameterCount) || input.parameterCount < 0)
		throw new TypeError("invalid PostgreSQL statement parameter count");
	return Object.freeze({ ...input, [statementBrand]: true as const });
}

export const definePostgresStatement: DefinePostgresStatement = (input) => {
	if (!databaseOperations.has(input.operation))
		throw new TypeError("invalid PostgreSQL statement operation");
	return defineStatement(input);
};

export const definePostgresAdministrativeStatement: DefinePostgresAdministrativeStatement =
	(input) => defineStatement({ ...input, operation: "administrative" });

export class QuestpiePostgresError extends Error {
	readonly code: PostgresFailureCode;
	readonly phase: PostgresErrorPhase;
	readonly statementName?: string;
	readonly sqlState?: string;
	readonly retry: PostgresRetryDisposition;

	constructor(
		input: Readonly<{
			code: PostgresFailureCode;
			phase: PostgresErrorPhase;
			statementName?: string;
			sqlState?: string;
			retry?: PostgresRetryDisposition;
			cause?: unknown;
		}>,
	) {
		super(`PostgreSQL ${input.code}`, { cause: input.cause });
		this.name = "QuestpiePostgresError";
		this.code = input.code;
		this.phase = input.phase;
		this.statementName = input.statementName;
		this.sqlState = input.sqlState;
		this.retry = input.retry ?? "never";
	}
}
