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
import { eq, getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import pg from "pg";
import postgres from "postgres";
import { z } from "zod";

import { GraphileWorkerAdapter } from "../../src/exports/adapters/graphile-worker.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { getActiveRequestScope } from "../../src/server/config/request-scope.js";
import {
	claimQueueDispatchExecution,
	completeQueueDispatch,
	failQueueDispatch,
	reconcileQueueDispatchExecutions,
	releaseQueueDispatchExecution,
	pruneQueueDispatches,
	renewQueueDispatchExecution,
} from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
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

	test.each([false, true])(
		"TTL returns buffered capacity without leaks or foreign replay, rotated=%s",
		async (rotated) => {
			await adapter.stop();
			adapter = new GraphileWorkerAdapter({
				connectionString: url,
				schema,
				concurrentJobs: 1,
				pollInterval: 50,
			});
			adapter.on("error", (error) => errors.push(error));
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => (release = resolve));
			let entered = false;
			const seen: unknown[] = [];
			const internal = adapter as unknown as {
				checkListener(
					events: import("graphile-worker").WorkerEvents,
				): Promise<void>;
				recoverLeases(): Promise<void>;
			};
			let buffered: { setModeTtlExpired(): void } | undefined;
			const checkListener = internal.checkListener.bind(adapter);
			internal.checkListener = async (events) => {
				events.on("localQueue:setMode", ({ newMode, localQueue }) => {
					if (newMode === "WAITING") buffered = localQueue;
				});
				await checkListener(events);
			};
			await adapter.listen({
				busy: async () => {
					entered = true;
					await blocked;
				},
				buffered: async ({ data }) => {
					seen.push(data);
				},
			});
			try {
				await adapter.publish("busy", {});
				await until(() => entered);
				const id = await adapter.publish(
					"buffered",
					{ value: "original" },
					{ expireInSeconds: 30 },
				);
				await until(() => Boolean(buffered));
				if (rotated) {
					await pool.query(
						`UPDATE "${schema}"._private_jobs SET locked_at=now()-interval '1 hour' WHERE key=$1`,
						[`questpie:${id}:0`],
					);
					await internal.recoverLeases();
				}
				// Exercise the installed TTL -> returnJobs path without a five-minute sleep.
				buffered!.setModeTtlExpired();
				await until(
					async () =>
						(
							await pool.query(
								`SELECT FROM "${schema}".jobs WHERE locked_at IS NULL`,
							)
						).rowCount! > 0,
				);
				release();
				await until(() => seen.length >= 1);
				await adapter.publish("buffered", { value: "fresh" });
				await until(() => seen.length >= 2);
				await until(
					async () =>
						(await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount === 0,
				);
				expect(seen).toEqual([{ value: "original" }, { value: "fresh" }]);
			} finally {
				release();
			}
		},
	);

	test("routine replica startup does not wait for application transaction locks", async () => {
		const lock = await pool.connect();
		const replica = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
		});
		let starting: Promise<void> | undefined;
		try {
			await lock.query("BEGIN");
			await lock.query(
				`INSERT INTO "${schema}".questpie_dispatches (dispatch_id,job_name) VALUES ($1,'startup')`,
				[randomUUID()],
			);
			await lock.query(`SELECT "${schema}".add_job('startup', '{}'::json)`);
			starting = replica.start();
			expect(
				await Promise.race([
					starting.then(() => "started"),
					Bun.sleep(750).then(() => "blocked"),
				]),
			).toBe("started");
		} finally {
			await lock.query("ROLLBACK");
			lock.release();
			await starting;
			await replica.stop();
		}
	});

	test.each(["secret", "database"])(
		"missing runtime %s preserves unstarted secret work",
		async (missing) => {
			let calls = 0;
			const publisher = makeQueue(adapter, db, async () => {
				calls++;
			});
			const consumer = makeQueue(
				adapter,
				db,
				async () => {
					calls++;
				},
				missing === "secret" ? null : undefined,
				missing === "database",
			);
			const id = (await publisher.delivery.publish(
				{ value: "preserved" },
				{
					secretPayload: true,
					retryLimit: 0,
					expireInSeconds: 0.2,
					idempotencyKey: randomUUID(),
				},
			))!;
			try {
				await consumer.listen({ gracefulShutdown: false });
				await until(
					async () =>
						(
							await pool.query(
								`SELECT FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1 AND generation > 0`,
								[id],
							)
						).rowCount === 1,
				);
				await consumer.stop();
				await reconcileQueueDispatchExecutions({ adapter, db });
				const [receipt] = await db
					.select()
					.from(questpieQueueDispatchTable)
					.where(eq(questpieQueueDispatchTable.dispatchId, id));
				expect(receipt.wrappedSecretKey).not.toBeNull();
				expect(receipt.status).toBe("accepted");
				expect(errors.length).toBeGreaterThan(0);
				expect(
					errors.every(
						(error) =>
							error.message === "QUESTPIE Queue secret job handling failed",
					),
				).toBe(true);
				errors.length = 0;
				expect(calls).toBe(0);
				await publisher.listen({ gracefulShutdown: false });
				await until(() => calls === 1);
				await until(
					async () => (await publisher.getReceipt(id))?.status === "completed",
				);
			} finally {
				await publisher.stop();
				await consumer.stop();
			}
		},
	);

	test("an idle fence connection reconnects for the next dispatch", async () => {
		let calls = 0;
		await adapter.listen({
			reconnect: async () => {
				calls++;
			},
		});
		const internal = adapter as unknown as { executionClient: pg.Client };
		const [{ pid }] = (
			await internal.executionClient.query("SELECT pg_backend_pid() AS pid")
		).rows;
		await pool.query("SELECT pg_terminate_backend($1)", [pid]);
		await until(() => errors.length > 0);
		errors.length = 0;
		await adapter.publish("reconnect", {});
		await until(() => calls === 1);
	});

	test("FIFO admission does not rotate generations under a saturated name", async () => {
		const seen: number[] = [];
		for (let i = 0; i < 50; i++) await adapter.publish("fifo", i);
		await adapter.listen(
			{
				fifo: async ({ data }) => {
					seen.push(data as number);
					await Bun.sleep(5);
				},
			},
			{ teamSize: 1, batchSize: 10 },
		);
		await until(() => seen.length === 50);
		expect(seen).toEqual(Array.from({ length: 50 }, (_, i) => i));
		expect(
			(
				await pool.query(
					`SELECT sum(generation)::int AS generations FROM "${schema}".questpie_dispatches`,
				)
			).rows[0].generations,
		).toBe(0);
	});

	test("non-cooperative expiry holds its permit and dispatch fence across runners", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const id = await adapter.publish(
			"fenced",
			{},
			{ expireInSeconds: 0.1, retryLimit: 1 },
		);
		await adapter.listen({
			fenced: async () => {
				calls++;
				await blocked;
			},
		});
		await until(() => calls === 1);
		const second = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			pollInterval: 100,
		});
		try {
			await second.listen({
				fenced: async () => {
					calls++;
				},
			});
			await Bun.sleep(1300);
			expect(calls).toBe(1);
			expect(await adapter.inspectExecutionState("fenced", id)).toBe("active");
			release();
			await until(
				async () =>
					(await adapter.inspectExecutionState("fenced", id)) === "completed",
			);
			expect(calls).toBe(2);
		} finally {
			release();
			await second.stop();
		}
	});

	test.each(["receipt", "envelope"])(
		"permanent secret %s failure terminalizes and erases ciphertext",
		async (missing) => {
			const publisher = makeQueue(adapter, db, async () => {
				throw new Error("must not run");
			});
			const queue = publisher;
			const id = await publisher.delivery.publish(
				{ value: "private" },
				{ secretPayload: true, retryLimit: 0, idempotencyKey: randomUUID() },
			);
			if (missing === "receipt")
				await db
					.delete(questpieQueueDispatchTable)
					.where(eq(questpieQueueDispatchTable.dispatchId, id!));
			if (missing === "envelope")
				await pool.query(
					`UPDATE "${schema}"._private_jobs SET payload='{"broken":true}'::json WHERE key=$1`,
					[`questpie:${id}:0`],
				);
			try {
				await queue.listen({ gracefulShutdown: false });
				await until(
					async () =>
						(await adapter.inspectExecutionState("delivery", id!)) === "failed",
					2000,
				);
				const [record] = (
					await pool.query(
						`SELECT payload, options, generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[id],
					)
				).rows;
				expect(record).toMatchObject({
					payload: null,
					options: null,
					generation: 0,
				});
				await until(
					async () =>
						(await pool.query(`SELECT FROM "${schema}".jobs`)).rowCount === 0,
				);
				await reconcileQueueDispatchExecutions({ adapter, db });
				if (missing !== "receipt") {
					const [receipt] = await db
						.select()
						.from(questpieQueueDispatchTable)
						.where(eq(questpieQueueDispatchTable.dispatchId, id!));
					expect(receipt).toMatchObject({
						status: "failed",
						payload: null,
						wrappedSecretKey: null,
					});
				}
			} finally {
				await queue.stop();
			}
		},
	);

	test("a terminal failed receipt rejects late completion even with its previous token", async () => {
		const queue = makeQueue(adapter, db, async () => {});
		const id = (await queue.delivery.publish(
			{ value: "terminal" },
			{ secretPayload: true, idempotencyKey: randomUUID() },
		))!;
		const claim = await claimQueueDispatchExecution(db, id);
		if (claim.status !== "claimed") throw new Error("Expected owner");
		await db
			.update(questpieQueueDispatchTable)
			.set({ executionClaimedUntil: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, id));
		expect(await failQueueDispatch(db, id)).toBe(true);
		await expect(completeQueueDispatch(db, id, claim.token)).rejects.toThrow();
		expect((await queue.getReceipt(id))?.status).toBe("failed");
		await queue.stop();
	});

	test("token-matching pg-boss claims can renew and complete after a lease lapse", async () => {
		const queue = makeQueue(adapter, db, async () => {});
		for (const renew of [false, true]) {
			const id = await queue.delivery.publish(
				{ value: "private" },
				{ secretPayload: true, idempotencyKey: randomUUID() },
			);
			const claim = await claimQueueDispatchExecution(db, id!);
			if (claim.status !== "claimed") throw new Error("Expected claim");
			await db
				.update(questpieQueueDispatchTable)
				.set({ executionClaimedUntil: new Date(0) })
				.where(eq(questpieQueueDispatchTable.dispatchId, id!));
			if (renew)
				expect(await renewQueueDispatchExecution(db, id!, claim.token)).toBe(
					true,
				);
			await completeQueueDispatch(db, id!, claim.token);
			expect((await queue.getReceipt(id!))?.status).toBe("completed");
		}
		await queue.stop();
	});

	test("a Graphile install in another schema leaves this runner healthy", async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				new URL(
					"../fixtures/queue-graphile-worker/death-worker.ts",
					import.meta.url,
				).pathname,
			],
			{
				env: {
					...process.env,
					QUESTPIE_GRAPHILE_CRASH_URL: url,
					QUESTPIE_GRAPHILE_CRASH_SCHEMA: schema,
					QUESTPIE_GRAPHILE_DEATH_MODE: "foreign-migration",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		try {
			expect(
				await Promise.race([
					child.exited,
					Bun.sleep(8000).then(() => "timeout"),
				]),
			).toBe(0);
			expect(await new Response(child.stdout).text()).toContain(
				"foreign-migration:healthy",
			);
		} finally {
			child.kill("SIGKILL");
			await child.exited;
		}
	});

	test.each(["migration", "shutdown", "fence", "shutdown-fence"])(
		"unexpected %s termination exits a live host non-zero",
		async (mode) => {
			const child = Bun.spawn(
				[
					process.execPath,
					new URL(
						"../fixtures/queue-graphile-worker/death-worker.ts",
						import.meta.url,
					).pathname,
				],
				{
					env: {
						...process.env,
						QUESTPIE_GRAPHILE_CRASH_URL: url,
						QUESTPIE_GRAPHILE_CRASH_SCHEMA: schema,
						QUESTPIE_GRAPHILE_DEATH_MODE: mode,
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			try {
				const exit = await Promise.race([
					child.exited,
					Bun.sleep(8000).then(() => "timeout"),
				]);
				expect(exit).not.toBe("timeout");
				expect(exit).not.toBe(0);
				expect(await new Response(child.stdout).text()).toContain(
					"stopped:false:false",
				);
				expect(await new Response(child.stderr).text()).toContain(
					"stopped unexpectedly",
				);
			} finally {
				child.kill("SIGKILL");
				await child.exited;
			}
		},
	);

	test("LISTEN self-check waits for the subscription to commit before sending its probe", async () => {
		const internal = adapter as unknown as { pool: pg.Pool };
		const wrapped = new WeakSet<pg.PoolClient>();
		internal.pool.on("acquire", (connection) => {
			if (wrapped.has(connection)) return;
			wrapped.add(connection);
			connection.query = new Proxy(connection.query, {
				apply(target, receiver, args) {
					if (
						typeof args[0] === "string" &&
						args[0].includes('LISTEN "jobs:insert"')
					)
						args[0] = "SELECT pg_sleep(0.2); " + args[0];
					return Reflect.apply(target, receiver, args);
				},
			});
		});
		await adapter.listen({ probe: async () => {} });
	});

	test("LISTEN self-check rejects a connection that loses its subscription", async () => {
		const internal = adapter as unknown as { pool: pg.Pool };
		const wrapped = new WeakSet<pg.PoolClient>();
		internal.pool.on("acquire", (connection) => {
			if (wrapped.has(connection)) return;
			wrapped.add(connection);
			connection.query = new Proxy(connection.query, {
				apply(target, receiver, args) {
					if (
						typeof args[0] === "string" &&
						args[0].includes('LISTEN "jobs:insert"')
					)
						args[0] = "SELECT 1";
					return Reflect.apply(target, receiver, args);
				},
			});
		});
		await expect(adapter.listen({ probe: async () => {} })).rejects.toThrow(
			"LISTEN self-check timed out",
		);
	});

	test("cron's armed timer publishes a due minute", async () => {
		await adapter.schedule("timer-cron", "* * * * *", { scheduled: true });
		await pool.query(
			`UPDATE "${schema}".questpie_schedules SET last_run=now()-interval '1 minute'`,
		);
		let calls = 0;
		const originalNow = Date.now;
		// Arm the actual timer one millisecond before the next UTC minute.
		Date.now = () => Math.floor(originalNow() / 60000) * 60000 + 59999;
		try {
			await adapter.listen({
				"timer-cron": async () => {
					calls++;
				},
			});
		} finally {
			Date.now = originalNow;
		}
		await until(() => calls === 1);
	});

	test("recovery uses bounded index scans with 100k pending jobs", async () => {
		await pool.query(`WITH jobs AS (
			SELECT * FROM "${schema}".add_jobs(ARRAY(SELECT
				('backlog', '{}'::json, NULL, now()+interval '1 day', 32767, 'questpie:backlog-'||n||':0', 0, NULL)::"${schema}".job_spec
				FROM generate_series(1,100000) n))
		) INSERT INTO "${schema}".questpie_dispatches (dispatch_id, job_name, job_id, payload, options, available_at)
		SELECT substring(key from 10 for length(key)-11), 'backlog', id, payload, '{}'::json, run_at FROM jobs`);
		await pool.query(`ANALYZE "${schema}".questpie_dispatches`);
		await pool.query(`ANALYZE "${schema}"._private_jobs`);
		const captured: { text: string; values: unknown[] }[] = [];
		const wrapped = new WeakSet<pg.PoolClient>();
		(adapter as unknown as { pool: pg.Pool }).pool.on(
			"acquire",
			(connection) => {
				if (wrapped.has(connection)) return;
				wrapped.add(connection);
				connection.query = new Proxy(connection.query, {
					apply(target, receiver, args) {
						if (
							typeof args[0] === "string" &&
							(args[0].startsWith("SELECT d.*") ||
								args[0].startsWith("WITH batch AS MATERIALIZED"))
						)
							captured.push({
								text: args[0],
								values: Array.isArray(args[1]) ? args[1] : [],
							});
						return Reflect.apply(target, receiver, args);
					},
				});
			},
		);
		const expired = await adapter.publish("expired", {}, { retryLimit: 1 });
		await pool.query(
			`UPDATE "${schema}".questpie_dispatches SET status='active', attempts=1, lease_token=$2, lease_until=now()-interval '1 second' WHERE dispatch_id=$1`,
			[expired, randomUUID()],
		);
		const started = performance.now();
		await (
			adapter as unknown as { recoverLeases(): Promise<void> }
		).recoverLeases();
		expect(performance.now() - started).toBeLessThan(1000);
		expect(
			(
				await pool.query(
					`SELECT generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[expired],
				)
			).rows[0].generation,
		).toBe(1);
		expect(captured).toHaveLength(2);
		const plans: string[] = [];
		for (const query of captured) {
			const plan = await pool.query(
				"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.text,
				query.values,
			);
			const root = plan.rows[0]["QUERY PLAN"][0];
			expect(root["Execution Time"]).toBeLessThan(100);
			const text = JSON.stringify(root, null, 2);
			expect(text).not.toContain('"Node Type": "Seq Scan"');
			plans.push(text);
		}
		if (process.env.QUESTPIE_GRAPHILE_PLAN_OUTPUT)
			await Bun.write(
				process.env.QUESTPIE_GRAPHILE_PLAN_OUTPUT,
				plans.join("\n\n"),
			);
	}, 30000);

	test("Graphile shutdown cannot release a non-cooperative handler's fence early", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		let entered = false;
		const id = await adapter.publish(
			"shutdown-fence",
			{},
			{ expireInSeconds: 0.1 },
		);
		await adapter.listen({
			"shutdown-fence": async () => {
				entered = true;
				await blocked;
			},
		});
		await until(() => entered);
		const internal = adapter as unknown as {
			runner: {
				abortPromise: Promise<void>;
				gracefulShutdown(): Promise<void>;
				_shuttingDown: boolean;
			};
		};
		let stopped = false;
		const stopping = adapter.stop().then(() => {
			stopped = true;
		});
		try {
			await until(() => internal.runner._shuttingDown);
			// Graphile races task promises against its pool abort promise. Trigger
			// its normal five-second abort path, without ending the user promise.
			await internal.runner.abortPromise.catch(() => {});
			await Bun.sleep(100);
			expect(stopped).toBe(false);
			const lock = await pool.query(
				"SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
				[`questpie-execution:${schema}:${id}`],
			);
			expect(lock.rows[0].acquired).toBe(false);
		} finally {
			release();
			await stopping;
		}
		errors.length = 0; // Graphile reports its intentional pool abort as a job error.
	}, 15000);

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

	test.each(["permanently_fail_jobs", "complete_jobs", "remove_job"])(
		"broker administrative %s never resurrects work and reconciles secret keys",
		async (action) => {
			const ordinary = await adapter.publish(
				"cancelled",
				{},
				{ retryLimit: 5 },
			);
			const queue = makeQueue(adapter, db, async () => {});
			const secret = await queue.delivery.publish(
				{ value: "cancelled-secret" },
				{ secretPayload: true, idempotencyKey: randomUUID(), retryLimit: 5 },
			);
			for (const id of [ordinary, secret!]) {
				const [physical] = (
					await pool.query(
						`SELECT job_id FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[id],
					)
				).rows;
				if (action === "remove_job")
					await pool.query(`SELECT "${schema}".remove_job($1)`, [
						`questpie:${id}:0`,
					]);
				else
					await pool.query(`SELECT "${schema}".${action}(ARRAY[$1::bigint])`, [
						physical.job_id,
					]);
			}
			expect(await adapter.inspectExecutionState("cancelled", ordinary)).toBe(
				action === "permanently_fail_jobs" ? "failed" : "missing",
			);
			expect(
				await reconcileQueueDispatchExecutions({ adapter, db }),
			).toMatchObject({ terminal: 1 });
			const [receipt] = await db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, secret!));
			expect(receipt).toMatchObject({
				status: "failed",
				wrappedSecretKey: null,
			});
			let executions = 0;
			await adapter.listen({
				cancelled: async () => {
					executions++;
				},
			});
			expect(await adapter.inspectExecutionState("cancelled", ordinary)).toBe(
				"failed",
			);
			expect(executions).toBe(0);
			await queue.stop();
		},
	);

	test("a database lock timeout before admission preserves work and its retry budget", async () => {
		await adapter.stop();
		const restricted = new URL(url);
		restricted.searchParams.set("options", "-c lock_timeout=150ms");
		adapter = new GraphileWorkerAdapter({
			connectionString: restricted.toString(),
			schema,
			pollInterval: 100,
		});
		adapter.on("error", (error) => errors.push(error));
		const id = await adapter.publish(
			"admission",
			{},
			{ startAfter: 0.2, retryLimit: 5, expireInSeconds: 1 },
		);
		const lock = await pool.connect();
		let calls = 0;
		try {
			await lock.query("BEGIN");
			await lock.query(
				`SELECT FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1 FOR UPDATE`,
				[id],
			);
			await adapter.listen({
				admission: async () => {
					calls++;
				},
			});
			await until(() => errors.length > 0);
			expect(calls).toBe(0);
			expect(
				errors.every((error) => error.message.includes("lock timeout")),
			).toBe(true);
			expect(await adapter.inspectExecutionState("admission", id)).toBe(
				"pending",
			);
			await lock.query("COMMIT");
		} finally {
			await lock.query("ROLLBACK");
			lock.release();
		}
		await until(
			async () =>
				(await adapter.inspectExecutionState("admission", id)) === "completed",
		);
		expect(calls).toBe(1);
		const [receipt] = (
			await pool.query(
				`SELECT attempts FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
				[id],
			)
		).rows;
		expect(receipt.attempts).toBe(1);
		errors.length = 0;
	});

	test.each([0, 1])(
		"a completion lock timeout preserves success and the handler budget, retryLimit=%s",
		async (retryLimit) => {
			await adapter.stop();
			const restricted = new URL(url);
			restricted.searchParams.set("options", "-c lock_timeout=150ms");
			adapter = new GraphileWorkerAdapter({
				connectionString: restricted.toString(),
				schema,
				concurrentJobs: 1,
				pollInterval: 100,
			});
			adapter.on("error", (error) => errors.push(error));
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => (release = resolve));
			let calls = 0;
			const id = await adapter.publish(
				"completion",
				{},
				{ expireInSeconds: 0.2, retryLimit },
			);
			await adapter.listen({
				completion: async () => {
					calls++;
					await blocked;
				},
			});
			await until(() => calls === 1);
			const lock = await pool.connect();
			try {
				await lock.query("BEGIN");
				await lock.query(
					`SELECT FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1 FOR UPDATE`,
					[id],
				);
				release();
				await until(
					async () =>
						(
							await pool.query(
								"SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
								[
									`%SELECT * FROM "${schema}"."questpie_dispatches" WHERE dispatch_id%`,
								],
							)
						).rowCount! > 0,
				);
				await Bun.sleep(700);
				await lock.query("COMMIT");
				await until(
					async () =>
						(await adapter.inspectExecutionState("completion", id)) ===
						"completed",
				);
				expect(calls).toBe(1);
				const [receipt] = (
					await pool.query(
						`SELECT attempts FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[id],
					)
				).rows;
				expect(receipt.attempts).toBe(1);
				expect(
					errors.some((error) => error.message.includes("lock timeout")),
				).toBe(true);
			} finally {
				release();
				await lock.query("ROLLBACK");
				lock.release();
				await adapter.stop();
				errors.length = 0;
			}
		},
	);

	test.each([false, true])(
		"settlement timeout preserves a deferred secret without spending a handler attempt, beyond lease=%s",
		async (beyondLease) => {
			await adapter.stop();
			const restricted = new URL(url);
			restricted.searchParams.set("options", "-c lock_timeout=150ms");
			adapter = new GraphileWorkerAdapter({
				connectionString: restricted.toString(),
				schema,
				concurrentJobs: 1,
				pollInterval: 100,
				useApplicationTransaction: true,
			});
			adapter.on("error", (error) => errors.push(error));
			let calls = 0;
			const queue = makeQueue(adapter, db, async () => {
				calls++;
			});
			const id = (await queue.delivery.publish(
				{ value: "preserved" },
				{
					idempotencyKey: randomUUID(),
					secretPayload: true,
					retryLimit: 0,
					expireInSeconds: beyondLease ? 0.5 : 30,
				},
			))!;
			const claim = await claimQueueDispatchExecution(db, id);
			if (claim.status !== "claimed")
				throw new Error("Expected prior execution claim");
			const frameworkLock = await pool.connect();
			const adapterLock = await pool.connect();
			try {
				await frameworkLock.query("BEGIN");
				await frameworkLock.query(
					"SELECT FROM questpie_queue_dispatch WHERE dispatch_id=$1 FOR UPDATE",
					[id],
				);
				await queue.listen({ gracefulShutdown: false });
				await until(
					async () =>
						(
							await pool.query(
								"SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%queue_execution_owner%'",
							)
						).rowCount! > 0,
				);
				await adapterLock.query("BEGIN");
				await adapterLock.query(
					`SELECT FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1 FOR UPDATE`,
					[id],
				);
				await frameworkLock.query("COMMIT");
				await until(
					async () =>
						(
							await pool.query(
								"SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
								[
									`%SELECT * FROM "${schema}"."questpie_dispatches" WHERE dispatch_id%`,
								],
							)
						).rowCount! > 0,
				);
				await Bun.sleep(beyondLease ? 700 : 220);
				await adapterLock.query("COMMIT");
				await Bun.sleep(200);
				expect(calls).toBe(0);
				expect(await adapter.inspectExecutionState("delivery", id)).not.toBe(
					"failed",
				);
				await reconcileQueueDispatchExecutions({ adapter, db });
				const [pending] = (
					await pool.query(
						"SELECT wrapped_secret_key FROM questpie_queue_dispatch WHERE dispatch_id=$1",
						[id],
					)
				).rows;
				expect(pending.wrapped_secret_key).not.toBeNull();
				await releaseQueueDispatchExecution(db, id, claim.token);
				await until(
					async () => (await queue.getReceipt(id))?.status === "completed",
				);
				expect(calls).toBe(1);
				await until(
					async () =>
						(await adapter.inspectExecutionState("delivery", id)) ===
						"completed",
				);
				const [completed] = (
					await pool.query(
						`SELECT attempts FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[id],
					)
				).rows;
				expect(completed.attempts).toBe(1);
				expect(
					errors.some((error) => error.message.includes("lock timeout")),
				).toBe(true);
			} finally {
				for (const lock of [frameworkLock, adapterLock]) {
					await lock.query("ROLLBACK");
					lock.release();
				}
				await queue.stop();
				errors.length = 0;
			}
		},
	);

	test("task discovery recovers after a database timeout and reports the error", async () => {
		await adapter.stop();
		const restricted = new URL(url);
		restricted.searchParams.set("options", "-c lock_timeout=150ms");
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			listenConnectionString: restricted.toString(),
			schema,
			concurrentJobs: 2,
			pollInterval: 100,
		});
		adapter.on("error", (error) => errors.push(error));
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const lock = await pool.connect();
		try {
			await adapter.listen(
				{
					discovery: async () => {
						if (++calls === 1) await blocked;
					},
				},
				{ teamSize: 1, batchSize: 1 },
			);
			await adapter.publish("discovery", {});
			await until(() => calls === 1);
			await Bun.sleep(200);
			await lock.query("BEGIN");
			await lock.query(
				`LOCK TABLE "${schema}"._private_tasks IN ACCESS EXCLUSIVE MODE`,
			);
			release();
			await until(
				async () =>
					(
						await pool.query(
							`SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`,
							[`insert into "${schema}"._private_tasks%`],
						)
					).rowCount! > 0,
			);
			await Bun.sleep(220);
			await lock.query("COMMIT");
			const id = await adapter.publish("discovery", {});
			await until(
				async () =>
					(await adapter.inspectExecutionState("discovery", id)) ===
					"completed",
				2500,
			);
			expect(calls).toBe(2);
			expect(
				errors.some((error) => error.message.includes("lock timeout")),
			).toBe(true);
			errors.length = 0;
		} finally {
			release();
			await lock.query("ROLLBACK");
			lock.release();
		}
	});

	test("lease recovery serializes with an uncommitted permanent failure", async () => {
		const id = await adapter.publish("recovery", {}, { retryLimit: 2 });
		await pool.query(
			`UPDATE "${schema}".questpie_dispatches SET status='active', attempts=1, lease_token=$2, lease_until=now()-interval '1 second' WHERE dispatch_id=$1`,
			[id, randomUUID()],
		);
		const [{ job_id }] = (
			await pool.query(
				`SELECT job_id FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
				[id],
			)
		).rows;
		const lock = await pool.connect();
		let recovery: Promise<void> | undefined;
		try {
			await lock.query("BEGIN");
			await lock.query(
				`SELECT "${schema}".permanently_fail_jobs(ARRAY[$1::bigint])`,
				[job_id],
			);
			recovery = (
				adapter as unknown as { recoverLeases(): Promise<void> }
			).recoverLeases();
			await until(
				async () =>
					(
						await pool.query(
							"SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
							[`%${schema}%`],
						)
					).rowCount! > 0,
			);
			await lock.query("COMMIT");
			await recovery;
			expect(await adapter.inspectExecutionState("recovery", id)).toBe(
				"failed",
			);
			let calls = 0;
			await adapter.listen({
				recovery: async () => {
					calls++;
				},
			});
			await Bun.sleep(150);
			expect(calls).toBe(0);
		} finally {
			await lock.query("ROLLBACK");
			lock.release();
			await recovery;
		}
	});

	test("removing an active job prevents handler failure from creating a successor", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const id = await adapter.publish("removed", {}, { retryLimit: 2 });
		await adapter.listen({
			removed: async () => {
				calls++;
				await blocked;
				throw new Error("after administrative removal");
			},
		});
		try {
			await until(() => calls === 1);
			await pool.query(`SELECT "${schema}".remove_job($1)`, [
				`questpie:${id}:0`,
			]);
			expect(await adapter.inspectExecutionState("removed", id)).toBe("failed");
			release();
			await until(
				async () =>
					(await adapter.inspectExecutionState("removed", id)) === "failed",
			);
			await adapter.stop();
			expect(calls).toBe(1);
			expect(
				(
					await pool.query(
						`SELECT generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[id],
					)
				).rows[0].generation,
			).toBe(0);
		} finally {
			release();
		}
	});

	test("a removed fetched buffer job cannot enter its handler", async () => {
		await adapter.stop();
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			concurrentJobs: 1,
		});
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const seen: unknown[] = [];
		await adapter.publish("removed-buffer", 1);
		const removed = await adapter.publish("removed-buffer", 2);
		await adapter.listen(
			{
				"removed-buffer": async ({ data }) => {
					seen.push(data);
					if (data === 1) await blocked;
				},
			},
			{ teamSize: 2, batchSize: 2 },
		);
		try {
			await until(() => seen.length === 1);
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
			const cancellation = await pool.connect();
			try {
				await cancellation.query("BEGIN");
				await cancellation.query(`SELECT "${schema}".remove_job($1)`, [
					`questpie:${removed}:0`,
				]);
				release();
				await until(
					async () =>
						Number(
							(
								await pool.query(
									"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%_private_jobs%FOR UPDATE%'",
								)
							).rows[0].count,
						) > 0,
				);
				expect(seen).toEqual([1]);
				await cancellation.query("COMMIT");
			} finally {
				await cancellation.query("ROLLBACK");
				cancellation.release();
			}
			await until(
				async () =>
					(await adapter.inspectExecutionState("removed-buffer", removed)) ===
					"failed",
			);
			await adapter.stop();
			expect(seen).toEqual([1]);
		} finally {
			release();
		}
	});

	test.each([false, true])(
		"a new receipt lifetime preserves an older delayed job, new secret=%s",
		async (newSecret) => {
			const seen: string[] = [];
			const queue = makeQueue(adapter, db, async (payload) => {
				seen.push((payload as { value: string }).value);
			});
			const idempotencyKey = randomUUID();
			const original = await queue.delivery.publish(
				{ value: "old-delayed" },
				{ idempotencyKey, startAfter: 9 * 86400 },
			);
			await pool.query(
				`UPDATE questpie_queue_dispatch SET created_at=now()-interval '8 days', accepted_at=now()-interval '8 days' WHERE dispatch_id=$1`,
				[original],
			);
			await pool.query(
				`UPDATE "${schema}".questpie_dispatches SET created_at=now()-interval '8 days', available_at=now()+interval '1 day' WHERE dispatch_id=$1`,
				[original],
			);
			const [old] = (
				await pool.query(
					`SELECT job_id FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[original],
				)
			).rows;
			await pool.query(
				`SELECT "${schema}".reschedule_jobs(ARRAY[$1::bigint],run_at:=now()+interval '1 day')`,
				[old.job_id],
			);
			expect((await pruneQueueDispatches(db)).deleted).toBeGreaterThan(0);
			const fresh = await queue.delivery.publish(
				{ value: "new-immediate" },
				{ idempotencyKey, secretPayload: newSecret },
			);
			expect(fresh).not.toBe(original);
			await queue.listen({ gracefulShutdown: false });
			await until(() => seen.length === 1);
			expect(seen).toEqual(["new-immediate"]);
			await until(
				async () =>
					(await adapter.inspectExecutionState("delivery", fresh!)) ===
					"completed",
			);
			if (newSecret) {
				await until(
					async () => (await queue.getReceipt(fresh!))?.status === "completed",
				);
				expect((await queue.getReceipt(fresh!))?.status).toBe("completed");
			}
			await pool.query(
				`SELECT "${schema}".reschedule_jobs(ARRAY[$1::bigint],run_at:=now())`,
				[old.job_id],
			);
			await until(() => seen.length === 2);
			expect(seen).toEqual(["new-immediate", "old-delayed"]);
			await queue.stop();
		},
	);

	test("retired cleanup skips a full batch of locked jobs", async () => {
		await pool.query(`WITH jobs AS (
			SELECT * FROM "${schema}".add_jobs(ARRAY(SELECT
				('retired', '{}'::json, NULL, now(), 25, NULL, 0, NULL)::"${schema}".job_spec
				FROM generate_series(1,501)))
		) INSERT INTO "${schema}".questpie_retired_jobs (job_id) SELECT id FROM jobs`);
		await pool.query(
			`UPDATE "${schema}"._private_jobs SET locked_at=now(), locked_by='live-worker'`,
		);
		const removable = (
			await pool.query(`SELECT id FROM "${schema}".add_job('unlocked-retired', '{}'::json)
				UNION ALL SELECT id FROM "${schema}".add_job('stale-retired', '{}'::json)`)
		).rows.map((row) => row.id);
		await pool.query(
			`UPDATE "${schema}"._private_jobs SET locked_at=now()-interval '4 hours 1 second', locked_by='dead-worker' WHERE id=$1`,
			[removable[1]],
		);
		await pool.query(
			`INSERT INTO "${schema}".questpie_retired_jobs (job_id) VALUES ($1), ($2), (-1)`,
			removable,
		);
		const cleanupQueries: string[] = [];
		const wrapped = new WeakSet<pg.PoolClient>();
		(adapter as unknown as { pool: pg.Pool }).pool.on(
			"acquire",
			(connection) => {
				if (wrapped.has(connection)) return;
				wrapped.add(connection);
				connection.query = new Proxy(connection.query, {
					apply(target, receiver, args) {
						if (
							typeof args[0] === "string" &&
							args[0].includes('"complete_jobs"')
						)
							cleanupQueries.push(args[0]);
						return Reflect.apply(target, receiver, args);
					},
				});
			},
		);
		await (
			adapter as unknown as { tickSchedules(): Promise<void> }
		).tickSchedules();
		expect(
			(
				await pool.query(
					`SELECT FROM "${schema}".jobs WHERE id=ANY($1::bigint[])`,
					[removable],
				)
			).rowCount,
		).toBe(0);
		expect(
			(await pool.query(`SELECT FROM "${schema}".questpie_retired_jobs`))
				.rowCount,
		).toBe(501);
		expect(
			(
				await pool.query(
					`SELECT FROM "${schema}".jobs WHERE locked_by='live-worker'`,
				)
			).rowCount,
		).toBe(501);
		expect(
			(
				await pool.query(
					`SELECT FROM "${schema}".questpie_retired_jobs WHERE job_id=-1`,
				)
			).rowCount,
		).toBe(0);
		expect(cleanupQueries).toHaveLength(1);
		const plan = await pool.query(
			"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + cleanupQueries[0],
		);
		const planText = JSON.stringify(plan.rows[0]["QUERY PLAN"][0], null, 2);
		// The native queue is probed by primary key, even when all retirees are locked.
		expect(planText).toMatch(/"Index Name": "jobs_pkey\d*"/);
		expect(planText).toContain('"Index Cond": "(id = r.job_id)"');
		console.info(
			"Retired job cleanup EXPLAIN (ANALYZE, BUFFERS):\n" + planText,
		);
	});

	test.each([false, true])(
		"a key admits a new payload after framework retention before adapter cleanup, secret=%s",
		async (secret) => {
			const seen: string[] = [];
			const queue = makeQueue(adapter, db, async (payload) => {
				seen.push((payload as { value: string }).value);
			});
			await queue.listen({ gracefulShutdown: false });
			const options = { idempotencyKey: randomUUID(), secretPayload: secret };
			const id = await queue.delivery.publish({ value: "first" }, options);
			await until(
				async () =>
					(await adapter.inspectExecutionState("delivery", id!)) ===
					"completed",
			);
			await until(
				async () =>
					Number(
						(await pool.query(`SELECT count(*) FROM "${schema}".jobs`)).rows[0]
							.count,
					) === 0,
			);
			await db
				.update(questpieQueueDispatchTable)
				.set({
					acceptedAt: new Date(Date.now() - 8 * 86400_000),
					...(secret
						? { completedAt: new Date(Date.now() - 8 * 86400_000) }
						: {}),
				})
				.where(eq(questpieQueueDispatchTable.dispatchId, id!));
			// Admission precedes framework hand-off/completion. Leave the adapter's
			// completion recent to cover their different retention clocks as well.
			await pool.query(
				`UPDATE "${schema}".questpie_dispatches SET created_at=now()-interval '9 days' WHERE dispatch_id=$1`,
				[id],
			);
			expect((await pruneQueueDispatches(db)).deleted).toBeGreaterThan(0);
			const fresh = await queue.delivery.publish({ value: "second" }, options);
			await (
				adapter as unknown as { tickSchedules(): Promise<void> }
			).tickSchedules();
			await until(() => seen.length === 2);
			expect(seen).toEqual(["first", "second"]);
			if (secret)
				await until(
					async () => (await queue.getReceipt(fresh!))?.status === "completed",
				);
			await queue.stop();
		},
	);

	test.each([false, true])(
		"retained failed broker rows do not suppress a new receipt lifetime, secret=%s",
		async (secret) => {
			const seen: unknown[] = [];
			const queue = makeQueue(adapter, db, async (payload) => {
				seen.push(payload);
			});
			const options = { idempotencyKey: randomUUID(), secretPayload: secret };
			const id = await queue.delivery.publish({ value: "cancelled" }, options);
			const [old] = (
				await pool.query(
					`SELECT job_id FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[id],
				)
			).rows;
			await pool.query(
				`SELECT "${schema}".permanently_fail_jobs(ARRAY[$1::bigint])`,
				[old.job_id],
			);
			await queue.listen({ gracefulShutdown: false });
			if (secret) await reconcileQueueDispatchExecutions({ adapter, db });
			await db
				.update(questpieQueueDispatchTable)
				.set({
					acceptedAt: new Date(Date.now() - 8 * 86400_000),
					failedAt: new Date(Date.now() - 8 * 86400_000),
				})
				.where(eq(questpieQueueDispatchTable.dispatchId, id!));
			await pool.query(
				`UPDATE "${schema}".questpie_dispatches SET created_at=now()-interval '9 days' WHERE dispatch_id=$1`,
				[id],
			);
			expect(
				(
					await pool.query(`SELECT FROM "${schema}".jobs WHERE id=$1`, [
						old.job_id,
					])
				).rowCount,
			).toBe(1);
			expect((await pruneQueueDispatches(db)).deleted).toBeGreaterThan(0);
			const fresh = await queue.delivery.publish(
				{ value: "new-lifetime" },
				options,
			);
			await until(() => seen.length === 1);
			expect(seen).toEqual([{ value: "new-lifetime" }]);
			if (secret)
				await until(
					async () => (await queue.getReceipt(fresh!))?.status === "completed",
				);
			await queue.stop();
		},
	);

	test.each([false, true])(
		"framework receipts retain idempotency after earlier adapter cleanup, secret=%s",
		async (secret) => {
			let calls = 0;
			const queue = makeQueue(adapter, db, async () => {
				calls++;
			});
			await queue.listen({ gracefulShutdown: false });
			const options = { idempotencyKey: randomUUID(), secretPayload: secret };
			const id = await queue.delivery.publish({ value: "first" }, options);
			await until(
				async () =>
					(await adapter.inspectExecutionState("delivery", id!)) ===
					"completed",
			);
			await until(
				async () =>
					Number(
						(await pool.query(`SELECT count(*) FROM "${schema}".jobs`)).rows[0]
							.count,
					) === 0,
			);
			await pool.query(
				`UPDATE "${schema}".questpie_dispatches SET created_at=now()-interval '9 days' WHERE dispatch_id=$1`,
				[id],
			);
			await (
				adapter as unknown as { tickSchedules(): Promise<void> }
			).tickSchedules();
			expect(await adapter.inspectExecutionState("delivery", id!)).toBe(
				"missing",
			);
			expect(await queue.delivery.publish({ value: "replay" }, options)).toBe(
				id,
			);
			expect(calls).toBe(1);
			await queue.stop();
		},
	);

	test.each([false, true])(
		"expiry fences secret execution while scope disposal is blocked, aborting handler=%s",
		async (waitForAbort) => {
			let release!: () => void;
			const blocked = new Promise<void>((resolve) => (release = resolve));
			let calls = 0;
			let disposing = false;
			const app = { db, collections: {}, globals: {} };
			const queue = createQueueClient(
				{
					delivery: {
						name: "delivery",
						schema: z.object({ value: z.string() }),
						handler: async ({ signal }) => {
							if (++calls !== 1) return;
							getActiveRequestScope(app)!.set(
								"blocked-resource",
								{},
								async () => {
									disposing = true;
									await blocked;
								},
							);
							if (waitForAbort)
								await new Promise<void>((resolve) =>
									signal!.addEventListener("abort", () => resolve(), {
										once: true,
									}),
								);
						},
					},
				},
				adapter,
				{
					getDatabase: () => db,
					createContext: async () => ({ db }),
					getApp: () => app,
					secret: "graphile-test-root-secret-at-least-32-bytes",
					logger: { info() {}, warn() {}, error() {} },
				},
			);
			const id = await queue.delivery.publish(
				{ value: "private" },
				{
					secretPayload: true,
					idempotencyKey: randomUUID(),
					expireInSeconds: 0.4,
					retryLimit: 1,
				},
			);
			try {
				await queue.listen({ gracefulShutdown: false });
				await until(() => disposing);
				await Bun.sleep(650);
				expect(calls).toBe(1);
				release();
				await until(
					async () => (await queue.getReceipt(id!))?.status === "completed",
				);
				expect(calls).toBe(2);
				const [receipt] = await db
					.select()
					.from(questpieQueueDispatchTable)
					.where(eq(questpieQueueDispatchTable.dispatchId, id!));
				expect(receipt.wrappedSecretKey).toBeNull();
			} finally {
				release();
				await queue.stop();
			}
		},
	);

	test("secret completion requires the current token, while renewal requires a live deadline", async () => {
		const queue = makeQueue(adapter, db, async () => {});
		const id = await queue.delivery.publish(
			{ value: "private" },
			{ secretPayload: true, idempotencyKey: randomUUID() },
		);
		const old = await claimQueueDispatchExecution(db, id!);
		if (old.status !== "claimed") throw new Error("Expected initial claim");
		await db
			.update(questpieQueueDispatchTable)
			.set({ executionClaimedUntil: new Date(Date.now() - 1000) })
			.where(eq(questpieQueueDispatchTable.dispatchId, id!));
		expect(
			await renewQueueDispatchExecution(db, id!, old.token, {
				deadline: new Date(Date.now() + 60000),
			}),
		).toBe(false);
		const current = await claimQueueDispatchExecution(db, id!);
		if (current.status !== "claimed")
			throw new Error("Expected successor claim");
		await expect(completeQueueDispatch(db, id!, old.token)).rejects.toThrow();
		expect(
			await renewQueueDispatchExecution(db, id!, current.token, {
				deadline: new Date(0),
			}),
		).toBe(false);

		await completeQueueDispatch(db, id!, current.token);
		expect((await queue.getReceipt(id!))?.status).toBe("completed");
		await queue.stop();
	});

	test.each(["claim", "renew", "complete"])(
		"secret %s checks ownership after waiting for a row lock",
		async (operation) => {
			const queue = makeQueue(adapter, db, async () => {});
			const id = await queue.delivery.publish(
				{ value: "private" },
				{ secretPayload: true, idempotencyKey: randomUUID() },
			);
			const initial =
				operation === "claim"
					? undefined
					: await claimQueueDispatchExecution(db, id!);
			const token = initial?.status === "claimed" ? initial.token : "";
			const lock = await pool.connect();
			let attempt!: Promise<boolean>;
			try {
				await lock.query("BEGIN");
				await lock.query(
					`SELECT FROM "${getTableName(questpieQueueDispatchTable)}" WHERE dispatch_id=$1 FOR UPDATE`,
					[id],
				);
				const deadline = new Date(Date.now() + 200);
				attempt =
					operation === "claim"
						? claimQueueDispatchExecution(db, id!, { deadline }).then(
								(claim) => claim.status === "claimed",
							)
						: operation === "renew"
							? renewQueueDispatchExecution(db, id!, token, { deadline })
							: completeQueueDispatch(db, id!, token).then(
									() => true,
									() => false,
								);
				await Bun.sleep(350);
				await lock.query("COMMIT");
			} finally {
				await lock.query("ROLLBACK");
				lock.release();
			}
			expect(await attempt).toBe(operation === "complete");
			expect((await queue.getReceipt(id!))?.status).toBe(
				operation === "complete" ? "completed" : "queued",
			);
			await queue.stop();
		},
	);

	test("database expiry rejects success even when synchronous work delays the timer", async () => {
		let calls = 0;
		const final: boolean[] = [];
		const id = await adapter.publish(
			"sync-expiry",
			{},
			{ expireInSeconds: 0.15, retryLimit: 1 },
		);
		await adapter.listen({
			"sync-expiry": async ({ finalAttempt }) => {
				final.push(finalAttempt!);
				if (++calls === 1) {
					const end = performance.now() + 450;
					while (performance.now() < end) {
						/* Block timer delivery deliberately. */
					}
				}
			},
		});
		await until(
			async () =>
				(await adapter.inspectExecutionState("sync-expiry", id)) ===
				"completed",
		);
		expect(calls).toBe(2);
		expect(final).toEqual([false, true]);
	});

	test.each([false, true])(
		"failed listen cleans its runner before retry, separate URL=%s",
		async (separate) => {
			await adapter.stop();
			adapter = new GraphileWorkerAdapter({
				connectionString: url,
				schema,
				...(separate ? { listenConnectionString: url } : {}),
			});
			await adapter.start();
			const internal = adapter as unknown as {
				recoverLeases(): Promise<void>;
				runner?: unknown;
			};
			const recover = internal.recoverLeases;
			internal.recoverLeases = async () => {
				throw new Error("Initial recovery unavailable");
			};
			await expect(adapter.listen({ retry: async () => {} })).rejects.toThrow(
				"Initial recovery unavailable",
			);
			expect(internal.runner).toBeUndefined();
			internal.recoverLeases = recover;
			let calls = 0;
			await adapter.listen({
				retry: async () => {
					calls++;
				},
			});
			await adapter.publish("retry", {});
			await until(() => calls === 1);
			await adapter.stop();
			expect(
				Number(
					(
						await pool.query(
							"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'LISTEN%' AND state='idle'",
						)
					).rows[0].count,
				),
			).toBe(0);
		},
	);

	test("stop waits for in-flight listener initialization and leaves no runner", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const internal = adapter as unknown as {
			recoverLeases(): Promise<void>;
			runner?: unknown;
		};
		internal.recoverLeases = () => blocked;
		const listening = adapter.listen({ startup: async () => {} });
		await until(() => internal.runner !== undefined);
		let stopped = false;
		const stopping = adapter.stop().then(() => {
			stopped = true;
		});
		try {
			await Bun.sleep(50);
			expect(stopped).toBe(false);
		} finally {
			release();
			await Promise.all([listening, stopping]);
		}
		expect(internal.runner).toBeUndefined();
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
		await until(() => attempts === 1);
		await Bun.sleep(250);
		expect(attempts).toBe(1);
		releaseOld();
		await until(
			async () =>
				(await adapter.inspectExecutionState("late", id)) === "completed",
		);
		await Bun.sleep(100);
		expect(attempts).toBe(2);
		expect(await adapter.inspectExecutionState("late", id)).toBe("completed");
	});

	test("a saturated name releases fetched slots so independent work progresses", async () => {
		await adapter.stop();
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			concurrentJobs: 3,
			pollInterval: 60_000,
		});
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const seen: number[] = [];
		await adapter.publish(
			"permit",
			{ order: 1 },
			{ expireInSeconds: 30, retryLimit: 0 },
		);
		const waiting = await adapter.publish(
			"permit",
			{ order: 2 },
			{ expireInSeconds: 0.1, retryLimit: 0 },
		);
		await adapter.publish(
			"permit",
			{ order: 3 },
			{ expireInSeconds: 0.1, retryLimit: 0 },
		);
		let independent = false;
		await adapter.listen(
			{
				permit: async ({ data }) => {
					const order = (data as { order: number }).order;
					seen.push(order);
					if (order === 1) await blocked;
				},
				independent: async () => {
					independent = true;
				},
			},
			{ teamSize: 1, batchSize: 3 },
		);
		try {
			await until(() => seen.length === 1);
			await Bun.sleep(100);
			expect(
				(
					await pool.query(
						`SELECT generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
						[waiting],
					)
				).rows[0].generation,
			).toBe(0);
			await adapter.publish("independent", {}, { priority: 32768 });
			await until(() => independent, 2000);
			expect(seen).toEqual([1]);
			const [receipt] = (
				await pool.query(
					`SELECT attempts, status FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[waiting],
				)
			).rows;
			expect(receipt).toMatchObject({ attempts: 0, status: "pending" });
			release();
			await until(() => seen.length === 3, 2000);
			expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
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

	test("a worker killed before secret claim admission preserves retryLimit zero", async () => {
		let calls = 0;
		const queue = makeQueue(adapter, db, async () => {
			calls++;
		});
		const id = (await queue.delivery.publish(
			{ value: "survives-preflight-crash" },
			{
				idempotencyKey: randomUUID(),
				secretPayload: true,
				retryLimit: 0,
				expireInSeconds: 1,
			},
		))!;
		const claim = await claimQueueDispatchExecution(db, id);
		if (claim.status !== "claimed")
			throw new Error("Expected prior execution claim");
		const lock = await pool.connect();
		await lock.query("BEGIN");
		await lock.query(
			"SELECT FROM questpie_queue_dispatch WHERE dispatch_id=$1 FOR UPDATE",
			[id],
		);
		const child = Bun.spawn(
			[
				process.execPath,
				new URL(
					"../fixtures/queue-graphile-worker/secret-claim-worker.ts",
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
			await until(
				async () =>
					(
						await pool.query(
							"SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%queue_execution_owner%'",
						)
					).rowCount! > 0,
				20000,
			);
			child.kill("SIGKILL");
			await child.exited;
			await lock.query("COMMIT");
			await releaseQueueDispatchExecution(db, id, claim.token);
			await queue.listen({ gracefulShutdown: false });
			await until(
				async () => (await queue.getReceipt(id))?.status === "completed",
			);
			expect(calls).toBe(1);
			await until(
				async () =>
					(await adapter.inspectExecutionState("delivery", id)) === "completed",
			);
			const [receipt] = (
				await pool.query(
					`SELECT attempts, generation FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[id],
				)
			).rows;
			expect(receipt.attempts).toBe(1);
			expect(receipt.generation).toBeGreaterThan(0);
		} finally {
			child.kill("SIGKILL");
			await child.exited;
			await lock.query("ROLLBACK");
			lock.release();
			await queue.stop();
		}
	});

	test("a worker killed while holding a fetched buffer job does not hold it for four hours", async () => {
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
					QUESTPIE_GRAPHILE_CRASH_CONCURRENCY: "1",
					QUESTPIE_GRAPHILE_CRASH_BATCH: "2",
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
				6000,
			);
			expect(seen).toEqual([{ order: 2 }]);
			expect(await adapter.inspectExecutionState("crash", long)).toBe("active");
		} finally {
			child.kill("SIGKILL");
			await child.exited;
		}
	});

	test("stop preserves a fetched buffer without invoking its handler or spending a retry", async () => {
		await adapter.stop();
		adapter = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			concurrentJobs: 1,
		});
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const seen: unknown[] = [];
		await adapter.publish("buffer-stop", 1);
		const waiting = await adapter.publish("buffer-stop", 2, { retryLimit: 0 });
		await adapter.listen(
			{
				"buffer-stop": async ({ data }) => {
					seen.push(data);
					if (data === 1) await blocked;
				},
			},
			{ teamSize: 2, batchSize: 2 },
		);
		await until(() => seen.length === 1);
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
		const stopping = adapter.stop();
		release();
		await stopping;
		expect(seen).toEqual([1]);
		expect(
			(
				await pool.query(
					`SELECT status, attempts FROM "${schema}".questpie_dispatches WHERE dispatch_id=$1`,
					[waiting],
				)
			).rows[0],
		).toMatchObject({ status: "pending", attempts: 0 });
		await adapter.listen({
			"buffer-stop": async ({ data }) => {
				seen.push(data);
			},
		});
		await until(() => seen.includes(2));
		expect(seen[0]).toBe(1);
		expect(seen.filter((value) => value === 2)).toHaveLength(1);
	});

	test("shutdown aborts and drains active handlers before releasing connections; repeated stop is safe", async () => {
		let entered = false;
		let aborted = false;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		await adapter.publish("shutdown", {});
		await adapter.listen({
			shutdown: async ({ signal }) => {
				signal?.addEventListener("abort", () => {
					aborted = true;
				});
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
		expect(aborted).toBe(true);
		expect(
			(
				await pool.query(
					`SELECT status, attempts FROM "${schema}".questpie_dispatches`,
				)
			).rows[0],
		).toMatchObject({ status: "pending", attempts: 0 });
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
	runtimeSecret: string | null = "graphile-test-root-secret-at-least-32-bytes",
	missingContextDb = false,
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
			createContext: async () => ({ db: missingContextDb ? undefined : db }),
			getApp: () => ({ db, collections: {}, globals: {} }),
			secret: runtimeSecret ?? undefined,
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
