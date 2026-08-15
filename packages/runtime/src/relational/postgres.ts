import type { SQL } from "bun";

import type {
	PostgresQueryAdapter,
	PostgresQueryRow,
	PostgresQueryTransaction,
} from "./query";

interface AbortableSqlQuery extends PromiseLike<readonly PostgresQueryRow[]> {
	cancel(): AbortableSqlQuery;
	execute(): AbortableSqlQuery;
}

type TransactionSql = Readonly<{
	unsafe(sql: string, parameters?: readonly unknown[]): AbortableSqlQuery;
	close(options: Readonly<{ timeout: 0 }>): Promise<void>;
	release(): void | Promise<void>;
}>;

type BunSqlPool = Readonly<{
	reserve(): Promise<TransactionSql>;
}>;

function isClosedConnection(error: unknown): boolean {
	return (
		!!error &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ERR_POSTGRES_CONNECTION_CLOSED"
	);
}

async function reserveConnection(pool: BunSqlPool): Promise<TransactionSql> {
	try {
		return await pool.reserve();
	} catch (error) {
		if (!isClosedConnection(error)) throw error;
		return pool.reserve();
	}
}

async function executeAbortable(
	query: AbortableSqlQuery,
	signal?: AbortSignal,
	disconnect?: () => Promise<void>,
): Promise<readonly PostgresQueryRow[]> {
	signal?.throwIfAborted();
	const executing = query.execute();
	let disconnecting: Promise<void> | undefined;
	const cancel = () => {
		executing.cancel();
		disconnecting ??= disconnect?.().catch(() => {});
	};
	signal?.addEventListener("abort", cancel, { once: true });
	if (signal?.aborted) cancel();
	try {
		return await executing;
	} finally {
		await disconnecting;
		signal?.removeEventListener("abort", cancel);
	}
}

async function executeControl(
	transaction: TransactionSql,
	statement:
		| "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
		| "COMMIT"
		| "ROLLBACK",
): Promise<void> {
	await transaction.unsafe(statement).execute();
}

export function createBunPostgresQueryAdapter(sql: SQL): PostgresQueryAdapter {
	const pool = sql as unknown as BunSqlPool;
	return Object.freeze({
		transaction: async <Result>(
			options: Readonly<{
				isolationLevel: "repeatable read";
				readOnly: true;
				signal?: AbortSignal;
			}>,
			use: (transaction: PostgresQueryTransaction) => Promise<Result>,
		): Promise<Result> => {
			if (
				options.isolationLevel !== "repeatable read" ||
				options.readOnly !== true
			)
				throw new TypeError(
					"PostgreSQL Query execution requires repeatable-read read-only",
				);
			options.signal?.throwIfAborted();
			const transaction = await reserveConnection(pool);
			let connectionClosed = false;
			try {
				await executeControl(
					transaction,
					"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
				);
				let statements = 0;
				const queryTransaction: PostgresQueryTransaction = Object.freeze({
					query: async (
						statement: string,
						parameters: readonly unknown[],
						queryOptions: Readonly<{ signal?: AbortSignal }>,
					) => {
						if (statements !== 0)
							throw new TypeError(
								"PostgreSQL Query execution requires one statement",
							);
						statements += 1;
						if (queryOptions.signal !== options.signal)
							throw new TypeError(
								"PostgreSQL Query signal must match its transaction",
							);
						options.signal?.throwIfAborted();
						return executeAbortable(
							transaction.unsafe(statement, parameters),
							options.signal,
							async () => {
								connectionClosed = true;
								await transaction.close({ timeout: 0 });
							},
						);
					},
				});
				const result = await use(queryTransaction);
				if (statements !== 1)
					throw new TypeError(
						"PostgreSQL Query execution requires one statement",
					);
				options.signal?.throwIfAborted();
				await executeControl(transaction, "COMMIT");
				return result;
			} catch (error) {
				if (!connectionClosed)
					try {
						await executeControl(transaction, "ROLLBACK");
					} catch {
						// Preserve the application/query failure as the primary error.
					}
				throw error;
			} finally {
				try {
					await transaction.release();
				} catch (error) {
					if (!connectionClosed || !isClosedConnection(error)) throw error;
				}
			}
		},
	});
}
