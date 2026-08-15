import type { SQL } from "bun";

type PostgresQueryRow = Readonly<Record<string, unknown>>;

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

export async function executePostgresStatement(
	sql: SQL,
	input: Readonly<{
		statement: string;
		parameters: readonly unknown[];
		signal?: AbortSignal;
	}>,
): Promise<readonly PostgresQueryRow[]> {
	const pool = sql as unknown as BunSqlPool;
	input.signal?.throwIfAborted();
	const transaction = await reserveConnection(pool);
	let rows: readonly PostgresQueryRow[];
	try {
		await executeControl(
			transaction,
			"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
		);
		input.signal?.throwIfAborted();
		rows = await executeAbortable(
			transaction.unsafe(input.statement, input.parameters),
			input.signal,
			async () => {
				await transaction.close({ timeout: 0 });
			},
		);
		input.signal?.throwIfAborted();
		await executeControl(transaction, "COMMIT");
	} catch (error) {
		try {
			await executeControl(transaction, "ROLLBACK");
		} catch {
			// A disconnected reservation is already rolled back by PostgreSQL.
		}
		try {
			await transaction.release();
		} catch {
			// A disconnected Bun reservation may reject release; preserve the query failure.
		}
		throw error;
	}
	await transaction.release();
	return rows;
}

export async function executePostgresKeyedOutcome(
	sql: SQL,
	input: Readonly<{
		statement: string;
		parameters: readonly unknown[];
		signal?: AbortSignal;
	}>,
): Promise<"found" | "notFound"> {
	const rows = await executePostgresStatement(sql, input);
	const outcome = rows[0]?.qp_key_outcome;
	if (
		rows.length !== 1 ||
		(outcome !== "found" && outcome !== "notFound") ||
		Object.keys(rows[0] ?? {}).length !== 1
	)
		throw new TypeError("invalid PostgreSQL keyed nondisclosure outcome");
	return outcome;
}
