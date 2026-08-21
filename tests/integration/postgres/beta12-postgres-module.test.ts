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

const currentBackendPid = definePostgresStatement({
	name: "pb03.current-backend-pid",
	text: "SELECT pg_catalog.pg_backend_pid()",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const pid = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof pid !== "number")
			throw new TypeError("backend PID result is invalid");
		return pid;
	},
});

const backendIsSleeping = definePostgresStatement({
	name: "pb03.backend-is-sleeping",
	text: `SELECT EXISTS (
	SELECT 1
	FROM pg_catalog.pg_stat_activity
	WHERE pid = $1::integer
		AND state = 'active'
		AND wait_event = 'PgSleep'
)`,
	parameterCount: 1,
	parameters: (pid: number) => [pid],
	decode(result) {
		const active = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof active !== "boolean")
			throw new TypeError("backend activity result is invalid");
		return active;
	},
});

const createCommitProbeTable = definePostgresStatement({
	name: "pb03.commit-probe-table-create",
	text: "CREATE TEMP TABLE qp_pb03_commit_probe (value integer)",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const createCommitDelayFunction = definePostgresStatement({
	name: "pb03.commit-delay-function-create",
	text: `CREATE FUNCTION pg_temp.qp_pb03_commit_delay()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_catalog.pg_sleep(5);
	RETURN NEW;
END
$$`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const createCommitDelayTrigger = definePostgresStatement({
	name: "pb03.commit-delay-trigger-create",
	text: `CREATE CONSTRAINT TRIGGER qp_pb03_commit_delay
AFTER INSERT ON qp_pb03_commit_probe
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION pg_temp.qp_pb03_commit_delay()`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const insertCommitProbe = definePostgresStatement({
	name: "pb03.commit-probe-insert",
	text: "INSERT INTO qp_pb03_commit_probe (value) VALUES (1)",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const backendIsCommitting = definePostgresStatement({
	name: "pb03.backend-is-committing",
	text: `SELECT EXISTS (
	SELECT 1
	FROM pg_catalog.pg_stat_activity
	WHERE pid = $1::integer
		AND state = 'active'
		AND query = 'COMMIT'
		AND wait_event = 'PgSleep'
)`,
	parameterCount: 1,
	parameters: (pid: number) => [pid],
	decode(result) {
		const active = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof active !== "boolean")
			throw new TypeError("commit activity result is invalid");
		return active;
	},
});

const terminateBackend = definePostgresStatement({
	name: "pb03.backend-terminate",
	text: "SELECT pg_catalog.pg_terminate_backend($1::integer)",
	parameterCount: 1,
	parameters: (pid: number) => [pid],
	decode(result) {
		const terminated = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof terminated !== "boolean")
			throw new TypeError("backend termination result is invalid");
		return terminated;
	},
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

function database(
	input: Readonly<{ max?: number; checkoutTimeoutMs?: number }> = {},
) {
	return createPostgresDatabase({
		connectionUrl: postgresUrl(),
		directConnectionUrl: postgresUrl(),
		pool: {
			max: input.max ?? 2,
			connectTimeoutMs: 1_000,
			checkoutTimeoutMs: input.checkoutTimeoutMs ?? 1_000,
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

async function eventually(
	assertion: () => boolean | Promise<boolean>,
	label: string,
): Promise<void> {
	const deadline = Date.now() + 500;
	while (!(await assertion())) {
		if (Date.now() >= deadline) throw new Error(label);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
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
	"bounds a saturated checkout and recovers after release",
	async () => {
		const postgres = database({ max: 1, checkoutTimeoutMs: 50 });
		let entered: (() => void) | undefined;
		let release: (() => void) | undefined;
		const active = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = postgres.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use: async () => {
				entered?.();
				await held;
			},
		});
		await active;
		try {
			await expect(
				postgres.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					use: () => Promise.resolve(),
				}),
			).rejects.toMatchObject({ code: "checkoutTimeout", phase: "checkout" });
		} finally {
			release?.();
			await first;
		}
		await expect(
			postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("recovered"),
			}),
		).resolves.toBe("recovered");
		expect(postgres.facts().pool).toMatchObject({ inFlight: 0, waiting: 0 });
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest(
	"cancels a queued checkout without leaking its later client",
	async () => {
		const postgres = database({ max: 1, checkoutTimeoutMs: 1_000 });
		let entered: (() => void) | undefined;
		let release: (() => void) | undefined;
		const active = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = postgres.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use: async () => {
				entered?.();
				await held;
			},
		});
		await active;
		const controller = new AbortController();
		const queued = postgres.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			control: { signal: controller.signal },
			use: () => Promise.reject(new Error("cancelled checkout entered SQL")),
		});
		await eventually(
			() => postgres.facts().pool.waiting === 1,
			"checkout never entered the Pool queue",
		);
		controller.abort(new Error("caller stopped waiting"));
		try {
			await expect(queued).rejects.toMatchObject({
				code: "cancelled",
				phase: "checkout",
			});
		} finally {
			release?.();
			await first;
		}
		await eventually(
			() => postgres.facts().pool.waiting === 0,
			"cancelled checkout remained queued",
		);
		await expect(
			postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("recovered"),
			}),
		).resolves.toBe("recovered");
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest(
	"cancels active SQL before safely reusing its connection",
	async () => {
		const postgres = database({ max: 1 });
		const observer = database({ max: 1 });
		const controller = new AbortController();
		let publishPid: ((pid: number) => void) | undefined;
		const observedPid = new Promise<number>((resolve) => {
			publishPid = resolve;
		});
		const running = postgres.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			control: { signal: controller.signal },
			use: async (transaction) => {
				const pid = await transaction.execute(currentBackendPid, undefined);
				publishPid?.(pid);
				await transaction.execute(sleep, 5);
			},
		});
		const pid = await observedPid;
		await eventually(async () => {
			return observer.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) => transaction.execute(backendIsSleeping, pid),
			});
		}, "backend never entered pg_sleep");
		controller.abort(new Error("caller stopped active SQL"));
		await expect(running).rejects.toMatchObject({
			code: "cancelled",
			phase: "statement",
		});
		await eventually(async () => {
			return observer.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async (transaction) =>
					!(await transaction.execute(backendIsSleeping, pid)),
			});
		}, "cancelled backend continued running");
		await expect(
			postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("recovered"),
			}),
		).resolves.toBe("recovered");
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
		await observer.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest(
	"classifies a lost COMMIT response as an unknown outcome",
	async () => {
		const postgres = database({ max: 1 });
		const observer = database({ max: 1 });
		let publishPid: ((pid: number) => void) | undefined;
		const observedPid = new Promise<number>((resolve) => {
			publishPid = resolve;
		});
		const committing = postgres.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				const pid = await transaction.execute(currentBackendPid, undefined);
				await transaction.execute(createCommitProbeTable, undefined);
				await transaction.execute(createCommitDelayFunction, undefined);
				await transaction.execute(createCommitDelayTrigger, undefined);
				await transaction.execute(insertCommitProbe, undefined);
				publishPid?.(pid);
			},
		});
		const outcome = committing.catch((error: unknown) => error);
		const pid = await observedPid;
		await eventually(async () => {
			return observer.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) => transaction.execute(backendIsCommitting, pid),
			});
		}, "backend never entered COMMIT");
		await expect(
			observer.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: (transaction) => transaction.execute(terminateBackend, pid),
			}),
		).resolves.toBe(true);
		await expect(outcome).resolves.toMatchObject({
			code: "commitOutcomeUnknown",
			phase: "commit",
			retry: "callerMustResolveCommit",
		});
		await expect(
			postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("recovered"),
			}),
		).resolves.toBe("recovered");
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
		await observer.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest("forces shutdown at its deadline", async () => {
	const postgres = database({ max: 1 });
	let entered: (() => void) | undefined;
	const active = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const never = new Promise<never>(() => {});
	const running = postgres.transaction({
		mode: { isolation: "readCommitted", access: "readOnly" },
		use: async (transaction) => {
			await transaction.execute(currentBackendPid, undefined);
			entered?.();
			await never;
		},
	});
	const outcome = running.catch((error: unknown) => error);
	await active;
	await expect(
		postgres.close({ deadlineAt: Date.now() + 25 }),
	).resolves.toBeUndefined();
	await expect(outcome).resolves.toMatchObject({
		code: "closed",
		phase: "shutdown",
	});
	expect(postgres.facts()).toMatchObject({
		state: "closed",
		pool: { inFlight: 0, total: 0 },
	});
	await expect(
		postgres.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			use: () => Promise.resolve(),
		}),
	).rejects.toMatchObject({ code: "closed", phase: "checkout" });
});

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
