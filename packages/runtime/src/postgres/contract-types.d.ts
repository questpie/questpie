export declare const statementBrand: unique symbol;
export declare const transactionBrand: unique symbol;

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

export interface DefinePostgresStatement {
	<Input, Output>(
		input: Readonly<{
			name: string;
			text: string;
			parameterCount: number;
			parameters(input: Input): readonly PostgresParameter[];
			decode: PostgresStatement<Input, Output>["decode"];
		}>,
	): PostgresStatement<Input, Output>;
}

export declare const definePostgresStatement: DefinePostgresStatement;

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

export type PostgresErrorPhase =
	| "connect"
	| "checkout"
	| "begin"
	| "statement"
	| "commit"
	| "rollback"
	| "listen"
	| "reconcile"
	| "shutdown";

export type PostgresRetryDisposition =
	| "never"
	| "safeBeforeCommit"
	| "callerMustResolveCommit";

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

export type PostgresTransactionRunner = Pick<PostgresDatabase, "transaction">;

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
