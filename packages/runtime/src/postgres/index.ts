import { Pool, type PoolClient } from "pg";

import { canonicalJsonLine } from "../canonical-json";

export { createPostgresListener, definePostgresChannel } from "./listener";
export type {
	PostgresChannel,
	PostgresListener,
	PostgresReconcileReason,
} from "./listener";

const statementBrand: unique symbol = Symbol("questpie.postgres.statement");
const transactionBrand: unique symbol = Symbol("questpie.postgres.transaction");

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
	}>;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

function positiveInteger(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new QuestpiePostgresError({
			code: "configuration",
			phase: "connect",
		});
}

function validateConfiguration(input: PostgresDatabaseConfiguration): void {
	if (
		typeof input.connectionUrl !== "string" ||
		input.connectionUrl.length === 0
	)
		throw new QuestpiePostgresError({
			code: "configuration",
			phase: "connect",
		});
	positiveInteger(input.pool.max);
	positiveInteger(input.pool.connectTimeoutMs);
	positiveInteger(input.pool.checkoutTimeoutMs);
	positiveInteger(input.pool.idleTimeoutMs);
	positiveInteger(input.pool.maxLifetimeSeconds);
	positiveInteger(input.timeouts.statementMs);
	positiveInteger(input.timeouts.lockMs);
	positiveInteger(input.timeouts.idleInTransactionMs);
}

function statementName(value: string): boolean {
	return /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value);
}

export function definePostgresStatement<Input, Output>(
	input: Readonly<{
		name: string;
		text: string;
		parameterCount: number;
		parameters(input: Input): readonly PostgresParameter[];
		decode: PostgresStatement<Input, Output>["decode"];
	}>,
): PostgresStatement<Input, Output> {
	if (!statementName(input.name))
		throw new TypeError("invalid PostgreSQL statement name");
	if (typeof input.text !== "string" || input.text.trim().length === 0)
		throw new TypeError("invalid PostgreSQL statement text");
	if (!Number.isSafeInteger(input.parameterCount) || input.parameterCount < 0)
		throw new TypeError("invalid PostgreSQL statement parameter count");
	return Object.freeze({ ...input, [statementBrand]: true as const });
}

function jsonText(value: PostgresJsonValue): string {
	const line = new TextDecoder().decode(canonicalJsonLine(value));
	return line.slice(0, -1);
}

function parameter(value: PostgresParameter): unknown {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		typeof value === "string" ||
		value instanceof Date ||
		value instanceof Uint8Array
	)
		return value;
	if (Array.isArray(value)) return value.map(parameter);
	if ("kind" in value && value.kind === "json") return jsonText(value.value);
	throw new TypeError("invalid PostgreSQL parameter");
}

function sqlState(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error))
		return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function failure(
	input: Readonly<{
		error: unknown;
		phase: QuestpiePostgresError["phase"];
		statementName?: string;
		commitSent?: boolean;
		signal?: AbortSignal;
	}>,
): QuestpiePostgresError {
	if (input.error instanceof QuestpiePostgresError) return input.error;
	const state = sqlState(input.error);
	if (input.commitSent)
		return new QuestpiePostgresError({
			code: "commitOutcomeUnknown",
			phase: "commit",
			retry: "callerMustResolveCommit",
			cause: input.error,
		});
	if (input.signal?.aborted)
		return new QuestpiePostgresError({
			code: "cancelled",
			phase: input.phase,
			statementName: input.statementName,
			cause: input.signal.reason,
		});
	const classification =
		state === "57014"
			? "statementTimeout"
			: state === "55P03"
				? "lockTimeout"
				: state === "40001"
					? "serializationFailure"
					: state === "40P01"
						? "deadlock"
						: state?.startsWith("23")
							? "constraint"
							: state?.startsWith("08")
								? "connectionLost"
								: "queryFailed";
	return new QuestpiePostgresError({
		code: classification,
		phase: input.phase,
		statementName: input.statementName,
		sqlState: state,
		retry:
			classification === "serializationFailure" || classification === "deadlock"
				? "safeBeforeCommit"
				: "never",
		cause: input.error,
	});
}

function begin(mode: PostgresTransactionMode): string {
	if (
		mode.deferrable &&
		(mode.isolation !== "serializable" || mode.access !== "readOnly")
	)
		throw new QuestpiePostgresError({ code: "configuration", phase: "begin" });
	const isolation =
		mode.isolation === "readCommitted"
			? "READ COMMITTED"
			: mode.isolation === "repeatableRead"
				? "REPEATABLE READ"
				: "SERIALIZABLE";
	return `BEGIN ISOLATION LEVEL ${isolation} ${mode.access === "readOnly" ? "READ ONLY" : "READ WRITE"}${mode.deferrable ? " DEFERRABLE" : ""}`;
}

function effectiveTimeout(
	candidate: number | undefined,
	maximum: number,
): number {
	if (candidate === undefined) return maximum;
	positiveInteger(candidate);
	return Math.min(candidate, maximum);
}

export function createPostgresDatabase(
	configuration: PostgresDatabaseConfiguration,
): PostgresDatabase {
	validateConfiguration(configuration);
	const pool = new Pool({
		connectionString: configuration.connectionUrl,
		max: configuration.pool.max,
		connectionTimeoutMillis: Math.min(
			configuration.pool.connectTimeoutMs,
			configuration.pool.checkoutTimeoutMs,
		),
		idleTimeoutMillis: configuration.pool.idleTimeoutMs,
		maxLifetimeSeconds: configuration.pool.maxLifetimeSeconds,
	});
	pool.on("error", () => {});
	let state: "ready" | "draining" | "closed" = "ready";
	let inFlight = 0;

	const transaction: PostgresDatabase["transaction"] = async (input) => {
		if (state !== "ready")
			throw new QuestpiePostgresError({ code: state, phase: "checkout" });
		const deadlineSignal =
			input.control?.deadlineAt === undefined
				? undefined
				: AbortSignal.timeout(
						Math.max(0, Math.ceil(input.control.deadlineAt - Date.now())),
					);
		const signals = [input.control?.signal, deadlineSignal].filter(
			(signal): signal is AbortSignal => signal !== undefined,
		);
		const signal =
			signals.length === 0
				? undefined
				: signals.length === 1
					? signals[0]
					: AbortSignal.any(signals);
		signal?.throwIfAborted();
		let client: PoolClient;
		try {
			client = await pool.connect();
		} catch (error) {
			throw failure({ error, phase: "checkout", signal });
		}
		inFlight += 1;
		let destroyed = false;
		let active = true;
		let commitSent = false;
		const destroy = () => {
			if (destroyed) return;
			destroyed = true;
			client.release(true);
		};
		signal?.addEventListener("abort", destroy, { once: true });
		const execute: PostgresTransaction["execute"] = async (
			statement,
			value,
		) => {
			if (!active)
				throw new QuestpiePostgresError({ code: "closed", phase: "statement" });
			signal?.throwIfAborted();
			const values = statement.parameters(value);
			if (values.length !== statement.parameterCount)
				throw new QuestpiePostgresError({
					code: "invalidResult",
					phase: "statement",
					statementName: statement.name,
				});
			try {
				const result = await client.query({
					text: statement.text,
					values: values.map(parameter),
					rowMode: "array",
				});
				try {
					return statement.decode({
						command: result.command,
						rowCount: result.rowCount,
						rows: result.rows as unknown as readonly (readonly unknown[])[],
					});
				} catch (error) {
					throw new QuestpiePostgresError({
						code: "invalidResult",
						phase: "statement",
						statementName: statement.name,
						cause: error,
					});
				}
			} catch (error) {
				throw failure({
					error,
					phase: "statement",
					statementName: statement.name,
					signal,
				});
			}
		};
		const handle = Object.freeze({
			[transactionBrand]: true as const,
			execute,
		});
		const rollback = async (): Promise<void> => {
			if (destroyed || commitSent) return;
			try {
				await client.query("ROLLBACK");
			} catch {
				destroy();
			}
		};
		try {
			try {
				await client.query(begin(input.mode));
			} catch (error) {
				throw failure({ error, phase: "begin", signal });
			}
			const statementMs = effectiveTimeout(
				input.control?.statementTimeoutMs,
				configuration.timeouts.statementMs,
			);
			const lockMs = Math.min(
				effectiveTimeout(
					input.control?.lockTimeoutMs,
					configuration.timeouts.lockMs,
				),
				statementMs,
			);
			try {
				await client.query({
					text: `SELECT
	pg_catalog.set_config('statement_timeout', $1, true),
	pg_catalog.set_config('lock_timeout', $2, true),
	pg_catalog.set_config('idle_in_transaction_session_timeout', $3, true)`,
					values: [
						`${statementMs}ms`,
						`${lockMs}ms`,
						`${configuration.timeouts.idleInTransactionMs}ms`,
					],
				});
			} catch (error) {
				await rollback();
				throw failure({ error, phase: "begin", signal });
			}
			try {
				const output = await input.use(handle);
				active = false;
				try {
					signal?.throwIfAborted();
				} catch (error) {
					await rollback();
					throw failure({ error, phase: "statement", signal });
				}
				commitSent = true;
				try {
					await client.query("COMMIT");
				} catch (error) {
					throw failure({ error, phase: "commit", commitSent: true, signal });
				}
				return output;
			} catch (error) {
				active = false;
				await rollback();
				throw error;
			}
		} finally {
			active = false;
			signal?.removeEventListener("abort", destroy);
			if (!destroyed) client.release();
			inFlight -= 1;
		}
	};

	return Object.freeze({
		transaction,
		facts() {
			return Object.freeze({
				state,
				pool: Object.freeze({
					max: configuration.pool.max,
					total: pool.totalCount,
					idle: pool.idleCount,
					waiting: pool.waitingCount,
					inFlight,
				}),
			});
		},
		async close(input: Readonly<{ deadlineAt: number }>) {
			if (state === "closed") return;
			state = "draining";
			const remaining = Math.max(0, input.deadlineAt - Date.now());
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					pool.end(),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new QuestpiePostgresError({
										code: "closed",
										phase: "shutdown",
									}),
								),
							remaining,
						);
					}),
				]);
				state = "closed";
			} finally {
				if (timer) clearTimeout(timer);
			}
		},
	});
}
