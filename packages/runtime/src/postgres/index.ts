import { createHash } from "node:crypto";

import { Client, Pool, type PoolClient } from "pg";

import { canonicalJsonLine } from "../canonical-json";
import {
	QuestpiePostgresError,
	statementBrand,
	transactionBrand,
	type MigrationPostgres,
	type MigrationPostgresSession,
	type PostgresControl,
	type PostgresDatabase,
	type PostgresDatabaseConfiguration,
	type PostgresJsonValue,
	type PostgresParameter,
	type PostgresStatement,
	type PostgresTransaction,
	type PostgresTransactionMode,
} from "./contract";

export * from "./contract";

export { createPostgresListener, definePostgresChannel } from "./listener";
export type {
	PostgresChannel,
	PostgresListener,
	PostgresReconcileReason,
} from "./listener";
export { createRuntimePostgres } from "./runtime";
export type { RuntimePostgres } from "./runtime";

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
		input.connectionUrl.length === 0 ||
		typeof input.directConnectionUrl !== "string" ||
		input.directConnectionUrl.length === 0
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

function isPoolTimeout(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message === "timeout exceeded when trying to connect"
	);
}

function checkout(pool: Pool, signal?: AbortSignal): Promise<PoolClient> {
	signal?.throwIfAborted();
	const pending = pool.connect();
	if (!signal) return pending;
	return new Promise((resolve, reject) => {
		let settled = false;
		const aborted = () => {
			if (settled) return;
			settled = true;
			void pending.then((client) => client.release()).catch(() => {});
			reject(
				new QuestpiePostgresError({
					code: "cancelled",
					phase: "checkout",
					cause: signal.reason,
				}),
			);
		};
		signal.addEventListener("abort", aborted, { once: true });
		void pending.then(
			(client) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", aborted);
				resolve(client);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", aborted);
				reject(error);
			},
		);
		if (signal.aborted) aborted();
	});
}

async function withSignal<Value>(
	work: Promise<Value>,
	signal: AbortSignal,
): Promise<Value> {
	signal.throwIfAborted();
	let abort: (() => void) | undefined;
	const stopped = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
	try {
		return await Promise.race([work, stopped]);
	} finally {
		if (abort) signal.removeEventListener("abort", abort);
	}
}

const CANCEL_GRACE_MS = 250;

async function cancelBackend(
	connectionUrl: string,
	pid: number,
): Promise<boolean> {
	const client = new Client({
		connectionString: connectionUrl,
		connectionTimeoutMillis: CANCEL_GRACE_MS,
	});
	const timer = setTimeout(
		() => void client.end().catch(() => {}),
		CANCEL_GRACE_MS,
	);
	try {
		await client.connect();
		const result = await client.query({
			text: "SELECT pg_catalog.pg_cancel_backend($1::integer)",
			values: [pid],
			rowMode: "array",
		});
		return result.rows[0]?.[0] === true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
		await client.end().catch(() => {});
	}
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

async function executeStatement<Input, Output>(
	input: Readonly<{
		client: PoolClient | Client;
		statement: PostgresStatement<Input, Output>;
		value: Input;
		active: () => boolean;
		signal?: AbortSignal;
	}>,
): Promise<Output> {
	if (!input.active())
		throw new QuestpiePostgresError({ code: "closed", phase: "statement" });
	input.signal?.throwIfAborted();
	const values = input.statement.parameters(input.value);
	if (values.length !== input.statement.parameterCount)
		throw new QuestpiePostgresError({
			code: "invalidResult",
			phase: "statement",
			statementName: input.statement.name,
		});
	try {
		const result = await input.client.query({
			text: input.statement.text,
			values: values.map(parameter),
			rowMode: "array",
		});
		try {
			return input.statement.decode({
				command: result.command,
				rowCount: result.rowCount,
				rows: result.rows as unknown as readonly (readonly unknown[])[],
			});
		} catch (error) {
			throw new QuestpiePostgresError({
				code: "invalidResult",
				phase: "statement",
				statementName: input.statement.name,
				cause: error,
			});
		}
	} catch (error) {
		throw failure({
			error,
			phase: "statement",
			statementName: input.statement.name,
			signal: input.signal,
		});
	}
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
	const counters = {
		checkoutTimeouts: 0,
		statementTimeouts: 0,
		cancellations: 0,
		destroyedConnections: 0,
	};
	const shutdown = new AbortController();
	let closing: Promise<void> | undefined;

	const executeTransaction: PostgresDatabase["transaction"] = async (input) => {
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
				? shutdown.signal
				: AbortSignal.any([...signals, shutdown.signal]);
		signal.throwIfAborted();
		let client: PoolClient;
		try {
			client = await checkout(pool, signal);
		} catch (error) {
			if (isPoolTimeout(error))
				throw new QuestpiePostgresError({
					code:
						pool.totalCount >= configuration.pool.max
							? "checkoutTimeout"
							: "connectTimeout",
					phase: "checkout",
					cause: error,
				});
			throw failure({ error, phase: "checkout", signal });
		}
		const clientError = () => {};
		client.on("error", clientError);
		inFlight += 1;
		let destroyed = false;
		let destruction: Promise<void> | undefined;
		let cancellation: Promise<void> | undefined;
		let backendPid: number | undefined;
		let active = true;
		let commitSent = false;
		const destroy = () => {
			if (destruction) return destruction;
			destroyed = true;
			counters.destroyedConnections += 1;
			destruction = new Promise((resolve) => client.once("end", resolve));
			client.release(true);
			return destruction;
		};
		const cancel = () => {
			if (cancellation) return;
			counters.cancellations += 1;
			cancellation =
				backendPid === undefined
					? destroy()
					: cancelBackend(configuration.directConnectionUrl, backendPid).then(
							(cancelled) => (cancelled ? undefined : destroy()),
						);
		};
		signal?.addEventListener("abort", cancel, { once: true });
		const execute: PostgresTransaction["execute"] = async (statement, value) =>
			executeStatement({
				client,
				statement,
				value,
				active: () => active,
				signal,
			});
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
				const setup = await client.query({
					text: `SELECT
	pg_catalog.set_config('statement_timeout', $1, true),
	pg_catalog.set_config('lock_timeout', $2, true),
	pg_catalog.set_config('idle_in_transaction_session_timeout', $3, true),
	pg_catalog.pg_backend_pid()`,
					values: [
						`${statementMs}ms`,
						`${lockMs}ms`,
						`${configuration.timeouts.idleInTransactionMs}ms`,
					],
					rowMode: "array",
				});
				const pid = setup.rows[0]?.[3];
				if (typeof pid !== "number")
					throw new QuestpiePostgresError({
						code: "invalidResult",
						phase: "begin",
					});
				backendPid = pid;
			} catch (error) {
				await rollback();
				throw failure({ error, phase: "begin", signal });
			}
			try {
				const output = await withSignal(input.use(handle), signal);
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
					await destroy();
					throw failure({ error, phase: "commit", commitSent: true, signal });
				}
				return output;
			} catch (error) {
				active = false;
				await rollback();
				if (signal.aborted)
					throw failure({ error, phase: "statement", signal });
				throw error;
			}
		} finally {
			active = false;
			signal?.removeEventListener("abort", cancel);
			if (cancellation) await cancellation;
			if (destroyed) await destruction;
			client.removeListener("error", clientError);
			if (!destroyed) client.release();
			inFlight -= 1;
		}
	};
	const transaction: PostgresDatabase["transaction"] = async (input) => {
		try {
			return await executeTransaction(input);
		} catch (error) {
			if (error instanceof QuestpiePostgresError) {
				if (error.code === "checkoutTimeout") counters.checkoutTimeouts += 1;
				if (error.code === "statementTimeout") counters.statementTimeouts += 1;
			}
			throw error;
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
				counters: Object.freeze({ ...counters }),
			});
		},
		close(input: Readonly<{ deadlineAt: number }>) {
			if (closing) return closing;
			state = "draining";
			closing = (async () => {
				const ended = pool.end();
				const remaining = Math.max(0, input.deadlineAt - Date.now());
				let timer: ReturnType<typeof setTimeout> | undefined;
				const graceful = await Promise.race([
					ended.then(() => true),
					new Promise<false>((resolve) => {
						timer = setTimeout(() => resolve(false), remaining);
					}),
				]);
				if (timer) clearTimeout(timer);
				if (!graceful)
					shutdown.abort(
						new QuestpiePostgresError({
							code: "closed",
							phase: "shutdown",
						}),
					);
				await ended;
				state = "closed";
			})();
			return closing;
		},
	});
}

function migrationLockKey(application: string): bigint {
	return createHash("sha256")
		.update(`questpie-migration\0${application}`)
		.digest()
		.readBigInt64BE(0);
}

async function clientPid(client: Client): Promise<number> {
	const result = await client.query<{ pid: number }>(
		"SELECT pg_catalog.pg_backend_pid() AS pid",
	);
	const pid = result.rows[0]?.pid;
	if (typeof pid !== "number" || !Number.isSafeInteger(pid))
		throw new QuestpiePostgresError({
			code: "sessionNotAffine",
			phase: "statement",
		});
	return pid;
}

export function createMigrationPostgres(
	input: Readonly<{
		directConnectionUrl: string;
		timeouts: PostgresDatabaseConfiguration["timeouts"];
	}>,
): MigrationPostgres {
	if (
		typeof input.directConnectionUrl !== "string" ||
		input.directConnectionUrl.length === 0
	)
		throw new QuestpiePostgresError({
			code: "configuration",
			phase: "connect",
		});
	positiveInteger(input.timeouts.statementMs);
	positiveInteger(input.timeouts.lockMs);
	positiveInteger(input.timeouts.idleInTransactionMs);

	return Object.freeze({
		async run<Output>(
			runInput: Readonly<{
				application: string;
				control?: PostgresControl;
				use(session: MigrationPostgresSession): Promise<Output>;
			}>,
		): Promise<Output> {
			if (
				!/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/u.test(
					runInput.application,
				)
			)
				throw new QuestpiePostgresError({
					code: "configuration",
					phase: "connect",
				});
			runInput.control?.signal?.throwIfAborted();
			const client = new Client({
				connectionString: input.directConnectionUrl,
				application_name: "questpie-migration",
				connectionTimeoutMillis: 1_000,
			});
			await client.connect();
			let locked = false;
			let open = true;
			let transactionActive = false;
			try {
				const firstPid = await clientPid(client);
				await client.query("BEGIN");
				const committedPid = await clientPid(client);
				await client.query("COMMIT");
				if (committedPid !== firstPid || (await clientPid(client)) !== firstPid)
					throw new QuestpiePostgresError({
						code: "sessionNotAffine",
						phase: "statement",
					});
				await client.query({
					text: "SELECT pg_catalog.set_config('lock_timeout', $1, false)",
					values: [
						`${effectiveTimeout(runInput.control?.lockTimeoutMs, input.timeouts.lockMs)}ms`,
					],
				});
				let lockCancellation: Promise<void> | undefined;
				const cancelLock = () => {
					if (lockCancellation) return;
					lockCancellation = cancelBackend(
						input.directConnectionUrl,
						firstPid,
					).then(async (cancelled) => {
						if (!cancelled) await client.end().catch(() => {});
					});
				};
				runInput.control?.signal?.addEventListener("abort", cancelLock, {
					once: true,
				});
				if (runInput.control?.signal?.aborted) cancelLock();
				try {
					await client.query({
						text: "SELECT pg_catalog.pg_advisory_lock($1::bigint)",
						values: [migrationLockKey(runInput.application)],
					});
				} catch (error) {
					throw failure({
						error,
						phase: "statement",
						signal: runInput.control?.signal,
					});
				} finally {
					runInput.control?.signal?.removeEventListener("abort", cancelLock);
					if (lockCancellation) await lockCancellation;
				}
				locked = true;
				const expectedPid = await clientPid(client);
				const session = Object.freeze({
					async transaction<Value>(
						transactionInput: Readonly<{
							mode: PostgresTransactionMode;
							use(transaction: PostgresTransaction): Promise<Value>;
						}>,
					): Promise<Value> {
						if (!open || transactionActive)
							throw new QuestpiePostgresError({
								code: "closed",
								phase: "begin",
							});
						transactionActive = true;
						let active = true;
						let commitSent = false;
						const execute: PostgresTransaction["execute"] = (
							statement,
							value,
						) =>
							executeStatement({
								client,
								statement,
								value,
								active: () => active,
								signal: runInput.control?.signal,
							});
						const handle = Object.freeze({
							[transactionBrand]: true as const,
							execute,
						});
						try {
							if ((await clientPid(client)) !== expectedPid)
								throw new QuestpiePostgresError({
									code: "sessionNotAffine",
									phase: "begin",
								});
							await client.query(begin(transactionInput.mode));
							await client.query({
								text: `SELECT
	pg_catalog.set_config('statement_timeout', $1, true),
	pg_catalog.set_config('lock_timeout', $2, true),
	pg_catalog.set_config('idle_in_transaction_session_timeout', $3, true)`,
								values: [
									`${input.timeouts.statementMs}ms`,
									`${input.timeouts.lockMs}ms`,
									`${input.timeouts.idleInTransactionMs}ms`,
								],
							});
							const output = await transactionInput.use(handle);
							active = false;
							runInput.control?.signal?.throwIfAborted();
							if ((await clientPid(client)) !== expectedPid)
								throw new QuestpiePostgresError({
									code: "sessionNotAffine",
									phase: "commit",
								});
							commitSent = true;
							await client.query("COMMIT");
							if ((await clientPid(client)) !== expectedPid)
								throw new QuestpiePostgresError({
									code: "sessionNotAffine",
									phase: "commit",
								});
							return output;
						} catch (error) {
							active = false;
							if (!commitSent) await client.query("ROLLBACK").catch(() => {});
							if (commitSent)
								throw failure({ error, phase: "commit", commitSent: true });
							throw error;
						} finally {
							active = false;
							transactionActive = false;
						}
					},
				});
				return await runInput.use(session);
			} finally {
				open = false;
				if (locked)
					await client
						.query({
							text: "SELECT pg_catalog.pg_advisory_unlock($1::bigint)",
							values: [migrationLockKey(runInput.application)],
						})
						.catch(() => {});
				await client.end().catch(() => {});
			}
		},
	});
}
