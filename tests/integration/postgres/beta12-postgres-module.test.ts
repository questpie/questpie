import { expect, test } from "bun:test";

import {
	createPostgresDatabase,
	createPostgresListener,
	createMigrationPostgres,
	createRuntimePostgres,
	definePostgresChannel,
	definePostgresStatement,
	type MigrationPostgresSession,
	type PostgresTransaction,
	QuestpiePostgresError,
} from "../../../packages/runtime/src/postgres";

const postgresTest = process.env.PGHOST ? test : test.skip;
const pgbouncerTest = process.env.PGBOUNCER_PORT ? test : test.skip;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/postgres");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.href;
}

function pgbouncerUrl(): string {
	const url = new URL(postgresUrl());
	url.port = process.env.PGBOUNCER_PORT ?? "6432";
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

const invalidDecoder = definePostgresStatement({
	name: "pb03.invalid-decoder",
	text: "SELECT 42::integer",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		if (typeof result.rows[0]?.[0] !== "string")
			throw new TypeError("sensitive decoder detail");
		return result.rows[0][0];
	},
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

const createSensitiveConstraint = definePostgresStatement({
	name: "pb03.sensitive-constraint-create",
	text: `CREATE TEMP TABLE qp_pb03_sensitive (
	value text CHECK (false)
)`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const violateSensitiveConstraint = definePostgresStatement({
	name: "pb03.sensitive-constraint-violate",
	text: "INSERT INTO qp_pb03_sensitive (value) VALUES ($1::text)",
	parameterCount: 1,
	parameters: (value: string) => [value],
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

const dropListenerFrontier = definePostgresStatement({
	name: "pb03.listener-frontier-drop",
	text: "DROP TABLE IF EXISTS qp_pb03_listener_frontier",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const createListenerFrontier = definePostgresStatement({
	name: "pb03.listener-frontier-create",
	text: `CREATE TABLE qp_pb03_listener_frontier (
	value integer NOT NULL
)`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const lockListenerFrontier = definePostgresStatement({
	name: "pb03.listener-frontier-lock",
	text: "SELECT pg_catalog.pg_advisory_xact_lock($1::bigint)",
	parameterCount: 1,
	parameters: (key: bigint) => [key],
	decode: () => undefined,
});

const writeListenerFrontier = definePostgresStatement({
	name: "pb03.listener-frontier-write",
	text: "INSERT INTO qp_pb03_listener_frontier (value) VALUES ($1::integer)",
	parameterCount: 1,
	parameters: (value: number) => [value],
	decode: () => undefined,
});

const readListenerFrontier = definePostgresStatement({
	name: "pb03.listener-frontier-read",
	text: "SELECT coalesce(max(value), 0)::integer FROM qp_pb03_listener_frontier",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const frontier = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof frontier !== "number")
			throw new TypeError("listener frontier is invalid");
		return frontier;
	},
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

const listenerSessionCount = definePostgresStatement({
	name: "pb03.listener-session-count",
	text: `SELECT count(*)::integer
FROM pg_catalog.pg_stat_activity
WHERE application_name = $1::text
	AND pid <> pg_catalog.pg_backend_pid()`,
	parameterCount: 1,
	parameters: (applicationName: string) => [applicationName],
	decode(result) {
		const count = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof count !== "number")
			throw new TypeError("listener session count is invalid");
		return count;
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
	return createPostgresDatabase(databaseConfiguration(input));
}

function databaseConfiguration(
	input: Readonly<{ max?: number; checkoutTimeoutMs?: number }> = {},
) {
	return {
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
	} as const;
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

test("redacts malformed migration connection configuration", () => {
	const sensitiveUrl =
		"postgres://qp-secret-user:qp-secret-password@[invalid/postgres";
	let error: unknown;
	try {
		createMigrationPostgres({
			directConnectionUrl: sensitiveUrl,
			timeouts: {
				statementMs: 1_000,
				lockMs: 500,
				idleInTransactionMs: 1_000,
			},
		});
	} catch (failure) {
		error = failure;
	}
	expect(JSON.parse(JSON.stringify(error))).toEqual({
		name: "QuestpiePostgresError",
		code: "configuration",
		phase: "connect",
		retry: "never",
	});
	expect(String(error)).not.toContain("qp-secret-user");
	expect(String(error)).not.toContain("qp-secret-password");
});

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
	"serializes only safe failures and operational facts",
	async () => {
		const postgres = database();
		const sensitiveValue = "qp-sensitive-value";
		const failure = await postgres
			.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					await transaction.execute(createSensitiveConstraint, undefined);
					await transaction.execute(violateSensitiveConstraint, sensitiveValue);
				},
			})
			.catch((error: unknown) => error);
		const serializedFailure = JSON.stringify(failure);
		expect(JSON.parse(serializedFailure)).toEqual({
			name: "QuestpiePostgresError",
			code: "constraint",
			phase: "statement",
			statementName: "pb03.sensitive-constraint-violate",
			sqlState: "23514",
			retry: "never",
		});
		expect(serializedFailure).not.toContain(sensitiveValue);

		const decoderFailure = await postgres
			.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) => transaction.execute(invalidDecoder, undefined),
			})
			.catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(decoderFailure))).toEqual({
			name: "QuestpiePostgresError",
			code: "invalidResult",
			phase: "statement",
			statementName: "pb03.invalid-decoder",
			retry: "never",
		});
		expect(JSON.stringify(decoderFailure)).not.toContain(
			"sensitive decoder detail",
		);
		expect(JSON.stringify(decoderFailure)).not.toContain("SELECT 42");
		expect(serializedFailure).not.toContain("INSERT INTO");
		expect(serializedFailure).not.toContain(postgresUrl());

		await expect(
			postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				control: { statementTimeoutMs: 25 },
				use: (transaction) => transaction.execute(sleep, 0.25),
			}),
		).rejects.toMatchObject({ code: "statementTimeout" });
		const serializedFacts = JSON.stringify(postgres.facts());
		expect(JSON.parse(serializedFacts)).toMatchObject({
			state: "ready",
			pool: { max: 2, inFlight: 0 },
			counters: {
				checkoutTimeouts: 0,
				statementTimeouts: 1,
				cancellations: 0,
				destroyedConnections: 0,
			},
		});
		expect(serializedFacts).not.toContain(postgresUrl());
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
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

		let holderEntered: (() => void) | undefined;
		let releaseHolder: (() => void) | undefined;
		const holding = new Promise<void>((resolve) => {
			holderEntered = resolve;
		});
		const holderReleased = new Promise<void>((resolve) => {
			releaseHolder = resolve;
		});
		const holder = migration.run({
			application: "pb03MigrationContention",
			use: async () => {
				holderEntered?.();
				await holderReleased;
			},
		});
		await holding;
		try {
			await expect(
				migration.run({
					application: "pb03MigrationContention",
					control: { lockTimeoutMs: 25 },
					use: () => Promise.reject(new Error("contender acquired held lock")),
				}),
			).rejects.toMatchObject({ code: "lockTimeout", phase: "statement" });

			const controller = new AbortController();
			const startedAt = Date.now();
			const cancelled = migration.run({
				application: "pb03MigrationContention",
				control: { lockTimeoutMs: 500, signal: controller.signal },
				use: () =>
					Promise.reject(new Error("cancelled contender acquired lock")),
			});
			const timer = setTimeout(
				() => controller.abort(new Error("stop waiting for migration lock")),
				20,
			);
			try {
				await expect(cancelled).rejects.toMatchObject({
					code: "cancelled",
					phase: "statement",
				});
				expect(Date.now() - startedAt).toBeLessThan(250);
			} finally {
				clearTimeout(timer);
			}
		} finally {
			releaseHolder?.();
			await holder;
		}
		await expect(
			migration.run({
				application: "pb03MigrationContention",
				use: () => Promise.resolve("contention-recovered"),
			}),
		).resolves.toBe("contention-recovered");

		const observer = database();
		try {
			await expect(
				migration.run({
					application: "pb03MigrationUncertainUnlock",
					use: async (session) => {
						const pid = await session.transaction({
							mode: {
								isolation: "readCommitted",
								access: "readOnly",
							},
							use: (transaction) =>
								transaction.execute(currentBackendPid, undefined),
						});
						const terminated = await observer.transaction({
							mode: {
								isolation: "readCommitted",
								access: "readWrite",
							},
							use: (transaction) => transaction.execute(terminateBackend, pid),
						});
						expect(terminated).toBe(true);
						return "must not report success";
					},
				}),
			).rejects.toMatchObject({
				code: "sessionNotAffine",
				phase: "shutdown",
				retry: "never",
			});
			await expect(
				observer.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					use: (transaction) =>
						transaction.execute(listenerSessionCount, "questpie-migration"),
				}),
			).resolves.toBe(0);
			await expect(
				migration.run({
					application: "pb03MigrationUncertainUnlock",
					control: { lockTimeoutMs: 100 },
					use: () => Promise.resolve("uncertain-unlock-recovered"),
				}),
			).resolves.toBe("uncertain-unlock-recovered");
		} finally {
			await observer.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);

postgresTest(
	"bounds active migration SQL with timeout, cancellation, and deadline",
	async () => {
		const migration = createMigrationPostgres({
			directConnectionUrl: postgresUrl(),
			timeouts: {
				statementMs: 1_000,
				lockMs: 500,
				idleInTransactionMs: 1_000,
			},
		});
		const executeSleep = (
			application: string,
			control: {
				statementTimeoutMs?: number;
				signal?: AbortSignal;
				deadlineAt?: number;
			},
		) =>
			migration.run({
				application,
				control,
				use: (session) =>
					session.transaction({
						mode: { isolation: "readCommitted", access: "readWrite" },
						use: (transaction) => transaction.execute(sleep, 0.3),
					}),
			});

		await expect(
			executeSleep("pb03MigrationStatementTimeout", {
				statementTimeoutMs: 25,
			}),
		).rejects.toMatchObject({
			code: "statementTimeout",
			phase: "statement",
			sqlState: "57014",
		});

		const controller = new AbortController();
		const cancellationStartedAt = Date.now();
		const cancelled = executeSleep("pb03MigrationCancellation", {
			signal: controller.signal,
		});
		const cancellationTimer = setTimeout(
			() => controller.abort(new Error("cancel active migration SQL")),
			25,
		);
		try {
			await expect(cancelled).rejects.toMatchObject({
				code: "cancelled",
				phase: "statement",
			});
			expect(Date.now() - cancellationStartedAt).toBeLessThan(200);
		} finally {
			clearTimeout(cancellationTimer);
		}

		const deadlineStartedAt = Date.now();
		await expect(
			executeSleep("pb03MigrationDeadline", {
				deadlineAt: Date.now() + 100,
			}),
		).rejects.toMatchObject({ code: "cancelled", phase: "statement" });
		expect(Date.now() - deadlineStartedAt).toBeLessThan(250);

		await expect(
			migration.run({
				application: "pb03MigrationCancellation",
				use: () => Promise.resolve("session-recovered"),
			}),
		).resolves.toBe("session-recovered");
	},
);

postgresTest(
	"commits LISTEN before reconciling and treats NOTIFY as a hint",
	async () => {
		const postgres = database();
		const channel = definePostgresChannel("qp_pb03_wake");
		const reasons: string[] = [];
		let startupEntered: (() => void) | undefined;
		let releaseStartup: (() => void) | undefined;
		let notified: (() => void) | undefined;
		let reconnected: (() => void) | undefined;
		const startup = new Promise<void>((resolve) => {
			startupEntered = resolve;
		});
		const startupHeld = new Promise<void>((resolve) => {
			releaseStartup = resolve;
		});
		const notification = new Promise<void>((resolve) => {
			notified = resolve;
		});
		const reconnection = new Promise<void>((resolve) => {
			reconnected = resolve;
		});
		const startingListener = createPostgresListener({
			directConnectionUrl: postgresUrl(),
			channel,
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				reasons.push(reason);
				if (reason === "startup") {
					startupEntered?.();
					await startupHeld;
				}
				if (reason === "notification") notified?.();
				if (reason === "reconnect") setTimeout(() => reconnected?.(), 0);
			},
		});
		await startup;
		await postgres.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: (transaction) =>
				transaction.execute(notify, {
					channel,
					payload: "ignored-domain-data",
				}),
		});
		releaseStartup?.();
		const listener = await startingListener;
		try {
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

postgresTest(
	"reconciles a durable frontier after a lost wake before periodic fallback",
	async () => {
		const postgres = database();
		const frontierLock = 8_214_337n;
		let frontier = -1;
		let reconnected: (() => void) | undefined;
		const reconnection = new Promise<void>((resolve) => {
			reconnected = resolve;
		});
		let listener:
			| Awaited<ReturnType<typeof createPostgresListener>>
			| undefined;
		try {
			await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					await transaction.execute(dropListenerFrontier, undefined);
					await transaction.execute(createListenerFrontier, undefined);
				},
			});
			listener = await createPostgresListener({
				directConnectionUrl: postgresUrl(),
				channel: definePostgresChannel("qp_pb03_frontier_wake"),
				database: postgres,
				fallbackIntervalMs: 10_000,
				reconcile: async ({ database, reason }) => {
					frontier = await database.transaction({
						mode: { isolation: "readCommitted", access: "readWrite" },
						use: async (transaction) => {
							await transaction.execute(lockListenerFrontier, frontierLock);
							return transaction.execute(readListenerFrontier, undefined);
						},
					});
					if (reason === "reconnect") reconnected?.();
				},
			});
			expect(frontier).toBe(0);

			await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction) => {
					await transaction.execute(lockListenerFrontier, frontierLock);
					expect(
						await transaction.execute(
							terminateListener,
							"questpie-realtime-listener",
						),
					).toBe(true);
					await transaction.execute(writeListenerFrontier, 7);
				},
			});

			await Promise.race([
				reconnection,
				new Promise<never>((_resolve, reject) =>
					setTimeout(
						() => reject(new Error("durable frontier was not reconciled")),
						1_000,
					),
				),
			]);
			expect(frontier).toBe(7);
			await eventually(
				() => listener?.facts().state === "healthy",
				"listener did not become healthy after frontier reconciliation",
			);
			expect(listener.facts()).toMatchObject({ reconnects: 1 });
		} finally {
			await listener?.close({ deadlineAt: Date.now() + 1_000 });
			await postgres
				.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: (transaction) =>
						transaction.execute(dropListenerFrontier, undefined),
				})
				.catch(() => {});
			await postgres.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);

postgresTest(
	"cannot reconnect or become healthy after listener close",
	async () => {
		const postgres = database();
		let reconnectEntered: (() => void) | undefined;
		let releaseReconnect: (() => void) | undefined;
		const reconnecting = new Promise<void>((resolve) => {
			reconnectEntered = resolve;
		});
		const reconnectHeld = new Promise<void>((resolve) => {
			releaseReconnect = resolve;
		});
		const listener = await createPostgresListener({
			directConnectionUrl: postgresUrl(),
			channel: definePostgresChannel("qp_pb03_close_reconnect"),
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				if (reason === "reconnect") {
					reconnectEntered?.();
					await reconnectHeld;
				}
			},
		});
		try {
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
			await reconnecting;
			await listener.close({ deadlineAt: Date.now() + 25 });
			expect(listener.facts()).toMatchObject({ state: "closed" });
			releaseReconnect?.();
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(listener.facts()).toMatchObject({ state: "closed" });
			await eventually(
				async () =>
					(await postgres.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: (transaction) =>
							transaction.execute(
								listenerSessionCount,
								"questpie-realtime-listener",
							),
					})) === 0,
				"listener session remained after close",
			);
		} finally {
			releaseReconnect?.();
			await listener.close({ deadlineAt: Date.now() + 1_000 });
			await postgres.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);

postgresTest(
	"awaits and coalesces explicit reconciliation through the Runtime listener facade",
	async () => {
		const runtime = createRuntimePostgres(databaseConfiguration());
		let notificationCalls = 0;
		let activeCalls = 0;
		let maximumActiveCalls = 0;
		let reconcileEntered: (() => void) | undefined;
		let releaseReconcile: (() => void) | undefined;
		let entered = new Promise<void>((resolve) => {
			reconcileEntered = resolve;
		});
		let held = new Promise<void>((resolve) => {
			releaseReconcile = resolve;
		});
		const listener = await runtime.listen({
			channel: definePostgresChannel("qp_pb03_explicit_reconcile"),
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				if (reason !== "notification") return;
				notificationCalls += 1;
				activeCalls += 1;
				maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
				reconcileEntered?.();
				try {
					await held;
				} finally {
					activeCalls -= 1;
				}
			},
		});
		try {
			const first = listener.requestReconcile();
			await entered;
			const second = listener.requestReconcile();
			const third = listener.requestReconcile();
			await expect(
				Promise.race([
					first.then(() => "settled"),
					new Promise<string>((resolve) =>
						setTimeout(() => resolve("pending"), 25),
					),
				]),
			).resolves.toBe("pending");
			releaseReconcile?.();
			await Promise.all([first, second, third]);
			expect(notificationCalls).toBe(2);
			expect(maximumActiveCalls).toBe(1);

			entered = new Promise<void>((resolve) => {
				reconcileEntered = resolve;
			});
			held = new Promise<void>((resolve) => {
				releaseReconcile = resolve;
			});
			const drainingReconcile = listener.requestReconcile();
			await entered;
			const closing = runtime.close({ deadlineAt: Date.now() + 1_000 });
			await expect(
				Promise.race([
					closing.then(() => "settled"),
					new Promise<string>((resolve) =>
						setTimeout(() => resolve("pending"), 25),
					),
				]),
			).resolves.toBe("pending");
			releaseReconcile?.();
			await Promise.all([drainingReconcile, closing]);
			expect(runtime.facts()).toMatchObject({
				state: "closed",
				listener: { state: "closed" },
			});
		} finally {
			releaseReconcile?.();
			await runtime.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);

postgresTest("normalizes explicit reconciliation rejection", async () => {
	const postgres = database();
	const sensitiveDetail = "qp-sensitive-explicit-reconcile-detail";
	let fail = false;
	const listener = await createPostgresListener({
		directConnectionUrl: postgresUrl(),
		channel: definePostgresChannel("qp_pb03_explicit_reconcile_failure"),
		database: postgres,
		fallbackIntervalMs: 10_000,
		reconcile: () =>
			fail ? Promise.reject(new Error(sensitiveDetail)) : Promise.resolve(),
	});
	try {
		fail = true;
		const failure = await listener
			.requestReconcile()
			.catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(failure))).toEqual({
			name: "QuestpiePostgresError",
			code: "queryFailed",
			phase: "reconcile",
			retry: "never",
		});
		expect(JSON.stringify(failure)).not.toContain(sensitiveDetail);
	} finally {
		await listener.close({ deadlineAt: Date.now() + 1_000 });
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
	}
});

postgresTest("normalizes and redacts listener startup failures", async () => {
	const postgres = database();
	try {
		const malformedUrl =
			"postgres://qp-secret-user:qp-secret-password@[invalid/postgres";
		const configurationFailure = await createPostgresListener({
			directConnectionUrl: malformedUrl,
			channel: definePostgresChannel("qp_pb03_configuration_failure"),
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: () => Promise.resolve(),
		}).catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(configurationFailure))).toEqual({
			name: "QuestpiePostgresError",
			code: "configuration",
			phase: "connect",
			retry: "never",
		});
		expect(String(configurationFailure)).not.toContain("qp-secret-user");
		expect(String(configurationFailure)).not.toContain("qp-secret-password");

		const unreachable = new URL(postgresUrl());
		unreachable.port = "1";
		unreachable.username = "qp-secret-user";
		unreachable.password = "qp-secret-password";
		const connectFailure = await createPostgresListener({
			directConnectionUrl: unreachable.href,
			channel: definePostgresChannel("qp_pb03_connect_failure"),
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: () => Promise.resolve(),
		}).catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(connectFailure))).toEqual({
			name: "QuestpiePostgresError",
			code: "connectionLost",
			phase: "connect",
			retry: "safeBeforeCommit",
		});
		expect(JSON.stringify(connectFailure)).not.toContain(unreachable.href);
		expect(String(connectFailure)).not.toContain("qp-secret-user");
		expect(String(connectFailure)).not.toContain("qp-secret-password");

		const sensitiveDetail = "qp-sensitive-reconcile-detail";
		const reconcileFailure = await createPostgresListener({
			directConnectionUrl: postgresUrl(),
			channel: definePostgresChannel("qp_pb03_reconcile_failure"),
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: () => Promise.reject(new Error(sensitiveDetail)),
		}).catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(reconcileFailure))).toEqual({
			name: "QuestpiePostgresError",
			code: "queryFailed",
			phase: "reconcile",
			retry: "never",
		});
		expect(JSON.stringify(reconcileFailure)).not.toContain(sensitiveDetail);
		expect(String(reconcileFailure)).not.toContain(sensitiveDetail);

		const nestedFailure = await createPostgresListener({
			directConnectionUrl: postgresUrl(),
			channel: definePostgresChannel("qp_pb03_nested_reconcile_failure"),
			database: postgres,
			fallbackIntervalMs: 10_000,
			reconcile: () =>
				Promise.reject(
					new QuestpiePostgresError({
						code: "constraint",
						phase: "statement",
						sqlState: "23505",
					}),
				),
		}).catch((error: unknown) => error);
		expect(JSON.parse(JSON.stringify(nestedFailure))).toEqual({
			name: "QuestpiePostgresError",
			code: "constraint",
			phase: "reconcile",
			sqlState: "23505",
			retry: "never",
		});
	} finally {
		await postgres.close({ deadlineAt: Date.now() + 1_000 });
	}
});

postgresTest(
	"rotates only after candidate verification and retains the winner on failure",
	async () => {
		const runtime = createRuntimePostgres(databaseConfiguration());
		const channel = definePostgresChannel("qp_pb03_rotation_wake");
		const reasons: string[] = [];
		const listener = await runtime.listen({
			channel,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				reasons.push(reason);
			},
		});
		let verificationEntered: (() => void) | undefined;
		let releaseVerification: (() => void) | undefined;
		const verifying = new Promise<void>((resolve) => {
			verificationEntered = resolve;
		});
		const verificationHeld = new Promise<void>((resolve) => {
			releaseVerification = resolve;
		});
		const rotating = runtime.rotate({
			configuration: databaseConfiguration(),
			deadlineAt: Date.now() + 1_000,
			verify: async (candidate) => {
				await candidate.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					use: (transaction) =>
						transaction.execute(currentBackendPid, undefined),
				});
				verificationEntered?.();
				await verificationHeld;
			},
		});
		await verifying;
		expect(runtime.facts()).toMatchObject({ state: "rotating", generation: 1 });
		await expect(
			runtime.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("old-generation-serving"),
			}),
		).resolves.toBe("old-generation-serving");
		releaseVerification?.();
		await rotating;
		expect(runtime.facts()).toMatchObject({
			state: "ready",
			generation: 2,
			listener: { state: "healthy" },
			counters: { rotations: 1 },
		});
		expect(listener.facts()).toMatchObject({ state: "healthy" });
		expect(reasons).toEqual(["startup", "startup"]);

		const unreachable = new URL(postgresUrl());
		unreachable.port = "1";
		await expect(
			runtime.rotate({
				configuration: {
					...databaseConfiguration(),
					connectionUrl: unreachable.href,
				},
				deadlineAt: Date.now() + 1_000,
				verify: (candidate) =>
					candidate.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: () => Promise.resolve(),
					}),
			}),
		).rejects.toMatchObject({ phase: "checkout" });
		expect(runtime.facts()).toMatchObject({
			state: "ready",
			generation: 2,
			listener: { state: "healthy" },
			counters: { rotations: 1 },
		});
		await expect(
			runtime.rotate({
				configuration: {
					...databaseConfiguration(),
					directConnectionUrl: "",
				},
				deadlineAt: Date.now() + 1_000,
				verify: () => Promise.reject(new Error("invalid candidate verified")),
			}),
		).rejects.toMatchObject({ code: "configuration", phase: "connect" });
		expect(runtime.facts()).toMatchObject({
			state: "ready",
			generation: 2,
			counters: { rotations: 1 },
		});
		await expect(
			runtime.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve("winner-retained"),
			}),
		).resolves.toBe("winner-retained");
		await runtime.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest(
	"cannot resurrect a closed Runtime from an in-flight rotation",
	async () => {
		const runtime = createRuntimePostgres(databaseConfiguration());
		let verificationEntered: (() => void) | undefined;
		let releaseVerification: (() => void) | undefined;
		const verifying = new Promise<void>((resolve) => {
			verificationEntered = resolve;
		});
		const verificationHeld = new Promise<void>((resolve) => {
			releaseVerification = resolve;
		});
		const rotating = runtime.rotate({
			configuration: databaseConfiguration(),
			deadlineAt: Date.now() + 1_000,
			verify: async () => {
				verificationEntered?.();
				await verificationHeld;
			},
		});
		await verifying;
		const closing = runtime.close({ deadlineAt: Date.now() + 1_000 });
		expect(runtime.facts()).toMatchObject({ state: "draining", generation: 1 });
		releaseVerification?.();
		await expect(rotating).rejects.toMatchObject({
			code: "draining",
			phase: "connect",
		});
		await closing;
		expect(runtime.facts()).toMatchObject({ state: "closed", generation: 1 });
		await expect(
			runtime.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: () => Promise.resolve(),
			}),
		).rejects.toMatchObject({ code: "closed", phase: "checkout" });
	},
);

postgresTest(
	"bounds rotation verification and close at their deadlines",
	async () => {
		const expiringRuntime = createRuntimePostgres(databaseConfiguration());
		let verificationEntered: (() => void) | undefined;
		let releaseVerification: (() => void) | undefined;
		const verifying = new Promise<void>((resolve) => {
			verificationEntered = resolve;
		});
		const verificationHeld = new Promise<void>((resolve) => {
			releaseVerification = resolve;
		});
		const rotationStartedAt = Date.now();
		const expiringRotation = expiringRuntime.rotate({
			configuration: databaseConfiguration(),
			deadlineAt: Date.now() + 25,
			verify: async () => {
				verificationEntered?.();
				await verificationHeld;
			},
		});
		await verifying;
		await expect(expiringRotation).rejects.toMatchObject({
			code: "connectTimeout",
			phase: "connect",
		});
		expect(Date.now() - rotationStartedAt).toBeLessThan(200);
		expect(expiringRuntime.facts()).toMatchObject({
			state: "ready",
			generation: 1,
			counters: { rotations: 0 },
		});
		releaseVerification?.();
		await expiringRuntime.close({ deadlineAt: Date.now() + 1_000 });

		const closingRuntime = createRuntimePostgres(databaseConfiguration());
		let closeVerificationEntered: (() => void) | undefined;
		let releaseCloseVerification: (() => void) | undefined;
		const closeVerifying = new Promise<void>((resolve) => {
			closeVerificationEntered = resolve;
		});
		const closeVerificationHeld = new Promise<void>((resolve) => {
			releaseCloseVerification = resolve;
		});
		const rotating = closingRuntime.rotate({
			configuration: databaseConfiguration(),
			deadlineAt: Date.now() + 1_000,
			verify: async () => {
				closeVerificationEntered?.();
				await closeVerificationHeld;
			},
		});
		await closeVerifying;
		const closeStartedAt = Date.now();
		await closingRuntime.close({ deadlineAt: Date.now() + 25 });
		expect(Date.now() - closeStartedAt).toBeLessThan(200);
		expect(closingRuntime.facts()).toMatchObject({
			state: "closed",
			generation: 1,
		});
		releaseCloseVerification?.();
		await expect(rotating).rejects.toMatchObject({
			code: "closed",
			phase: "connect",
		});
	},
);

postgresTest(
	"retains old-generation failures produced during rotation drain",
	async () => {
		const runtime = createRuntimePostgres(
			databaseConfiguration({ max: 1, checkoutTimeoutMs: 1_000 }),
		);
		let transactionEntered: (() => void) | undefined;
		let releaseTransaction: (() => void) | undefined;
		const entered = new Promise<void>((resolve) => {
			transactionEntered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			releaseTransaction = resolve;
		});
		const oldTransaction = runtime
			.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async () => {
					transactionEntered?.();
					await held;
				},
			})
			.catch((error: unknown) => error);
		await entered;
		await runtime.rotate({
			configuration: databaseConfiguration(),
			deadlineAt: Date.now() + 25,
			verify: () => Promise.resolve(),
		});
		releaseTransaction?.();
		expect(await oldTransaction).toMatchObject({
			code: "closed",
			phase: "shutdown",
		});
		expect(runtime.facts()).toMatchObject({
			state: "ready",
			generation: 2,
			counters: { cancellations: 1, rotations: 1 },
		});
		await runtime.close({ deadlineAt: Date.now() + 1_000 });
	},
);

postgresTest(
	"owns listener startup before await and drains it during close",
	async () => {
		const runtime = createRuntimePostgres(databaseConfiguration());
		let startupEntered: (() => void) | undefined;
		let releaseStartup: (() => void) | undefined;
		const starting = new Promise<void>((resolve) => {
			startupEntered = resolve;
		});
		const startupHeld = new Promise<void>((resolve) => {
			releaseStartup = resolve;
		});
		const listenerInput = {
			channel: definePostgresChannel("qp_pb03_listener_ownership"),
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }: { reason: string }) => {
				if (reason === "startup") {
					startupEntered?.();
					await startupHeld;
				}
			},
		};
		const first = runtime.listen(listenerInput);
		await starting;
		await expect(runtime.listen(listenerInput)).rejects.toMatchObject({
			code: "configuration",
			phase: "connect",
		});
		const closing = runtime.close({ deadlineAt: Date.now() + 1_000 });
		expect(runtime.facts()).toMatchObject({ state: "draining" });
		releaseStartup?.();
		await expect(first).rejects.toMatchObject({
			code: "draining",
			phase: "connect",
		});
		await closing;
		expect(runtime.facts()).toMatchObject({
			state: "closed",
			generation: 1,
			listener: "disabled",
		});
	},
);

pgbouncerTest(
	"uses transaction pooling only for ordinary work and direct LISTEN for wake",
	async () => {
		const runtime = createRuntimePostgres({
			...databaseConfiguration(),
			connectionUrl: pgbouncerUrl(),
		});
		const channel = definePostgresChannel("qp_pb03_pgbouncer_wake");
		let notified: (() => void) | undefined;
		const notification = new Promise<void>((resolve) => {
			notified = resolve;
		});
		await runtime.listen({
			channel,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				if (reason === "notification") notified?.();
			},
		});
		await runtime.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: (transaction) =>
				transaction.execute(notify, {
					channel,
					payload: "pooler-notify",
				}),
		});
		await Promise.race([
			notification,
			new Promise<never>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error("direct listener missed pooler NOTIFY")),
					500,
				),
			),
		]);
		await runtime.close({ deadlineAt: Date.now() + 1_000 });

		const directDatabase = database();
		const wrongReasons: string[] = [];
		const transactionPooledListener = await createPostgresListener({
			directConnectionUrl: pgbouncerUrl(),
			channel,
			database: directDatabase,
			fallbackIntervalMs: 10_000,
			reconcile: async ({ reason }) => {
				wrongReasons.push(reason);
			},
		});
		try {
			await directDatabase.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: (transaction) =>
					transaction.execute(notify, {
						channel,
						payload: "unsupported-listener",
					}),
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(wrongReasons).toEqual(["startup"]);
		} finally {
			await transactionPooledListener.close({
				deadlineAt: Date.now() + 1_000,
			});
			await directDatabase.close({ deadlineAt: Date.now() + 1_000 });
		}
	},
);
