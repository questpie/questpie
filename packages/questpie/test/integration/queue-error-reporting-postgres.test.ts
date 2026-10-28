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
import { PgBossAdapter } from "../../src/exports/adapters/pg-boss.js";
import { ErrorReportingService } from "../../src/server/modules/core/integrated/errors/service.js";
import type { ErrorReport } from "../../src/server/modules/core/integrated/errors/types.js";
import type { QueueAdapter } from "../../src/server/modules/core/integrated/queue/adapter.js";
import { claimQueueDispatchExecution } from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";

/**
 * Queue error reporting against real adapters: what the mock-adapter tests in
 * error-reporting.test.ts cannot show — the `final` classification each
 * adapter derives from its own retry state, real retries, real concurrency,
 * and cancellation by an adapter's abort signal.
 */

const databaseUrl = process.env.QUESTPIE_QUEUE_POSTGRES_URL;
const databaseName = `queue_errors_${randomUUID().replaceAll("-", "")}`;
const rootSecret = "queue-error-root-secret-at-least-32-bytes";
const SECRET = "sk_live_QUEUE_SENTINEL_5e4d3c2b";

describe.skipIf(!databaseUrl)("queue error reporting on PostgreSQL", () => {
	let admin: pg.Pool;
	let client: ReturnType<typeof postgres>;
	let db: ReturnType<typeof drizzle>;
	let url: string;
	let schema: string;
	let adapters: QueueAdapter[];
	let captured: Array<{ error: unknown; report: ErrorReport }>;
	let reporterBehaviour: () => void | Promise<unknown>;
	let errors: ErrorReportingService;

	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		const target = new URL(databaseUrl!);
		target.pathname = `/${databaseName}`;
		url = target.toString();
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
		if (admin) {
			await admin.query(
				`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
			);
			await admin.end();
		}
	});

	beforeEach(() => {
		schema = `qe_${randomUUID().replaceAll("-", "")}`;
		adapters = [];
		captured = [];
		reporterBehaviour = () => {};
		errors = new ErrorReportingService({
			adapter: {
				report(error, report) {
					captured.push({ error, report });
					return reporterBehaviour();
				},
			},
		});
	});

	afterEach(async () => {
		await Promise.allSettled(adapters.map((adapter) => adapter.stop?.()));
		const pool = new pg.Pool({ connectionString: url });
		try {
			await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		} finally {
			await pool.end();
		}
	});

	function pgBoss() {
		const adapter = new PgBossAdapter({
			connectionString: url,
			schema,
			useApplicationTransaction: false,
		});
		adapters.push(adapter);
		return adapter;
	}

	async function graphile() {
		const adapter = new GraphileWorkerAdapter({
			connectionString: url,
			schema,
			concurrentJobs: 2,
			pollInterval: 50,
		});
		adapters.push(adapter);
		await adapter.start();
		return adapter;
	}

	function makeQueue<TJobs extends Record<string, any>>(
		jobs: TJobs,
		adapter: QueueAdapter,
	) {
		return createQueueClient(jobs, adapter, {
			getDatabase: () => db,
			createContext: async () => ({ db }),
			getApp: () => ({ db, collections: {}, globals: {}, errors }),
			secret: rootSecret,
			logger: { info() {}, warn() {}, error() {} },
		});
	}

	const reportsFor = (name: string) =>
		captured.filter((entry) => entry.report.job === name);

	async function jobStates(name: string): Promise<string[]> {
		const pool = new pg.Pool({ connectionString: url });
		try {
			const { rows } = await pool.query(
				`SELECT state FROM "${schema}".job WHERE name = $1`,
				[name],
			);
			return rows.map((row) => row.state as string);
		} finally {
			await pool.end();
		}
	}

	async function dispatchClaim(dispatchId: string) {
		const [row] = await db
			.select({
				executionClaimToken: questpieQueueDispatchTable.executionClaimToken,
				executionClaimedUntil: questpieQueueDispatchTable.executionClaimedUntil,
			})
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		return row;
	}

	/** At-least-once delivery: the broker hands a settled job out once more. */
	async function redeliverBrokerJob(id: string): Promise<void> {
		const pool = new pg.Pool({ connectionString: url });
		try {
			await pool.query(
				`UPDATE "${schema}".job
				SET state = 'created', completed_on = NULL, start_after = now()
				WHERE id = $1::uuid`,
				[id],
			);
		} finally {
			await pool.end();
		}
	}

	describe("pg-boss", () => {
		test("reports each failed attempt, with final set by the adapter on the last", async () => {
			let attempts = 0;
			const failing = {
				name: "errors-retry",
				schema: z.object({}),
				options: { retryLimit: 1, retryDelay: 0 },
				handler: async () => {
					attempts += 1;
					throw new Error(`attempt ${attempts} failed`);
				},
			};
			const queue = makeQueue({ failing }, pgBoss());

			await queue.failing.publish({});
			await until(async () => {
				await queue.runOnce().catch(() => {});
				return attempts >= 2;
			});
			await queue.runOnce().catch(() => {});

			expect(attempts).toBe(2);
			expect(await jobStates("errors-retry")).toEqual(["failed"]);
			const reports = reportsFor("errors-retry");
			expect(reports.map((entry) => entry.report)).toEqual([
				{ source: "job", job: "errors-retry", final: false },
				{ source: "job", job: "errors-retry", final: true },
			]);
			expect(reports.map((entry) => (entry.error as Error).message)).toEqual([
				"attempt 1 failed",
				"attempt 2 failed",
			]);
		});

		test("keeps the retry and the terminal failure when the reporter throws or rejects", async () => {
			for (const behaviour of [
				() => {
					throw new Error("reporter broke");
				},
				() => Promise.reject(new Error("reporter rejected")),
			]) {
				reporterBehaviour = behaviour;
				let attempts = 0;
				const failing = {
					name: `errors-broken-reporter-${randomUUID().slice(0, 8)}`,
					schema: z.object({}),
					options: { retryLimit: 1, retryDelay: 0 },
					handler: async () => {
						attempts += 1;
						throw new Error("handler failed");
					},
				};
				const queue = makeQueue({ failing }, pgBoss());

				await queue.failing.publish({});
				await until(async () => {
					await queue.runOnce().catch(() => {});
					return attempts >= 2;
				});
				await queue.runOnce().catch(() => {});

				// The broker's own record: retried once, then failed for good.
				expect(attempts).toBe(2);
				expect(await jobStates(failing.name)).toEqual(["failed"]);
				expect(reportsFor(failing.name)).toHaveLength(2);
			}
		});

		test("keeps the handler's transactions and the execution claim release when the reporter throws or rejects", async () => {
			await db.execute(
				sql`CREATE TABLE IF NOT EXISTS queue_error_marker (name text PRIMARY KEY)`,
			);
			for (const behaviour of [
				() => {
					throw new Error("reporter broke");
				},
				() => Promise.reject(new Error("reporter rejected")),
			]) {
				reporterBehaviour = behaviour;
				const run = randomUUID().slice(0, 8);
				let attempts = 0;
				const failing = {
					name: `errors-transaction-${run}`,
					schema: z.object({ token: z.string() }),
					handler: async () => {
						attempts += 1;
						if (attempts === 1) {
							await db.transaction(async (tx) => {
								await tx.execute(
									sql`INSERT INTO queue_error_marker VALUES (${`${run}-rolled-back`})`,
								);
								throw new Error("failed inside the transaction");
							});
						}
						await db.transaction((tx) =>
							tx.execute(
								sql`INSERT INTO queue_error_marker VALUES (${`${run}-committed`})`,
							),
						);
						throw new Error("failed after the commit");
					},
				};
				const queue = makeQueue({ failing }, pgBoss());

				const dispatchId = (await queue.failing.publish(
					{ token: SECRET },
					{
						secretPayload: true,
						idempotencyKey: randomUUID(),
						retryLimit: 1,
						retryDelay: 0,
					},
				))!;
				await until(async () => {
					await queue.runOnce().catch(() => {});
					return attempts >= 2;
				});
				await queue.runOnce().catch(() => {});

				// The second attempt could claim the dispatch only because the first
				// released its claim after the reporter failed.
				expect(attempts).toBe(2);
				const markers = await db.execute(
					sql`SELECT name FROM queue_error_marker WHERE name LIKE ${`${run}-%`}`,
				);
				expect(markers.map((row) => row.name)).toEqual([`${run}-committed`]);
				expect(await dispatchClaim(dispatchId)).toEqual({
					executionClaimToken: null,
					executionClaimedUntil: null,
				});
				await queue.drain();
				expect((await queue.getReceipt(dispatchId))?.status).toBe("failed");
				expect(
					reportsFor(failing.name).map((entry) => entry.report.final),
				).toEqual([false, true]);
			}
		});

		test("reports a redelivered secret job once per attempt that runs, and not when the dispatch is owned or settled", async () => {
			let calls = 0;
			const redelivered = {
				name: "errors-redelivery",
				schema: z.object({ token: z.string() }),
				handler: async () => {
					calls += 1;
					throw new Error(`attempt ${calls} failed`);
				},
			};
			const queue = makeQueue({ redelivered }, pgBoss());
			const deliver = () => queue.runOnce().catch(() => {});

			const dispatchId = (await queue.redelivered.publish(
				{ token: SECRET },
				{
					secretPayload: true,
					idempotencyKey: randomUUID(),
					retryLimit: 2,
					retryDelay: 0,
				},
			))!;

			// Delivered while another worker's attempt still owns the dispatch:
			// that attempt reports its own outcome, this delivery reports nothing.
			expect((await claimQueueDispatchExecution(db, dispatchId)).status).toBe(
				"claimed",
			);
			await deliver();
			expect(calls).toBe(0);
			expect(reportsFor("errors-redelivery")).toHaveLength(0);

			// That worker crashed and its claim lapsed: the redelivered attempt runs
			// and is reported once, as is the final attempt after it.
			await db
				.update(questpieQueueDispatchTable)
				.set({ executionClaimedUntil: new Date(0) })
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			await until(async () => {
				await deliver();
				return calls === 2;
			});
			await queue.drain();
			expect((await queue.getReceipt(dispatchId))?.status).toBe("failed");

			// A late duplicate of the settled dispatch runs and reports nothing.
			await redeliverBrokerJob(dispatchId);
			await deliver();
			expect(await jobStates("errors-redelivery")).toEqual(["completed"]);

			expect(calls).toBe(2);
			const reports = reportsFor("errors-redelivery");
			expect(reports.map((entry) => entry.report.final)).toEqual([
				false,
				true,
			]);
			expect(
				reports.map((entry) => (entry.error as Error).message),
			).toEqual([
				"QUESTPIE Queue secret job handling failed",
				"QUESTPIE Queue secret job handling failed",
			]);
		});

		test("reports two concurrent attempts separately, even when they throw the same error object", async () => {
			const shared = new Error("shared failure");
			let inFlight = 0;
			let release!: () => void;
			const bothRunning = new Promise<void>((resolve) => (release = resolve));
			const concurrent = {
				name: "errors-concurrent",
				schema: z.object({ n: z.number() }),
				options: { retryLimit: 0 },
				handler: async () => {
					inFlight += 1;
					if (inFlight === 2) release();
					await bothRunning;
					throw shared;
				},
			};
			const queue = makeQueue({ concurrent }, pgBoss());

			await queue.concurrent.publish({ n: 1 });
			await queue.concurrent.publish({ n: 2 });
			await queue.listen({
				teamSize: 2,
				batchSize: 1,
				gracefulShutdown: false,
			} as never);
			await until(() => reportsFor("errors-concurrent").length === 2);

			const reports = reportsFor("errors-concurrent");
			expect(reports.every((entry) => entry.error === shared)).toBe(true);
			expect(reports.map((entry) => entry.report.final)).toEqual([true, true]);
		});

		test("hands only the redacted error of a secret job to the reporter", async () => {
			const secretJob = {
				name: "errors-secret",
				schema: z.object({ token: z.string() }),
				options: { retryLimit: 0 },
				handler: async ({ payload }: { payload: { token: string } }) => {
					throw new Error(`provider rejected ${payload.token}`, {
						cause: new Error(payload.token),
					});
				},
			};
			const queue = makeQueue({ secretJob }, pgBoss());

			await queue.secretJob.publish(
				{ token: SECRET },
				{ secretPayload: true, idempotencyKey: randomUUID(), retryLimit: 0 },
			);
			await until(async () => {
				await queue.runOnce().catch(() => {});
				return reportsFor("errors-secret").length === 1;
			});

			const [entry] = reportsFor("errors-secret");
			const error = entry!.error as Error;
			expect(error.message).toBe("QUESTPIE Queue secret job handling failed");
			expect(error.cause).toBeUndefined();
			expect(String(error.stack)).not.toContain(SECRET);
			expect(JSON.stringify(entry!.report)).not.toContain(SECRET);
			expect(entry!.report).toEqual({
				source: "job",
				job: "errors-secret",
				final: true,
			});
		});
	});

	describe("graphile-worker", () => {
		test("reports a failed attempt with final set by the adapter", async () => {
			const failing = {
				name: "errors-graphile-failing",
				schema: z.object({}),
				handler: async () => {
					throw new Error("handler failed");
				},
			};
			const queue = makeQueue({ failing }, await graphile());

			await queue.failing.publish({}, { retryLimit: 0 });
			await queue.listen({ gracefulShutdown: false });
			await until(() => reportsFor("errors-graphile-failing").length === 1);

			expect(reportsFor("errors-graphile-failing")[0]!.report).toEqual({
				source: "job",
				job: "errors-graphile-failing",
				final: true,
			});
		});

		test("reports an attempt that runs past its execution timeout, once", async () => {
			let finished = false;
			const slow = {
				name: "errors-graphile-timeout",
				schema: z.object({}),
				// Ignores the signal and finishes well after the deadline.
				handler: async () => {
					await Bun.sleep(600);
					finished = true;
				},
			};
			const queue = makeQueue({ slow }, await graphile());

			await queue.slow.publish({}, { retryLimit: 0, expireInSeconds: 0.2 });
			await queue.listen({ gracefulShutdown: false });
			// Reported at the deadline, before the handler is done.
			await until(() => reportsFor("errors-graphile-timeout").length === 1);
			expect(finished).toBe(false);
			await until(() => finished);
			await Bun.sleep(300);

			const reports = reportsFor("errors-graphile-timeout");
			expect(reports).toHaveLength(1);
			expect((reports[0]!.error as Error).name).toBe(
				"QueueExecutionTimeoutError",
			);
			expect(reports[0]!.report).toEqual({
				source: "job",
				job: "errors-graphile-timeout",
				final: true,
			});
		});

		test("does not report an attempt cancelled by worker shutdown", async () => {
			let started = false;
			let aborted = false;
			const blocking = {
				name: "errors-graphile-shutdown",
				schema: z.object({}),
				handler: async ({ signal }: { signal?: AbortSignal }) => {
					started = true;
					await new Promise<never>((_, reject) =>
						signal?.addEventListener("abort", () => {
							aborted = true;
							reject(new Error("aborted by shutdown"));
						}),
					);
				},
			};
			const queue = makeQueue({ blocking }, await graphile());

			await queue.blocking.publish({}, { retryLimit: 0 });
			await queue.listen({ gracefulShutdown: false });
			await until(() => started);
			await queue.stop();

			expect(aborted).toBe(true);
			expect(reportsFor("errors-graphile-shutdown")).toHaveLength(0);
		});
	});
});

async function until(
	predicate: () => boolean | Promise<boolean>,
	timeout = 15_000,
): Promise<void> {
	const deadline = performance.now() + timeout;
	while (!(await predicate())) {
		if (performance.now() > deadline)
			throw new Error("Timed out waiting for queue condition");
		await Bun.sleep(25);
	}
}
