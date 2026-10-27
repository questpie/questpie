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
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import pg from "pg";
import postgres from "postgres";
import { z } from "zod";

import { GraphileWorkerAdapter } from "../../src/exports/adapters/graphile-worker.js";
import { PgBossAdapter } from "../../src/exports/adapters/pg-boss.js";
import { ErrorReportingService } from "../../src/server/modules/core/integrated/errors/service.js";
import type { ErrorReport } from "../../src/server/modules/core/integrated/errors/types.js";
import type { QueueAdapter } from "../../src/server/modules/core/integrated/queue/adapter.js";
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

		test("does not report an attempt cancelled by its execution timeout", async () => {
			let aborted = false;
			const slow = {
				name: "errors-graphile-timeout",
				schema: z.object({}),
				handler: async ({ signal }: { signal?: AbortSignal }) => {
					await new Promise<never>((_, reject) =>
						signal?.addEventListener("abort", () => {
							aborted = true;
							reject(new Error("aborted by timeout"));
						}),
					);
				},
			};
			const queue = makeQueue({ slow }, await graphile());

			await queue.slow.publish({}, { retryLimit: 0, expireInSeconds: 0.2 });
			await queue.listen({ gracefulShutdown: false });
			await until(() => aborted);
			await Bun.sleep(300);

			expect(reportsFor("errors-graphile-timeout")).toHaveLength(0);
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
