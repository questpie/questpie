import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { job } from "../../src/exports/index.js";
import {
	getTransactionContext,
	withTransaction,
} from "../../src/server/collection/crud/shared/transaction.js";
import { BullMQAdapter } from "../../src/server/modules/core/integrated/queue/adapters/bullmq.js";
import { CloudflareQueuesAdapter } from "../../src/server/modules/core/integrated/queue/adapters/cloudflare-queues.js";
import { PgBossAdapter } from "../../src/server/modules/core/integrated/queue/adapters/pg-boss.js";
import {
	claimQueueDispatches,
	drainQueueDispatches,
} from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const notifyJob = job({
	name: "notify",
	schema: z.object({ value: z.string() }),
	handler: async () => {},
});

setDefaultTimeout(30_000);

type ExternalAdapterHarness = {
	accepted: Array<{ dispatchId?: string; payload: unknown }>;
	adapter: BullMQAdapter | CloudflareQueuesAdapter;
	failAlways: () => void;
	failNext: (options?: { afterAcceptance?: boolean }) => void;
};

function makeBullMqHarness(): ExternalAdapterHarness {
	const accepted = new Map<string, { dispatchId?: string; payload: unknown }>();
	let failure: "before" | "after" | undefined;
	let alwaysFail = false;
	const adapter = new BullMQAdapter({
		connection: { host: "127.0.0.1", port: 6379 },
	});
	(adapter as any).getQueue = () => ({
		add: async (
			_name: string,
			data: {
				__questpieQueue?: { dispatchId?: string };
				payload?: unknown;
			},
			options: { jobId?: string },
		) => {
			if (alwaysFail || failure === "before") {
				failure = undefined;
				throw new Error("BullMQ unavailable");
			}
			const dispatchId = options.jobId;
			const existing = dispatchId ? accepted.get(dispatchId) : undefined;
			if (!existing) {
				accepted.set(dispatchId ?? crypto.randomUUID(), {
					dispatchId,
					payload: data.payload,
				});
			}
			if (failure === "after") {
				failure = undefined;
				throw new Error("BullMQ receipt lost");
			}
			return { id: dispatchId };
		},
	});
	return {
		adapter,
		get accepted() {
			return [...accepted.values()];
		},
		failAlways: () => {
			alwaysFail = true;
		},
		failNext: (options) => {
			failure = options?.afterAcceptance ? "after" : "before";
		},
	};
}

function makeCloudflareHarness(): ExternalAdapterHarness {
	const accepted: Array<{ dispatchId?: string; payload: unknown }> = [];
	let failure: "before" | "after" | undefined;
	let alwaysFail = false;
	const adapter = new CloudflareQueuesAdapter({
		enqueue: async (message) => {
			if (alwaysFail || failure === "before") {
				failure = undefined;
				throw new Error("Cloudflare unavailable");
			}
			accepted.push({
				dispatchId: message.dispatchId,
				payload: message.payload,
			});
			if (failure === "after") {
				failure = undefined;
				throw new Error("Cloudflare receipt lost");
			}
			return null;
		},
	});
	return {
		accepted,
		adapter,
		failAlways: () => {
			alwaysFail = true;
		},
		failNext: (options) => {
			failure = options?.afterAcceptance ? "after" : "before";
		},
	};
}

describe("transactional queue dispatch", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let cleanup: (() => Promise<void>) | undefined;

	beforeEach(async () => {
		cleanup = undefined;
		setup = await buildMockApp({ jobs: { notify: notifyJob } });
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	test("business rollback creates neither an adapter job nor a dispatch row", async () => {
		await expect(
			withTransaction(setup.app.db, async () => {
				await setup.app.queue.notify.publish(
					{ value: "rolled-back" },
					{ idempotencyKey: "notify:rollback" },
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");

		expect(setup.app.mocks.queue.getJobs()).toHaveLength(0);
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
	});

	test("recovers a committed dispatch when the post-commit fast path fails", async () => {
		setup.app.mocks.queue.failNextPublishes(1);
		const dispatchId = await withTransaction(setup.app.db, async () =>
			setup.app.queue.notify.publish(
				{ value: "recover" },
				{ idempotencyKey: "notify:recover" },
			),
		);

		expect(setup.app.mocks.queue.getJobs()).toHaveLength(0);
		expect(
			await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId)),
		).toMatchObject([{ status: "pending", dispatchId }]);

		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		await setup.app.queue.drain();
		expect(setup.app.mocks.queue.getJobs()).toMatchObject([
			{ dispatchId, name: "notify", payload: { value: "recover" } },
		]);
		expect(
			await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId)),
		).toMatchObject([
			{
				status: "accepted",
				dispatchId,
				payload: null,
				options: null,
			},
		]);
	});

	test("deduplicates one idempotency key to one logical adapter job", async () => {
		const dispatchIds = await withTransaction(setup.app.db, async () =>
			Promise.all([
				setup.app.queue.notify.publish(
					{ value: "first" },
					{ idempotencyKey: "notify:duplicate" },
				),
				setup.app.queue.notify.publish(
					{ value: "second" },
					{ idempotencyKey: "notify:duplicate" },
				),
			]),
		);

		expect(new Set(dispatchIds).size).toBe(1);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
		expect(setup.app.mocks.queue.getJobs()[0]).toMatchObject({
			dispatchId: dispatchIds[0],
			payload: { value: "first" },
		});
	});

	test("coalesces a transaction's post-commit relay wake", async () => {
		let registeredCallbacks = 0;
		await withTransaction(setup.app.db, async () => {
			await setup.app.queue.notify.publish(
				{ value: "first" },
				{ idempotencyKey: "notify:coalesce:first" },
			);
			await setup.app.queue.notify.publish(
				{ value: "second" },
				{ idempotencyKey: "notify:coalesce:second" },
			);
			registeredCallbacks = getTransactionContext()?.afterCommit.length ?? 0;
		});

		expect(registeredCallbacks).toBe(1);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(2);
	});

	test("drains a bounded multi-batch recovery burst", async () => {
		setup.app.mocks.queue.failNextPublishes(3);
		await withTransaction(setup.app.db, async () => {
			for (let index = 0; index < 3; index += 1) {
				await setup.app.queue.notify.publish(
					{ value: `burst-${index}` },
					{ idempotencyKey: `notify:burst:${index}` },
				);
			}
		});
		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) });

		await expect(
			setup.app.queue.drain({
				batchSize: 1,
				concurrency: 1,
				maxBatches: 3,
			}),
		).resolves.toEqual({
			claimed: 3,
			accepted: 3,
			failed: 0,
			terminal: 0,
		});
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(3);
		await expect(setup.app.queue.drain({ maxBatches: 101 })).rejects.toThrow(
			"between 1 and 100",
		);
	});

	test("deduplicates direct outside-transaction retries through a short dispatch transaction", async () => {
		const first = await setup.app.queue.notify.publish(
			{ value: "first" },
			{ idempotencyKey: "notify:direct-duplicate" },
		);
		const second = await setup.app.queue.notify.publish(
			{ value: "second" },
			{ idempotencyKey: "notify:direct-duplicate" },
		);

		expect(second).toBe(first);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
		expect(setup.app.mocks.queue.getJobs()[0]).toMatchObject({
			dispatchId: first,
			payload: { value: "first" },
		});
	});

	test("rejects empty or unbounded idempotency keys before dispatch", async () => {
		await expect(
			setup.app.queue.notify.publish(
				{ value: "empty" },
				{ idempotencyKey: "" },
			),
		).rejects.toThrow("between 1 and 512 characters");
		await expect(
			setup.app.queue.notify.publish(
				{ value: "oversized" },
				{ idempotencyKey: "x".repeat(513) },
			),
		).rejects.toThrow("between 1 and 512 characters");

		expect(setup.app.mocks.queue.getJobs()).toHaveLength(0);
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
	});

	test("retries an uncertain adapter receipt with the same logical dispatch id", async () => {
		setup.app.mocks.queue.failNextPublishes(1);
		const dispatchId = await withTransaction(setup.app.db, async () =>
			setup.app.queue.notify.publish(
				{ value: "uncertain" },
				{ idempotencyKey: "notify:uncertain" },
			),
		);
		const [pending] = await setup.app.db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));

		await setup.app.mocks.queue.publish(
			pending.jobName,
			pending.payload,
			pending.options ?? undefined,
			pending.dispatchId,
		);
		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		await setup.app.queue.drain();

		const physical = setup.app.mocks.queue.getJobs();
		expect(physical).toHaveLength(2);
		expect(new Set(physical.map((item) => item.dispatchId))).toEqual(
			new Set([dispatchId]),
		);
	});

	test("recovers expired leases after a relay process dies before publish", async () => {
		setup.app.mocks.queue.failNextPublishes(1);
		const dispatchId = await withTransaction(setup.app.db, async () =>
			setup.app.queue.notify.publish(
				{ value: "lease" },
				{ idempotencyKey: "notify:lease" },
			),
		);
		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		const now = new Date("2026-01-01T00:00:00.000Z");

		expect(
			await claimQueueDispatches(setup.app.db, {
				batchSize: 1,
				leaseMs: 1_000,
				now,
			}),
		).toHaveLength(1);
		expect(
			await claimQueueDispatches(setup.app.db, {
				batchSize: 1,
				leaseMs: 1_000,
				now: new Date(now.getTime() + 999),
			}),
		).toHaveLength(0);
		expect(
			await claimQueueDispatches(setup.app.db, {
				batchSize: 1,
				leaseMs: 1_000,
				now: new Date(now.getTime() + 1_001),
			}),
		).toHaveLength(1);
	});

	test("retains an operator-visible terminal relay failure", async () => {
		setup.app.mocks.queue.failNextPublishes(25);
		const dispatchId = await withTransaction(setup.app.db, async () =>
			setup.app.queue.notify.publish(
				{ value: "super-secret-payload" },
				{ idempotencyKey: "notify:terminal" },
			),
		);

		const terminalLogs: Array<{
			message: string;
			metadata?: Record<string, unknown>;
		}> = [];
		let finalResult;
		for (let attempt = 1; attempt < 25; attempt += 1) {
			finalResult = await drainQueueDispatches({
				adapter: setup.app.mocks.queue,
				db: setup.app.db,
				logger: {
					error: (message, metadata) => {
						terminalLogs.push({ message, metadata });
					},
				},
				now: new Date(Date.UTC(2027, 0, attempt + 1)),
			});
		}
		const [terminal] = await setup.app.db
			.select()
			.from(questpieQueueDispatchTable)
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
		expect(terminal).toMatchObject({
			status: "failed",
			attempts: 25,
			lastError: "Adapter publication failed",
		});
		expect(finalResult).toEqual({
			claimed: 1,
			accepted: 0,
			failed: 1,
			terminal: 1,
		});
		expect(terminalLogs).toEqual([
			{
				message: "[QUESTPIE Queue] Dispatch relay reached terminal failure",
				metadata: {
					dispatchId,
					jobName: "notify",
					attempts: 25,
					error: "Adapter publication failed",
				},
			},
		]);
		expect(JSON.stringify(terminalLogs)).not.toContain("super-secret-payload");
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(0);
	});

	test("rejects combining portable idempotency with suppressive singleton policy", async () => {
		await expect(
			setup.app.queue.notify.publish(
				{ value: "ambiguous" },
				{
					idempotencyKey: "notify:ambiguous",
					singletonKey: "tenant-1",
				},
			),
		).rejects.toThrow("cannot be combined");
		await expect(
			setup.app.queue.notify.publish(
				{ value: "empty-singleton" },
				{
					idempotencyKey: "notify:empty-singleton",
					singletonKey: "",
				},
			),
		).rejects.toThrow("cannot be combined");

		expect(setup.app.mocks.queue.getJobs()).toHaveLength(0);
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);
	});

	test("does not report acceptance after another relay takes the lease", async () => {
		setup.app.mocks.queue.failNextPublishes(1);
		const dispatchId = await withTransaction(setup.app.db, async () =>
			setup.app.queue.notify.publish(
				{ value: "lease-takeover" },
				{ idempotencyKey: "notify:lease-takeover" },
			),
		);
		await setup.app.db
			.update(questpieQueueDispatchTable)
			.set({ availableAt: new Date(0) })
			.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));

		const adapter = setup.app.mocks.queue;
		const publish = adapter.publish.bind(adapter);
		adapter.publish = async (...args) => {
			await setup.app.db
				.update(questpieQueueDispatchTable)
				.set({ leaseToken: crypto.randomUUID() })
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			return publish(...args);
		};

		await expect(
			drainQueueDispatches({
				adapter,
				db: setup.app.db,
			}),
		).resolves.toEqual({
			claimed: 1,
			accepted: 0,
			failed: 0,
			terminal: 0,
		});
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);
	});

	for (const [adapterName, makeHarness] of [
		["BullMQ", makeBullMqHarness],
		["Cloudflare Queues", makeCloudflareHarness],
	] as const) {
		describe(`${adapterName} dispatch contract`, () => {
			let harness: ExternalAdapterHarness;
			let queue: ReturnType<
				typeof createQueueClient<{ notify: typeof notifyJob }>
			>;

			beforeEach(() => {
				harness = makeHarness();
				queue = createQueueClient({ notify: notifyJob }, harness.adapter, {
					createContext: async () => ({ db: setup.app.db }),
					getApp: () => setup.app,
					getDatabase: () => setup.app.db,
					logger: {
						info: () => {},
						warn: () => {},
						error: () => {},
					},
				});
			});

			afterEach(async () => {
				await queue.stop();
			});

			test("rolls adapter publication back with the business transaction", async () => {
				await expect(
					withTransaction(setup.app.db, async () => {
						await queue.notify.publish(
							{ value: "rollback" },
							{ idempotencyKey: `${adapterName}:rollback` },
						);
						throw new Error("rollback");
					}),
				).rejects.toThrow("rollback");

				expect(harness.accepted).toHaveLength(0);
				expect(
					await setup.app.db.select().from(questpieQueueDispatchTable),
				).toEqual([]);
			});

			test("recovers a crash before adapter acceptance", async () => {
				harness.failNext();
				const dispatchId = await withTransaction(setup.app.db, async () =>
					queue.notify.publish(
						{ value: "recover" },
						{ idempotencyKey: `${adapterName}:recover` },
					),
				);
				expect(harness.accepted).toHaveLength(0);

				await setup.app.db
					.update(questpieQueueDispatchTable)
					.set({ availableAt: new Date(0) })
					.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
				await queue.drain();

				expect(harness.accepted).toEqual([
					{ dispatchId, payload: { value: "recover" } },
				]);
			});

			test("retries uncertain acceptance with one logical dispatch id", async () => {
				harness.failNext({ afterAcceptance: true });
				const dispatchId = await withTransaction(setup.app.db, async () =>
					queue.notify.publish(
						{ value: "uncertain" },
						{ idempotencyKey: `${adapterName}:uncertain` },
					),
				);

				await setup.app.db
					.update(questpieQueueDispatchTable)
					.set({ availableAt: new Date(0) })
					.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
				await queue.drain();

				expect(harness.accepted.length).toBeGreaterThanOrEqual(1);
				expect(
					new Set(harness.accepted.map((item) => item.dispatchId)),
				).toEqual(new Set([dispatchId]));
			});

			test("deduplicates repeated idempotency keys at the framework boundary", async () => {
				const first = await queue.notify.publish(
					{ value: "first" },
					{ idempotencyKey: `${adapterName}:duplicate` },
				);
				const second = await queue.notify.publish(
					{ value: "second" },
					{ idempotencyKey: `${adapterName}:duplicate` },
				);

				expect(second).toBe(first);
				expect(harness.accepted).toEqual([
					{ dispatchId: first, payload: { value: "first" } },
				]);
			});

			test("retains and reports exhausted adapter-publication retries", async () => {
				harness.failAlways();
				const dispatchId = await withTransaction(setup.app.db, async () =>
					queue.notify.publish(
						{ value: "terminal" },
						{ idempotencyKey: `${adapterName}:terminal` },
					),
				);

				let result;
				for (let attempt = 1; attempt < 25; attempt += 1) {
					result = await drainQueueDispatches({
						adapter: harness.adapter,
						db: setup.app.db,
						now: new Date(Date.UTC(2028, 0, attempt + 1)),
					});
				}

				expect(result).toEqual({
					claimed: 1,
					accepted: 0,
					failed: 1,
					terminal: 1,
				});
				expect(
					await setup.app.db
						.select({
							status: questpieQueueDispatchTable.status,
							attempts: questpieQueueDispatchTable.attempts,
						})
						.from(questpieQueueDispatchTable)
						.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId)),
				).toEqual([{ status: "failed", attempts: 25 }]);
			});
		});
	}

	test("pg-boss shares the Drizzle transaction and keeps a durable idempotency receipt", async () => {
		await setup.app.db.execute(sql`
			CREATE TABLE questpie_test_pg_boss_job (
				id uuid PRIMARY KEY,
				name text NOT NULL,
				data jsonb NOT NULL
			)
		`);
		const adapter = new PgBossAdapter({} as any);
		(adapter as any).boss = {
			start: async () => {},
			stop: async () => {},
			createQueue: async () => {},
			addListener: () => {},
			send: async (
				name: string,
				data: unknown,
				options: {
					id: string;
					db: {
						executeSql: (
							text: string,
							values: unknown[],
						) => Promise<{ rows: Array<{ id: string }> }>;
					};
				},
			) => {
				const result = await options.db.executeSql(
					`INSERT INTO questpie_test_pg_boss_job (id, name, data)
					 VALUES ($1, $2, $3::jsonb)
					 ON CONFLICT (id) DO NOTHING
					 RETURNING id`,
					[options.id, name, JSON.stringify(data)],
				);
				return result.rows[0]?.id ?? null;
			},
		};
		const queue = createQueueClient({ notify: notifyJob }, adapter, {
			createContext: async () => ({ db: setup.app.db }),
			getApp: () => setup.app,
			getDatabase: () => setup.app.db,
			logger: {
				info: () => {},
				warn: () => {},
				error: () => {},
			},
		});

		await expect(
			withTransaction(setup.app.db, async () => {
				await queue.notify.publish(
					{ value: "rollback" },
					{ idempotencyKey: "pg-boss:rollback" },
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(
			await setup.app.db.execute(sql`
				SELECT id FROM questpie_test_pg_boss_job
			`),
		).toMatchObject({ rows: [] });
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);

		const first = await withTransaction(setup.app.db, async () =>
			queue.notify.publish(
				{ value: "first" },
				{ idempotencyKey: "pg-boss:durable" },
			),
		);
		await setup.app.db.execute(sql`
			DELETE FROM questpie_test_pg_boss_job
		`);
		const second = await queue.notify.publish(
			{ value: "second" },
			{ idempotencyKey: "pg-boss:durable" },
		);

		expect(second).toBe(first);
		expect(
			await setup.app.db.execute(sql`
				SELECT id FROM questpie_test_pg_boss_job
			`),
		).toMatchObject({ rows: [] });
		expect(
			await setup.app.db
				.select({
					status: questpieQueueDispatchTable.status,
					payload: questpieQueueDispatchTable.payload,
					options: questpieQueueDispatchTable.options,
				})
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, first)),
		).toEqual([{ status: "accepted", payload: null, options: null }]);

		const bull = makeBullMqHarness();
		const switchedQueue = createQueueClient(
			{ notify: notifyJob },
			bull.adapter,
			{
				createContext: async () => ({ db: setup.app.db }),
				getApp: () => setup.app,
				getDatabase: () => setup.app.db,
				logger: {
					info: () => {},
					warn: () => {},
					error: () => {},
				},
			},
		);
		expect(
			await switchedQueue.notify.publish(
				{ value: "third" },
				{ idempotencyKey: "pg-boss:durable" },
			),
		).toBe(first);
		expect(bull.accepted).toHaveLength(0);

		await switchedQueue.stop();
		await queue.stop();
	});

	test("pg-boss separate-database opt-out uses the transactional dispatch relay", async () => {
		const adapter = new PgBossAdapter({
			useApplicationTransaction: false,
		} as any);
		const accepted: Array<{
			dispatchId: string;
			hasTransactionDb: boolean;
		}> = [];
		(adapter as any).boss = {
			start: async () => {},
			stop: async () => {},
			createQueue: async () => {},
			addListener: () => {},
			send: async (
				_name: string,
				_data: unknown,
				options: { id: string; db?: unknown },
			) => {
				accepted.push({
					dispatchId: options.id,
					hasTransactionDb: options.db !== undefined,
				});
				return options.id;
			},
		};
		const queue = createQueueClient({ notify: notifyJob }, adapter, {
			createContext: async () => ({ db: setup.app.db }),
			getApp: () => setup.app,
			getDatabase: () => setup.app.db,
			logger: {
				info: () => {},
				warn: () => {},
				error: () => {},
			},
		});

		await expect(
			withTransaction(setup.app.db, async () => {
				await queue.notify.publish(
					{ value: "rollback" },
					{ idempotencyKey: "pg-boss-separate:rollback" },
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(accepted).toEqual([]);
		expect(
			await setup.app.db.select().from(questpieQueueDispatchTable),
		).toEqual([]);

		const dispatchId = await withTransaction(setup.app.db, async () =>
			queue.notify.publish(
				{ value: "commit" },
				{ idempotencyKey: "pg-boss-separate:commit" },
			),
		);
		expect(accepted).toEqual([{ dispatchId, hasTransactionDb: false }]);
		expect(
			await setup.app.db
				.select({
					status: questpieQueueDispatchTable.status,
					payload: questpieQueueDispatchTable.payload,
				})
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId)),
		).toEqual([{ status: "accepted", payload: null }]);

		await queue.stop();
	});
});
