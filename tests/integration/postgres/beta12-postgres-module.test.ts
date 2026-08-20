import { expect, test } from "bun:test";

import {
	createPostgresDatabase,
	definePostgresStatement,
	type PostgresTransaction,
} from "../../../packages/runtime/src/postgres";

const postgresTest = process.env.PGHOST ? test : test.skip;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/postgres");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.href;
}

const observeTransaction = definePostgresStatement({
	name: "pb03.observe-transaction",
	text: `SELECT
	$1::text,
	pg_catalog.current_setting('transaction_isolation'),
	pg_catalog.current_setting('transaction_read_only'),
	pg_catalog.current_setting('statement_timeout')`,
	parameterCount: 1,
	parameters: (value: string) => [value],
	decode(result) {
		if (result.rows.length !== 1 || result.rows[0]?.length !== 4)
			throw new TypeError("unexpected transaction observation");
		return result.rows[0];
	},
});

const sleep = definePostgresStatement({
	name: "pb03.sleep",
	text: "SELECT pg_catalog.pg_sleep($1::double precision)",
	parameterCount: 1,
	parameters: (seconds: number) => [seconds],
	decode: () => undefined,
});

postgresTest(
	"executes a decoded static statement in one bounded transaction",
	async () => {
		const connectionUrl = postgresUrl();
		const postgres = createPostgresDatabase({
			connectionUrl,
			pool: {
				max: 2,
				connectTimeoutMs: 1_000,
				checkoutTimeoutMs: 1_000,
				idleTimeoutMs: 1_000,
				maxLifetimeSeconds: 60,
			},
			timeouts: {
				statementMs: 1_000,
				lockMs: 500,
				idleInTransactionMs: 1_000,
			},
		});
		let expired: PostgresTransaction | undefined;
		try {
			const observed = await postgres.transaction({
				mode: { isolation: "repeatableRead", access: "readOnly" },
				control: { statementTimeoutMs: 250 },
				use: async (transaction) => {
					expired = transaction;
					return transaction.execute(observeTransaction, "bound-value");
				},
			});

			expect(observed).toEqual([
				"bound-value",
				"repeatable read",
				"on",
				"250ms",
			]);
			expect(postgres.facts().pool.inFlight).toBe(0);
			await expect(
				expired!.execute(observeTransaction, "late"),
			).rejects.toMatchObject({ code: "closed" });

			await expect(
				postgres.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					control: { statementTimeoutMs: 25 },
					use: (transaction) => transaction.execute(sleep, 0.25),
				}),
			).rejects.toMatchObject({ code: "statementTimeout", sqlState: "57014" });

			const applicationFailure = new Error("application callback failure");
			await expect(
				postgres.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: () => Promise.reject(applicationFailure),
				}),
			).rejects.toBe(applicationFailure);
		} finally {
			await postgres.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);
