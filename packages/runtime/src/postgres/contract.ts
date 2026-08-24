import type {
	DefinePostgresStatement,
	PostgresFailureCode,
	PostgresErrorPhase,
	PostgresRetryDisposition,
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
	PostgresStatement,
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

function statementName(value: string): boolean {
	return /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value);
}

export const definePostgresStatement: DefinePostgresStatement = (input) => {
	if (!statementName(input.name))
		throw new TypeError("invalid PostgreSQL statement name");
	if (typeof input.text !== "string" || input.text.trim().length === 0)
		throw new TypeError("invalid PostgreSQL statement text");
	if (!Number.isSafeInteger(input.parameterCount) || input.parameterCount < 0)
		throw new TypeError("invalid PostgreSQL statement parameter count");
	return Object.freeze({ ...input, [statementBrand]: true as const });
};

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
