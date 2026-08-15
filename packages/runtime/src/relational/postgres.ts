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
}>;

type BunSqlPool = Readonly<{
	begin<Result>(
		mode: "isolation level repeatable read read only",
		use: (transaction: TransactionSql) => Promise<Result>,
	): Promise<Result>;
}>;

async function executeAbortable(
	query: AbortableSqlQuery,
	signal?: AbortSignal,
): Promise<readonly PostgresQueryRow[]> {
	signal?.throwIfAborted();
	const executing = query.execute();
	const cancel = () => {
		executing.cancel();
	};
	signal?.addEventListener("abort", cancel, { once: true });
	if (signal?.aborted) cancel();
	try {
		return await executing;
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
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
			return pool.begin(
				"isolation level repeatable read read only",
				async (transaction) => {
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
							);
						},
					});
					const result = await use(queryTransaction);
					if (statements !== 1)
						throw new TypeError(
							"PostgreSQL Query execution requires one statement",
						);
					options.signal?.throwIfAborted();
					return result;
				},
			);
		},
	});
}
