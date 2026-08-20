import { expect, test } from "bun:test";

import {
	createPostgresDatabase,
	createPostgresListener,
	createMigrationPostgres,
	definePostgresChannel,
	definePostgresStatement,
	type MigrationPostgresSession,
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

const notify = definePostgresStatement({
	name: "pb03.notify",
	text: "SELECT pg_catalog.pg_notify($1::text, $2::text)",
	parameterCount: 2,
	parameters: (input: Readonly<{ channel: string; payload: string }>) => [
		input.channel,
		input.payload,
	],
	decode: () => undefined,
});

const terminateListener = definePostgresStatement({
	name: "pb03.terminate-listener",
	text: `SELECT coalesce(
	pg_catalog.bool_or(pg_catalog.pg_terminate_backend(pid)),
	false
)
FROM pg_catalog.pg_stat_activity
WHERE application_name = $1::text
	AND pid <> pg_catalog.pg_backend_pid()`,
	parameterCount: 1,
	parameters: (applicationName: string) => [applicationName],
	decode(result) {
		if (result.rows.length !== 1 || typeof result.rows[0]?.[0] !== "boolean")
			throw new TypeError("listener termination result is invalid");
		return result.rows[0][0];
	},
});

const createMigrationProbe = definePostgresStatement({
	name: "pb03.migration-probe-create",
	text: "CREATE TEMP TABLE qp_pb03_migration_probe (value text) ON COMMIT PRESERVE ROWS",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const insertMigrationProbe = definePostgresStatement({
	name: "pb03.migration-probe-insert",
	text: "INSERT INTO qp_pb03_migration_probe (value) VALUES ($1::text)",
	parameterCount: 1,
	parameters: (value: string) => [value],
	decode: () => undefined,
});

const observeMigrationSession = definePostgresStatement({
	name: "pb03.migration-session-observe",
	text: `SELECT
	pg_catalog.pg_backend_pid(),
	EXISTS (
		SELECT 1 FROM pg_catalog.pg_locks
		WHERE locktype = 'advisory'
			AND pid = pg_catalog.pg_backend_pid()
			AND granted
	),
	ARRAY(SELECT value FROM qp_pb03_migration_probe ORDER BY value)`,
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const row = result.rows[0];
		if (
			result.rows.length !== 1 ||
			typeof row?.[0] !== "number" ||
			typeof row[1] !== "boolean" ||
			!Array.isArray(row[2])
		)
			throw new TypeError("migration session observation is invalid");
		return { pid: row[0], locked: row[1], values: row[2] };
	},
});

function database() {
	return createPostgresDatabase({
		connectionUrl: postgresUrl(),
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
}

postgresTest(
	"executes a decoded static statement in one bounded transaction",
	async () => {
		const postgres = database();
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

postgresTest(
	"pins separately committed migration transactions under one application lock",
	async () => {
		const migration = createMigrationPostgres({
			directConnectionUrl: postgresUrl(),
			timeouts: {
				statementMs: 1_000,
				lockMs: 500,
				idleInTransactionMs: 1_000,
			},
		});
		let expiredSession: MigrationPostgresSession | undefined;
		const observations = await migration.run({
			application: "pb03MigrationProbe",
			use: async (session) => {
				expiredSession = session;
				const first = await session.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: async (transaction) => {
						await transaction.execute(createMigrationProbe, undefined);
						await transaction.execute(insertMigrationProbe, "committed");
						return transaction.execute(observeMigrationSession, undefined);
					},
				});
				const second = await session.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: (transaction) =>
						transaction.execute(observeMigrationSession, undefined),
				});
				return [first, second] as const;
			},
		});

		expect(observations[0]).toEqual(observations[1]);
		expect(observations[0]).toEqual({
			pid: expect.any(Number),
			locked: true,
			values: ["committed"],
		});
		await expect(
			expiredSession!.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: () => Promise.resolve(),
			}),
		).rejects.toMatchObject({ code: "closed" });

		const applicationFailure = new Error("migration callback failed");
		await expect(
			migration.run({
				application: "pb03MigrationFailure",
				use: () => Promise.reject(applicationFailure),
			}),
		).rejects.toBe(applicationFailure);
		await expect(
			migration.run({
				application: "pb03MigrationFailure",
				use: () => Promise.resolve("lock-released"),
			}),
		).resolves.toBe("lock-released");
	},
);

postgresTest(
	"commits LISTEN before reconciling and treats NOTIFY as a hint",
	async () => {
		const postgres = database();
		const channel = definePostgresChannel("qp_pb03_wake");
		const reasons: string[] = [];
		let notified: (() => void) | undefined;
		let reconnected: (() => void) | undefined;
		const notification = new Promise<void>((resolve) => {
			notified = resolve;
		});
		const reconnection = new Promise<void>((resolve) => {
			reconnected = resolve;
		});
		const listener = await createPostgresListener({
			directConnectionUrl: postgresUrl(),
			channel,
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				reasons.push(reason);
				if (reason === "notification") notified?.();
				if (reason === "reconnect") setTimeout(() => reconnected?.(), 0);
			},
		});
		try {
			expect(reasons).toEqual(["startup"]);
			await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: (transaction) =>
					transaction.execute(notify, {
						channel,
						payload: "ignored-domain-data",
					}),
			});
			await Promise.race([
				notification,
				new Promise<never>((_resolve, reject) =>
					setTimeout(
						() => reject(new Error("notification was not reconciled")),
						500,
					),
				),
			]);
			expect(reasons).toEqual(["startup", "notification"]);
			expect(listener.facts()).toMatchObject({
				state: "healthy",
				reconnects: 0,
			});

			await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					expect(
						await transaction.execute(
							terminateListener,
							"questpie-realtime-listener",
						),
					).toBe(true);
				},
			});
			await Promise.race([
				reconnection,
				new Promise<never>((_resolve, reject) =>
					setTimeout(
						() => reject(new Error("listener did not reconnect")),
						1_000,
					),
				),
			]);
			expect(reasons).toContain("reconnect");
			expect(listener.facts()).toMatchObject({
				state: "healthy",
				reconnects: 1,
			});
		} finally {
			await listener.close({ deadlineAt: Date.now() + 1_000 });
			await postgres.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);
