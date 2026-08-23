import type { SQL } from "bun";

import {
	QuestpiePostgresError,
	transactionBrand,
	type PostgresTransactionRunner,
} from "../postgres/contract";

function postgresErrorNumber(error: unknown): string | null {
	if (!error || typeof error !== "object") return null;
	const errno = (error as Readonly<{ errno?: unknown }>).errno;
	return typeof errno === "string" ? errno : null;
}

/** Temporary PB-05 adapter. Generated ownership deletes this with Bun SQL. */
export function createBunDurablePostgresTransactionRunner(
	sql: SQL,
): PostgresTransactionRunner {
	return Object.freeze({
		async transaction(request) {
			if (
				request.mode.isolation !== "readCommitted" ||
				request.mode.deferrable !== undefined
			)
				throw new TypeError(
					"Durable Bun compatibility requires read-committed transactions",
				);
			try {
				return (await sql.begin(async (session) => {
					if (request.mode.access === "readOnly")
						await session.unsafe("SET TRANSACTION READ ONLY");
					return request.use({
						[transactionBrand]: true,
						async execute(statement, value) {
							const rows = (await session
								.unsafe(statement.text, [...statement.parameters(value)])
								.values()) as unknown as readonly (readonly unknown[])[] & {
								count: number;
								command: string;
							};
							return statement.decode({
								command: rows.command,
								rowCount: rows.count,
								rows,
							});
						},
					});
				})) as Awaited<ReturnType<typeof request.use>>;
			} catch (error) {
				if (postgresErrorNumber(error) === "40001")
					throw new QuestpiePostgresError({
						code: "serializationFailure",
						phase: "statement",
						retry: "safeBeforeCommit",
						cause: error,
					});
				throw error;
			}
		},
	});
}
