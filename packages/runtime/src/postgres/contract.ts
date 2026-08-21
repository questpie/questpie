export const statementBrand: unique symbol = Symbol(
	"questpie.postgres.statement",
);
export const transactionBrand: unique symbol = Symbol(
	"questpie.postgres.transaction",
);

export type PostgresJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly PostgresJsonValue[]
	| Readonly<{ [key: string]: PostgresJsonValue }>;

export type PostgresJson = Readonly<{
	kind: "json";
	value: PostgresJsonValue;
}>;

export type PostgresParameter =
	| null
	| boolean
	| number
	| bigint
	| string
	| Date
	| Uint8Array
	| readonly PostgresParameter[]
	| PostgresJson;

export type PostgresStatement<Input, Output> = Readonly<{
	name: string;
	text: string;
	parameterCount: number;
	parameters(input: Input): readonly PostgresParameter[];
	decode(
		result: Readonly<{
			command: string;
			rowCount: number | null;
			rows: readonly (readonly unknown[])[];
		}>,
	): Output;
	readonly [statementBrand]: true;
}>;

export type PostgresTransactionMode = Readonly<{
	isolation: "readCommitted" | "repeatableRead" | "serializable";
	access: "readOnly" | "readWrite";
	deferrable?: boolean;
}>;

export type PostgresControl = Readonly<{
	signal?: AbortSignal;
	deadlineAt?: number;
	statementTimeoutMs?: number;
	lockTimeoutMs?: number;
}>;

export interface PostgresTransaction {
	readonly [transactionBrand]: true;
	execute<Input, Output>(
		statement: PostgresStatement<Input, Output>,
		input: Input,
	): Promise<Output>;
}

export type PostgresFailureCode =
	| "configuration"
	| "closed"
	| "draining"
	| "connectTimeout"
	| "checkoutTimeout"
	| "statementTimeout"
	| "lockTimeout"
	| "cancelled"
	| "connectionLost"
	| "queryFailed"
	| "serializationFailure"
	| "deadlock"
	| "constraint"
	| "invalidResult"
	| "sessionNotAffine"
	| "commitOutcomeUnknown";

export class QuestpiePostgresError extends Error {
	readonly code: PostgresFailureCode;
	readonly phase:
		| "connect"
		| "checkout"
		| "begin"
		| "statement"
		| "commit"
		| "rollback"
		| "listen"
		| "reconcile"
		| "shutdown";
	readonly statementName?: string;
	readonly sqlState?: string;
	readonly retry: "never" | "safeBeforeCommit" | "callerMustResolveCommit";

	constructor(
		input: Readonly<{
			code: PostgresFailureCode;
			phase: QuestpiePostgresError["phase"];
			statementName?: string;
			sqlState?: string;
			retry?: QuestpiePostgresError["retry"];
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

export type PostgresDatabaseConfiguration = Readonly<{
	connectionUrl: string;
	directConnectionUrl: string;
	pool: Readonly<{
		max: number;
		connectTimeoutMs: number;
		checkoutTimeoutMs: number;
		idleTimeoutMs: number;
		maxLifetimeSeconds: number;
	}>;
	timeouts: Readonly<{
		statementMs: number;
		lockMs: number;
		idleInTransactionMs: number;
	}>;
}>;

export interface PostgresDatabase {
	transaction<Output>(
		input: Readonly<{
			mode: PostgresTransactionMode;
			control?: PostgresControl;
			use(transaction: PostgresTransaction): Promise<Output>;
		}>,
	): Promise<Output>;
	facts(): Readonly<{
		state: "ready" | "draining" | "closed";
		pool: Readonly<{
			max: number;
			total: number;
			idle: number;
			waiting: number;
			inFlight: number;
		}>;
		counters: Readonly<{
			checkoutTimeouts: number;
			statementTimeouts: number;
			cancellations: number;
			destroyedConnections: number;
		}>;
	}>;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

export interface MigrationPostgresSession {
	transaction<Value>(
		input: Readonly<{
			mode: PostgresTransactionMode;
			use(transaction: PostgresTransaction): Promise<Value>;
		}>,
	): Promise<Value>;
}

export interface MigrationPostgres {
	run<Output>(
		input: Readonly<{
			application: string;
			control?: PostgresControl;
			use(session: MigrationPostgresSession): Promise<Output>;
		}>,
	): Promise<Output>;
}
