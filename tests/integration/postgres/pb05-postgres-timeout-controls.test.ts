import { expect, test } from "bun:test";

import { Client } from "pg";

import {
	createPostgresDatabase,
	definePostgresStatement,
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

function database(idleInTransactionMs = 1_000) {
	return createPostgresDatabase({
		connectionUrl: postgresUrl(),
		directConnectionUrl: postgresUrl(),
		pool: {
			max: 1,
			connectTimeoutMs: 1_000,
			checkoutTimeoutMs: 1_000,
			idleTimeoutMs: 1_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 1_000,
			lockMs: 500,
			idleInTransactionMs,
		},
	});
}

const backendPid = definePostgresStatement({
	name: "pb05.timeout.backend-pid",
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

const lockTarget = definePostgresStatement({
	name: "pb05.timeout.lock-target",
	text: `SELECT value
FROM qp_pb05_timeout_target
WHERE id = 1
FOR UPDATE`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const incrementTarget = definePostgresStatement({
	name: "pb05.timeout.increment-target",
	text: `UPDATE qp_pb05_timeout_target
SET value = value + 1
WHERE id = 1`,
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

const readTarget = definePostgresStatement({
	name: "pb05.timeout.read-target",
	text: "SELECT value FROM qp_pb05_timeout_target WHERE id = 1",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const value = result.rows[0]?.[0];
		if (result.rows.length !== 1 || typeof value !== "number")
			throw new TypeError("target value result is invalid");
		return value;
	},
});

const shortStatement = definePostgresStatement({
	name: "pb05.timeout.short-statement",
	text: "SELECT pg_catalog.pg_sleep(0.02)",
	parameterCount: 0,
	parameters: () => [],
	decode: () => undefined,
});

type Activity = Readonly<{
	state: string;
	waitEventType: string | null;
	blockers: number;
}>;

async function activity(admin: Client, pid: number): Promise<Activity | null> {
	const result = await admin.query<Activity>(
		`SELECT state, wait_event_type AS "waitEventType",
		cardinality(pg_catalog.pg_blocking_pids(pid))::integer AS blockers
		FROM pg_catalog.pg_stat_activity
		WHERE pid = $1`,
		[pid],
	);
	return result.rows[0] ?? null;
}

async function eventually<Output>(
	probe: () => Promise<Output>,
	accept: (output: Output) => boolean,
	label: string,
	deadlineMs = 500,
): Promise<Output> {
	const deadlineAt = Date.now() + deadlineMs;
	while (true) {
		const output = await probe();
		if (accept(output)) return output;
		if (Date.now() >= deadlineAt) throw new Error(label);
		await Bun.sleep(5);
	}
}

postgresTest(
	"PB-05 bounds held locks and idle transactions without poisoning Pool reuse",
	async () => {
		const admin = new Client({ connectionString: postgresUrl() });
		const blocker = new Client({ connectionString: postgresUrl() });
		let postgres: ReturnType<typeof database> | undefined;
		let idleBounded: ReturnType<typeof database> | undefined;
		try {
			await admin.connect();
			await blocker.connect();
			await admin.query("DROP TABLE IF EXISTS qp_pb05_timeout_target");
			await admin.query(
				"CREATE TABLE qp_pb05_timeout_target (id integer PRIMARY KEY, value integer NOT NULL)",
			);
			await admin.query(
				"INSERT INTO qp_pb05_timeout_target (id, value) VALUES (1, 0)",
			);

			postgres = database();
			await blocker.query("BEGIN");
			await blocker.query(
				"UPDATE qp_pb05_timeout_target SET value = 99 WHERE id = 1",
			);

			let statementPid!: (value: number) => void;
			const statementPidKnown = new Promise<number>((resolve) => {
				statementPid = resolve;
			});
			const statementWaiter = postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				control: { statementTimeoutMs: 125, lockTimeoutMs: 1_000 },
				use: async (transaction) => {
					statementPid(await transaction.execute(backendPid, undefined));
					await transaction.execute(incrementTarget, undefined);
				},
			});
			const timedPid = await statementPidKnown;
			const statementWitness = await eventually(
				() => activity(admin, timedPid),
				(observed) =>
					observed?.waitEventType === "Lock" && observed.blockers === 1,
				"statement-timeout contender never produced a real lock witness",
			);
			expect(statementWitness).toMatchObject({
				state: "active",
				waitEventType: "Lock",
				blockers: 1,
			});
			await expect(statementWaiter).rejects.toMatchObject({
				code: "statementTimeout",
				phase: "statement",
				statementName: "pb05.timeout.increment-target",
				sqlState: "57014",
				retry: "never",
			});
			const statementCleanup = await eventually(
				() => activity(admin, timedPid),
				(observed) => observed?.state === "idle" && observed.blockers === 0,
				"statement-timeout backend did not roll back and return idle",
			);
			expect(statementCleanup).toMatchObject({ state: "idle", blockers: 0 });
			expect(
				await activity(
					admin,
					(await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
				),
			).toMatchObject({
				state: "idle in transaction",
			});
			await blocker.query("ROLLBACK");

			const statementReusePid = await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				control: { statementTimeoutMs: 125, lockTimeoutMs: 100 },
				use: async (transaction) => {
					const pid = await transaction.execute(backendPid, undefined);
					expect(await transaction.execute(readTarget, undefined)).toBe(0);
					await transaction.execute(shortStatement, undefined);
					return pid;
				},
			});
			expect(statementReusePid).toBe(timedPid);

			await blocker.query("BEGIN");
			await blocker.query(
				"UPDATE qp_pb05_timeout_target SET value = 77 WHERE id = 1",
			);
			let lockPid!: (value: number) => void;
			const lockPidKnown = new Promise<number>((resolve) => {
				lockPid = resolve;
			});
			const lockWaiter = postgres.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				control: { statementTimeoutMs: 1_000, lockTimeoutMs: 125 },
				use: async (transaction) => {
					lockPid(await transaction.execute(backendPid, undefined));
					await transaction.execute(lockTarget, undefined);
				},
			});
			const lockedPid = await lockPidKnown;
			await eventually(
				() => activity(admin, lockedPid),
				(observed) =>
					observed?.waitEventType === "Lock" && observed.blockers === 1,
				"lock-timeout contender never produced a real lock witness",
			);
			await expect(lockWaiter).rejects.toMatchObject({
				code: "lockTimeout",
				phase: "statement",
				statementName: "pb05.timeout.lock-target",
				sqlState: "55P03",
				retry: "never",
			});
			await eventually(
				() => activity(admin, lockedPid),
				(observed) => observed?.state === "idle" && observed.blockers === 0,
				"lock-timeout backend did not roll back and return idle",
			);
			await blocker.query("ROLLBACK");
			const lockReusePid = await postgres.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async (transaction) => {
					const pid = await transaction.execute(backendPid, undefined);
					expect(await transaction.execute(readTarget, undefined)).toBe(0);
					return pid;
				},
			});
			expect(lockReusePid).toBe(lockedPid);
			expect(postgres.facts()).toMatchObject({
				pool: { inFlight: 0, waiting: 0 },
				counters: { statementTimeouts: 1 },
			});

			await postgres.close({ deadlineAt: Date.now() + 1_000 });
			postgres = undefined;

			idleBounded = database(100);
			let publishIdlePid!: (value: number) => void;
			const idlePidKnown = new Promise<number>((resolve) => {
				publishIdlePid = resolve;
			});
			const idleFailure = idleBounded.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async (transaction) => {
					const pid = await transaction.execute(backendPid, undefined);
					publishIdlePid(pid);
					await Bun.sleep(250);
					await transaction.execute(readTarget, undefined);
				},
			});
			const idlePid = await idlePidKnown;
			await eventually(
				() => activity(admin, idlePid),
				(observed) => observed?.state === "idle in transaction",
				"idle transaction never produced a positive backend witness",
			);
			await eventually(
				() => activity(admin, idlePid),
				(observed) => observed === null,
				"idle-in-transaction timeout did not terminate its backend",
				500,
			);
			await expect(idleFailure).rejects.toMatchObject({
				code: "connectionLost",
				phase: "statement",
				statementName: "pb05.timeout.read-target",
				sqlState: undefined,
				retry: "never",
			});
			expect(idleBounded.facts()).toMatchObject({
				pool: { inFlight: 0 },
			});
			const replacementPid = await idleBounded.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async (transaction) => {
					const pid = await transaction.execute(backendPid, undefined);
					await Bun.sleep(20);
					expect(await transaction.execute(readTarget, undefined)).toBe(0);
					return pid;
				},
			});
			expect(replacementPid).not.toBe(idlePid);

			let publishReturningPid!: (value: number) => void;
			const returningPidKnown = new Promise<number>((resolve) => {
				publishReturningPid = resolve;
			});
			const returnAfterIdle = idleBounded.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: async (transaction) => {
					publishReturningPid(await transaction.execute(backendPid, undefined));
					await Bun.sleep(250);
					return "callback-finished";
				},
			});
			const returningPid = await returningPidKnown;
			await eventually(
				() => activity(admin, returningPid),
				(observed) => observed?.state === "idle in transaction",
				"returning idle transaction never produced a positive backend witness",
			);
			await eventually(
				() => activity(admin, returningPid),
				(observed) => observed === null,
				"returning idle transaction was not terminated",
				500,
			);
			await expect(returnAfterIdle).rejects.toMatchObject({
				code: "connectionLost",
				phase: "commit",
				sqlState: undefined,
				retry: "safeBeforeCommit",
			});
			const postReturnReplacementPid = await idleBounded.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) => transaction.execute(backendPid, undefined),
			});
			expect(postReturnReplacementPid).not.toBe(returningPid);
		} finally {
			await blocker.query("ROLLBACK").catch(() => undefined);
			await postgres
				?.close({ deadlineAt: Date.now() + 1_000 })
				.catch(() => undefined);
			await idleBounded
				?.close({ deadlineAt: Date.now() + 1_000 })
				.catch(() => undefined);
			await admin
				.query("DROP TABLE IF EXISTS qp_pb05_timeout_target")
				.catch(() => undefined);
			await blocker.end().catch(() => undefined);
			await admin.end().catch(() => undefined);
		}
	},
	15_000,
);
