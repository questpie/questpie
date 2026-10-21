import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { randomUUID } from "node:crypto";

import {
	generateDrizzleJson,
	generateMigration,
} from "drizzle-kit/api-postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import pg from "pg";
import postgres from "postgres";
import { z } from "zod";

import { GraphileWorkerAdapter } from "../../src/exports/adapters/graphile-worker.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { reconcileQueueDispatchExecutions } from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";

const databaseUrl = process.env.QUESTPIE_GRAPHILE_POSTGRES_URL;
const token = randomUUID().replaceAll("-", "");
const databaseName = `graphile_contract_${token}`;

describe.skipIf(!databaseUrl)("Graphile Worker PostgreSQL contract", () => {
	let admin: pg.Pool;
	let pool: pg.Pool;
	let client: ReturnType<typeof postgres>;
	let db: ReturnType<typeof drizzle>;
	let url: string;
	let adapter: GraphileWorkerAdapter;
	let schema: string;
	let errors: Error[];

	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		const target = new URL(databaseUrl!);
		target.pathname = `/${databaseName}`;
		url = target.toString();
		pool = new pg.Pool({ connectionString: url });
		client = postgres(url);
		db = drizzle({ client });
		const empty = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		const snapshot = await generateDrizzleJson(
			{ questpieQueueDispatchTable },
			empty.id,
		);
		for (const statement of await generateMigration(empty, snapshot))
			await db.execute(sql.raw(statement));
	}, 30_000);

	afterAll(async () => {
		await client?.end();
		await pool?.end();
		if (admin) {
			await admin.query(
				`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
			);
			await admin.end();
		}
	});

	beforeEach(async () => {
		schema = `gw_${randomUUID().replaceAll("-", "")}`;
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			useApplicationTransaction: true,
			concurrentJobs: 8,
			pollInterval: 100,
		});
		errors = [];
		adapter.on("error", (error) => errors.push(error));
		await adapter.start();
	});

	afterEach(async () => {
		await adapter.stop();
		await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
		expect(errors).toEqual([]);
	});

	test("publishes scalar/array payloads and preserves logical identities with stable adapter ids", async () => {
		const seen: unknown[] = [];
		const dispatchId = randomUUID();
		const id = await adapter.publish(
			"delivery",
			[1, { message: "ok" }],
			{ idempotencyKey: "key" },
			dispatchId,
		);
		expect(id).toBe(dispatchId);
		await adapter.listen({
			delivery: async (record) => {
				seen.push(record);
			},
		});
		await until(() => seen.length === 1);
		expect(seen[0]).toMatchObject({
			id,
			data: [1, { message: "ok" }],
			dispatchId,
			idempotencyKey: "key",
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("delivery", id)) === "completed",
		);
	});

	test("LISTEN wakes immediate jobs with a 60 second recovery poll", async () => {
		await adapter.stop();
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			listenConnectionString: url,
			schema,
			pollInterval: 60_000,
		});
		const seen: number[] = [];
		await adapter.listen({
			latency: async () => {
				seen.push(performance.now());
			},
		});
		await until(
			async () =>
				Number(
					(
						await pool.query(
							"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'LISTEN%' AND state='idle'",
						)
					).rows[0].count,
				) > 0,
		);
		await Bun.sleep(100);
		const before = performance.now();
		await adapter.publish("latency", {});
		await until(() => seen.length === 1, 2000);
		expect(seen[0]! - before).toBeLessThan(1000);
	});

	test.each([1, 4])(
		"teamSize caps handlers per job in one runner, batchSize=%s",
		async (batchSize) => {
			const active = { first: 0, second: 0 };
			const maximum = { first: 0, second: 0 };
			let completed = 0;
			for (let index = 0; index < 12; index++)
				await adapter.publish(index % 2 ? "first" : "second", {});
			const handler = (name: keyof typeof active) => async () => {
				maximum[name] = Math.max(maximum[name], ++active[name]);
				await Bun.sleep(40);
				active[name]--;
				completed++;
			};
			await adapter.listen(
				{ first: handler("first"), second: handler("second") },
				{ teamSize: 2, batchSize },
			);
			await until(() => completed === 12);
			expect(maximum).toEqual({ first: 2, second: 2 });
			const listeners = await pool.query(
				"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'LISTEN%' AND state='idle'",
			);
			expect(Number(listeners.rows[0].count)).toBe(1);
		},
	);

	test("delays jobs and orders higher framework priorities first", async () => {
		const seen: number[] = [];
		await adapter.publish("priority", 1, { priority: 1 });
		await adapter.publish("priority", 9, { priority: 9 });
		const delayed = await adapter.publish("priority", 100, { startAfter: 0.5 });
		await adapter.listen(
			{
				priority: async ({ data }) => {
					seen.push(Number(data));
				},
			},
			{ teamSize: 1, batchSize: 1 },
		);
		await until(() => seen.length >= 2);
		expect(seen.slice(0, 2)).toEqual([9, 1]);
		expect(await adapter.inspectExecutionState("priority", delayed)).toBe(
			"pending",
		);
		await until(() => seen.length === 3);
		expect(seen).toEqual([9, 1, 100]);
	});

	test.each([false, true])(
		"retries atomically with retryBackoff=%s and reports finalAttempt",
		async (retryBackoff) => {
			const starts: number[] = [];
			const final: boolean[] = [];
			const id = await adapter.publish(
				"retry",
				{},
				{ retryLimit: 2, retryDelay: 0.15, retryBackoff },
			);
			await adapter.listen({
				retry: async (record) => {
					starts.push(performance.now());
					final.push(record.finalAttempt!);
					throw new Error("temporary test failure");
				},
			});
			await until(
				async () =>
					(await adapter.inspectExecutionState("retry", id)) === "failed",
			);
			expect(final).toEqual([false, false, true]);
			expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(140);
			expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(
				retryBackoff ? 290 : 140,
			);
		},
	);

	test("replays a stable dispatch after completion without re-enqueueing it", async () => {
		let calls = 0;
		const dispatch = randomUUID();
		const id = await adapter.publish(
			"receipt",
			{ first: true },
			undefined,
			dispatch,
		);
		await adapter.listen({
			receipt: async () => {
				calls++;
			},
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("receipt", id)) === "completed",
		);
		expect(
			await adapter.publish("receipt", { first: false }, undefined, dispatch),
		).toBe(id);
		await Bun.sleep(200);
		expect(calls).toBe(1);
	});

	test("concurrent publications of a dispatch preserve its original payload", async () => {
		const dispatch = randomUUID();
		const ids = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				adapter.publish("same", { i }, undefined, dispatch),
			),
		);
		expect(new Set(ids).size).toBe(1);
		const result = await pool.query(`SELECT count(*) FROM "${schema}".jobs`);
		expect(Number(result.rows[0].count)).toBe(1);
	});

	test("singleton suppression never claims another dispatch was accepted", async () => {
		await adapter.publish(
			"singleton",
			{ first: true },
			{ singletonKey: "one" },
		);
		await expect(
			adapter.publish("singleton", { first: false }, { singletonKey: "one" }),
		).rejects.toThrow("suppressed");
		const other = await adapter.publish("other", {}, { singletonKey: "one" });
		expect(other).toMatch(/^[a-f0-9-]{36}$/);
	});

	test("a permanently failed singleton releases its key for the next logical dispatch", async () => {
		const first = await adapter.publish(
			"singleton-fail",
			{},
			{ singletonKey: "key", retryLimit: 0 },
		);
		await adapter.listen({
			"singleton-fail": async () => {
				throw new Error("failure");
			},
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("singleton-fail", first)) ===
				"failed",
		);
		const second = await adapter.publish(
			"singleton-fail",
			{},
			{ singletonKey: "key", retryLimit: 0 },
		);
		expect(second).not.toBe(first);
	});

	test("postgres-js + Drizzle enqueue joins caller commit and rollback", async () => {
		let committed = "";
		await db.transaction(async (tx) => {
			committed = await adapter.publishInTransaction(
				tx,
				"transaction",
				{ nested: [1, "two"] },
				{},
				randomUUID(),
			);
			expect(
				await adapter.inspectExecutionState("transaction", committed),
			).toBe("missing");
		});
		expect(await adapter.inspectExecutionState("transaction", committed)).toBe(
			"pending",
		);
		let rolledBack = "";
		await expect(
			db.transaction(async (tx) => {
				rolledBack = await adapter.publishInTransaction(
					tx,
					"transaction",
					{},
					{},
					randomUUID(),
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(await adapter.inspectExecutionState("transaction", rolledBack)).toBe(
			"missing",
		);
		const [record] = (
			await pool.query(
				`SELECT payload FROM "${schema}"._private_jobs WHERE key LIKE $1`,
				[`questpie:${committed}:%`],
			)
		).rows;
		expect(record.payload.payload).toEqual({ nested: [1, "two"] });
	});

	test("framework non-secret transactions bypass relay and retain portable idempotency", async () => {
		const queue = makeQueue(adapter, db, async () => {});
		const key = randomUUID();
		let dispatch: string | null = null;
		await withTransaction(db, async () => {
			dispatch = await queue.delivery.publish(
				{ value: "hello" },
				{ idempotencyKey: key },
			);
			expect((await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount).toBe(
				0,
			);
		});
		expect((await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount).toBe(1);
		expect(
			await queue.delivery.publish(
				{ value: "changed" },
				{ idempotencyKey: key },
			),
		).toBe(dispatch);
		const [receipt] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatch!));
		expect(receipt).toMatchObject({ status: "accepted", payload: null });
		await queue.stop();
	});

	test("secret transactions use encrypted relay, execute once, erase keys and honour completed receipts", async () => {
		const seen: unknown[] = [];
		const queue = makeQueue(adapter, db, async (payload) => {
			seen.push(payload);
		});
		const key = randomUUID();
		const secret = `secret-${randomUUID()}`;
		const dispatch = await withTransaction(db, async () => {
			const id = await queue.delivery.publish(
				{ value: secret },
				{ idempotencyKey: key, secretPayload: true, retryLimit: 0 },
			);
			expect((await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount).toBe(
				0,
			);
			return id!;
		});
		const broker = await pool.query(
			`SELECT payload FROM "${schema}"._private_jobs`,
		);
		expect(JSON.stringify(broker.rows)).not.toContain(secret);
		const [receipt] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatch));
		expect(receipt).toMatchObject({
			status: "accepted",
			secretPayload: true,
			payload: null,
		});
		expect(receipt.wrappedSecretKey).not.toBeNull();
		await queue.listen({ gracefulShutdown: false });
		await until(() => seen.length === 1);
		await until(
			async () => (await queue.getReceipt(dispatch))?.status === "completed",
		);
		const [finished] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatch));
		expect(finished.wrappedSecretKey).toBeNull();
		expect(
			await queue.delivery.publish(
				{ value: "different" },
				{ idempotencyKey: key, secretPayload: true },
			),
		).toBe(dispatch);
		expect(seen).toEqual([{ value: secret }]);
		await queue.stop();
	});

	test("a consumer arriving before relay acceptance does not exhaust even retryLimit zero", async () => {
		await adapter.stop();
		class DelayedReceiptAdapter extends GraphileWorkerAdapter {
			override async publish(
				...args: Parameters<GraphileWorkerAdapter["publish"]>
			) {
				const id = await super.publish(...args);
				await Bun.sleep(300);
				return id;
			}
		}
		adapter = new DelayedReceiptAdapter({
			connectionString: url,
			schema,
			useApplicationTransaction: true,
			pollInterval: 100,
		});
		const seen: unknown[] = [];
		const queue = makeQueue(adapter, db, async (payload) => {
			seen.push(payload);
		});
		await queue.listen({ gracefulShutdown: false });
		const id = await queue.delivery.publish(
			{ value: "handoff-race" },
			{ idempotencyKey: randomUUID(), secretPayload: true, retryLimit: 0 },
		);
		await until(
			async () => (await queue.getReceipt(id!))?.status === "completed",
		);
		expect(seen).toEqual([{ value: "handoff-race" }]);
		await queue.stop();
	});

	test("secret terminal failures reconcile durable broker state and erase keys", async () => {
		const queue = makeQueue(adapter, db, async () => {
			throw new Error("secret must not reach diagnostics");
		});
		const dispatch = await queue.delivery.publish(
			{ value: "private-value" },
			{ idempotencyKey: randomUUID(), secretPayload: true, retryLimit: 0 },
		);
		await queue.listen({ gracefulShutdown: false });
		const [receipt] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatch!));
		await until(
			async () =>
				(await adapter.inspectExecutionState(
					"delivery",
					receipt.adapterJobId!,
				)) === "failed",
		);
		await reconcileQueueDispatchExecutions({ adapter, db });
		expect((await queue.getReceipt(dispatch!))?.status).toBe("failed");
		const [failed] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatch!));
		expect(failed.wrappedSecretKey).toBeNull();
		const broker = await pool.query(`SELECT last_error FROM "${schema}".jobs`);
		expect(JSON.stringify(broker.rows)).not.toContain("private-value");
		await queue.stop();
	});

	test("expireInSeconds aborts the handler and retries with a new physical generation", async () => {
		let attempts = 0;
		let aborted = false;
		const final: boolean[] = [];
		const id = await adapter.publish(
			"timeout",
			{},
			{ expireInSeconds: 0.15, retryLimit: 1, retryDelay: 0.1 },
		);
		await adapter.listen({
			timeout: async (record) => {
				attempts++;
				final.push(record.finalAttempt!);
				expect(record.signal).toBeInstanceOf(AbortSignal);
				if (attempts === 1)
					await new Promise<void>((resolve) =>
						record.signal!.addEventListener(
							"abort",
							() => {
								aborted = true;
								resolve();
							},
							{ once: true },
						),
					);
			},
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("timeout", id)) === "completed",
		);
		expect(aborted).toBe(true);
		expect(attempts).toBe(2);
		expect(final).toEqual([false, true]);
		const [receipt] = (
			await pool.query(
				`SELECT attempts, generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
				[id],
			)
		).rows;
		expect(receipt).toMatchObject({ attempts: 2, generation: 1 });
	});

	test("framework secret handlers receive AbortSignal and retry without premature key erasure", async () => {
		let attempts = 0;
		const queue = makeQueue(adapter, db, async (_payload, signal) => {
			expect(signal).toBeInstanceOf(AbortSignal);
			if (++attempts === 1)
				await new Promise<void>((resolve) =>
					signal!.addEventListener("abort", () => resolve(), { once: true }),
				);
		});
		const id = await queue.delivery.publish(
			{ value: "expiring-secret" },
			{
				idempotencyKey: randomUUID(),
				secretPayload: true,
				expireInSeconds: 0.2,
				retryLimit: 1,
			},
		);
		await queue.listen({ gracefulShutdown: false });
		await until(
			async () => (await queue.getReceipt(id!))?.status === "completed",
		);
		expect(attempts).toBe(2);
		const [receipt] = await db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, id!));
		expect(receipt.wrappedSecretKey).toBeNull();
		await queue.stop();
	});

	test("late completion of an expired attempt cannot settle its retry", async () => {
		let attempts = 0;
		let releaseOld!: () => void;
		const old = new Promise<void>((resolve) => {
			releaseOld = resolve;
		});
		const id = await adapter.publish(
			"late",
			{},
			{ expireInSeconds: 0.15, retryLimit: 1 },
		);
		await adapter.listen({
			late: async () => {
				if (++attempts === 1) await old;
			},
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("late", id)) === "completed",
		);
		releaseOld();
		await Bun.sleep(100);
		expect(attempts).toBe(2);
		expect(await adapter.inspectExecutionState("late", id)).toBe("completed");
	});

	test("waiting for a healthy worker's per-job permit never spends a handler retry", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const seen: unknown[] = [];
		await adapter.listen({
			permit: async ({ data }) => {
				seen.push(data);
				if ((data as { order: number }).order === 1) await blocked;
			},
		});
		await adapter.publish("permit", { order: 1 }, { expireInSeconds: 30 });
		await until(() => seen.length === 1);
		const waiting = await adapter.publish(
			"permit",
			{ order: 2 },
			{ expireInSeconds: 0.1, retryLimit: 0 },
		);
		try {
			await until(async () => {
				const [receipt] = (
					await pool.query(
						`SELECT generation, attempts, status FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[waiting],
					)
				).rows;
				if (receipt.generation === 0) return false;
				expect(receipt).toMatchObject({ attempts: 0, status: "pending" });
				return true;
			});
			expect(seen).toEqual([{ order: 1 }]);
			release();
			await until(
				async () =>
					(await adapter.inspectExecutionState("permit", waiting)) ===
					"completed",
			);
			expect(seen).toEqual([{ order: 1 }, { order: 2 }]);
		} finally {
			release();
		}
	});

	test("a killed worker's lease retries near expireInSeconds, without the native four-hour unlock", async () => {
		const id = await adapter.publish(
			"crash",
			{},
			{ expireInSeconds: 1, retryLimit: 1 },
		);
		const child = Bun.spawn(
			[
				process.execPath,
				new URL(
					"../fixtures/queue-graphile-worker/crash-worker.ts",
					import.meta.url,
				).pathname,
			],
			{
				env: {
					...process.env,
					QUESTPIE_GRAPHILE_CRASH_URL: url,
					QUESTPIE_GRAPHILE_CRASH_SCHEMA: schema,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		try {
			const reader = child.stdout.getReader();
			const message = await Promise.race([
				reader.read(),
				Bun.sleep(20_000).then(() => {
					throw new Error("Crash worker did not claim job");
				}),
			]);
			expect(new TextDecoder().decode(message.value)).toContain("claimed");
			reader.releaseLock();
			const before = performance.now();
			child.kill("SIGKILL");
			await child.exited;
			let recovered = 0;
			await adapter.listen({
				crash: async () => {
					recovered++;
				},
			});
			await until(
				async () =>
					(await adapter.inspectExecutionState("crash", id)) === "completed",
			);
			expect(recovered).toBe(1);
			expect(performance.now() - before).toBeLessThan(3000);
			const [receipt] = (
				await pool.query(
					`SELECT attempts, generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[id],
				)
			).rows;
			expect(receipt).toMatchObject({ attempts: 2, generation: 1 });
		} finally {
			child.kill("SIGKILL");
			await child.exited;
		}
	});

	test("a worker killed while awaiting a per-job permit does not hold the fetched job for four hours", async () => {
		const long = await adapter.publish(
			"crash",
			{ order: 1 },
			{ expireInSeconds: 30, retryLimit: 0 },
		);
		const waiting = await adapter.publish(
			"crash",
			{ order: 2 },
			{ expireInSeconds: 2, retryLimit: 0 },
		);
		const child = Bun.spawn(
			[
				process.execPath,
				new URL(
					"../fixtures/queue-graphile-worker/crash-worker.ts",
					import.meta.url,
				).pathname,
			],
			{
				env: {
					...process.env,
					QUESTPIE_GRAPHILE_CRASH_URL: url,
					QUESTPIE_GRAPHILE_CRASH_SCHEMA: schema,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		try {
			const reader = child.stdout.getReader();
			await Promise.race([
				reader.read(),
				Bun.sleep(20_000).then(() => {
					throw new Error("Crash worker did not start");
				}),
			]);
			reader.releaseLock();
			await until(
				async () =>
					Number(
						(
							await pool.query(
								`SELECT count(*) FROM "${schema}".jobs WHERE locked_at IS NOT NULL`,
							)
						).rows[0].count,
					) === 2,
			);
			child.kill("SIGKILL");
			await child.exited;
			const seen: unknown[] = [];
			await adapter.listen({
				crash: async ({ data }) => {
					seen.push(data);
				},
			});
			await until(
				async () =>
					(await adapter.inspectExecutionState("crash", waiting)) ===
					"completed",
				3000,
			);
			expect(seen).toEqual([{ order: 2 }]);
			expect(await adapter.inspectExecutionState("crash", long)).toBe("active");
		} finally {
			child.kill("SIGKILL");
			await child.exited;
		}
	});

	test("drains active handlers before releasing connections; repeated stop is safe", async () => {
		let entered = false;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		await adapter.publish("shutdown", {});
		await adapter.listen({
			shutdown: async () => {
				entered = true;
				await blocked;
			},
		});
		await until(() => entered);
		let stopped = false;
		const stop = adapter.stop().then(() => {
			stopped = true;
		});
		await Bun.sleep(100);
		expect(stopped).toBe(false);
		release();
		await Promise.all([stop, adapter.stop()]);
		expect((await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount).toBe(0);
	});

	test("durable cron admits one job across scheduler processes and unschedule removes it", async () => {
		await adapter.schedule("cron", "* * * * *", { scheduled: true });
		const second = new GraphileWorkerAdapter({ connectionString: url, schema });
		await second.start();
		try {
			await pool.query(
				`UPDATE "${schema}".questpie_schedules SET last_run=now()-interval '2 minutes'`,
			);
			// Drive the actual clock-independent scheduler operation at a due DB minute.
			await Promise.all([
				(
					adapter as unknown as { tickSchedules(): Promise<void> }
				).tickSchedules(),
				(
					second as unknown as { tickSchedules(): Promise<void> }
				).tickSchedules(),
			]);
			expect((await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount).toBe(
				1,
			);
			await adapter.unschedule("cron");
			expect(
				(await pool.query(`SELECT FROM "${schema}".questpie_schedules`))
					.rowCount,
			).toBe(0);
		} finally {
			await second.stop();
		}
	});
});

function makeQueue(
	adapter: GraphileWorkerAdapter,
	db: ReturnType<typeof drizzle>,
	handle: (payload: unknown, signal?: AbortSignal) => Promise<void>,
) {
	return createQueueClient(
		{
			delivery: {
				name: "delivery",
				schema: z.object({ value: z.string() }),
				handler: async ({ payload, signal }) => handle(payload, signal),
			},
		},
		adapter,
		{
			getDatabase: () => db,
			createContext: async () => ({ db }),
			getApp: () => ({ db, collections: {}, globals: {} }),
			secret: "graphile-test-root-secret-at-least-32-bytes",
			logger: { info() {}, warn() {}, error() {} },
		},
	);
}

async function until(
	predicate: () => boolean | Promise<boolean>,
	timeout = 10000,
): Promise<void> {
	const deadline = performance.now() + timeout;
	while (!(await predicate())) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for queue contract");
		await Bun.sleep(10);
	}
}
