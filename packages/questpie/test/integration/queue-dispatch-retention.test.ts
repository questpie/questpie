import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";

import { z } from "zod";

import { job } from "../../src/exports/index.js";
import {
	pruneQueueDispatches,
	QUEUE_DISPATCH_RETENTION_MS,
} from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const notifyJob = job({
	name: "notify",
	schema: z.object({ value: z.string() }),
	handler: async () => {},
});

setDefaultTimeout(30_000);

const DAY_MS = 24 * 60 * 60 * 1_000;

type DispatchSeed = Partial<typeof questpieQueueDispatchTable.$inferInsert> & {
	idempotencyKey: string;
	status: "pending" | "accepted" | "completed" | "failed";
};

describe("queue dispatch retention", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let cleanup: (() => Promise<void>) | undefined;
	const now = new Date();
	const old = new Date(now.getTime() - QUEUE_DISPATCH_RETENTION_MS - DAY_MS);
	const young = new Date(now.getTime() - QUEUE_DISPATCH_RETENTION_MS + DAY_MS);
	const live = new Date(now.getTime() + 60_000);

	const seed = async (rows: DispatchSeed[]) => {
		await setup.app.db.insert(questpieQueueDispatchTable).values(
			rows.map((row) => ({
				dispatchId: crypto.randomUUID(),
				jobName: "notify",
				...row,
			})),
		);
	};

	const remainingKeys = async () =>
		(
			await setup.app.db
				.select({ key: questpieQueueDispatchTable.idempotencyKey })
				.from(questpieQueueDispatchTable)
		)
			.map((row: { key: string | null }) => row.key)
			.sort();

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

	test("deletes exactly the finished rows older than the retention window", async () => {
		const survivors: DispatchSeed[] = [
			{
				idempotencyKey: "keep:pending-old",
				status: "pending",
				availableAt: old,
			},
			{
				idempotencyKey: "keep:pending-leased",
				status: "pending",
				availableAt: old,
				leaseToken: crypto.randomUUID(),
				leasedUntil: live,
			},
			{
				idempotencyKey: "keep:accepted-young",
				status: "accepted",
				acceptedAt: young,
			},
			{
				idempotencyKey: "keep:accepted-secret-old",
				status: "accepted",
				secretPayload: true,
				adapterJobId: "broker-1",
				acceptedAt: old,
			},
			{
				idempotencyKey: "keep:accepted-secret-unpublished-old",
				status: "accepted",
				secretPayload: true,
				acceptedAt: old,
			},
			{
				idempotencyKey: "keep:accepted-old-leased",
				status: "accepted",
				acceptedAt: old,
				leaseToken: crypto.randomUUID(),
				leasedUntil: live,
			},
			{
				idempotencyKey: "keep:completed-young",
				status: "completed",
				secretPayload: true,
				acceptedAt: old,
				completedAt: young,
			},
			{
				idempotencyKey: "keep:completed-old-claimed",
				status: "completed",
				secretPayload: true,
				acceptedAt: old,
				completedAt: old,
				executionClaimToken: crypto.randomUUID(),
				executionClaimedUntil: live,
			},
			{
				idempotencyKey: "keep:failed-young",
				status: "failed",
				secretPayload: true,
				acceptedAt: old,
				failedAt: young,
			},
		];
		const expired: DispatchSeed[] = [
			{
				idempotencyKey: "drop:accepted-old",
				status: "accepted",
				adapterJobId: "broker-2",
				acceptedAt: old,
			},
			{
				idempotencyKey: "drop:completed-old",
				status: "completed",
				secretPayload: true,
				acceptedAt: old,
				completedAt: old,
			},
			{
				idempotencyKey: "drop:failed-old",
				status: "failed",
				secretPayload: true,
				acceptedAt: old,
				failedAt: old,
			},
			{
				idempotencyKey: "drop:failed-relay-old",
				status: "failed",
				failedAt: old,
			},
			{
				idempotencyKey: "drop:completed-old-expired-claim",
				status: "completed",
				secretPayload: true,
				completedAt: old,
				executionClaimToken: crypto.randomUUID(),
				executionClaimedUntil: old,
			},
		];
		await seed([...survivors, ...expired]);

		await expect(pruneQueueDispatches(setup.app.db, { now })).resolves.toEqual({
			deleted: expired.length,
			batches: 1,
		});
		expect(await remainingKeys()).toEqual(
			survivors.map((row) => row.idempotencyKey).sort(),
		);

		await expect(pruneQueueDispatches(setup.app.db, { now })).resolves.toEqual({
			deleted: 0,
			batches: 1,
		});
		expect(await remainingKeys()).toHaveLength(survivors.length);
	});

	test("deletes at most one batch per statement and stops at the batch cap", async () => {
		await seed(
			Array.from({ length: 5 }, (_, index) => ({
				idempotencyKey: `receipt:${index}`,
				status: "accepted" as const,
				// receipt:0 is the oldest, so the oldest-first order is observable.
				acceptedAt: new Date(old.getTime() - (5 - index) * 60_000),
			})),
		);

		await expect(
			pruneQueueDispatches(setup.app.db, {
				now,
				batchSize: 2,
				maxBatches: 1,
			}),
		).resolves.toEqual({ deleted: 2, batches: 1 });
		expect(await remainingKeys()).toEqual([
			"receipt:2",
			"receipt:3",
			"receipt:4",
		]);

		await expect(
			pruneQueueDispatches(setup.app.db, { now, batchSize: 2 }),
		).resolves.toEqual({ deleted: 3, batches: 2 });
		expect(await remainingKeys()).toEqual([]);
	});

	test("an idempotency key dedupes inside the window and enqueues again after it", async () => {
		const publish = () =>
			setup.app.queue.notify.publish(
				{ value: "receipt" },
				{ idempotencyKey: "notify:receipt" },
			);
		const first = await publish();
		expect(await publish()).toBe(first);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);

		await expect(
			pruneQueueDispatches(setup.app.db, {
				now: new Date(Date.now() + QUEUE_DISPATCH_RETENTION_MS - DAY_MS),
			}),
		).resolves.toEqual({ deleted: 0, batches: 1 });
		expect(await publish()).toBe(first);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(1);

		await expect(
			pruneQueueDispatches(setup.app.db, {
				now: new Date(Date.now() + QUEUE_DISPATCH_RETENTION_MS + DAY_MS),
			}),
		).resolves.toEqual({ deleted: 1, batches: 1 });
		expect(await publish()).toBe(first);
		expect(setup.app.mocks.queue.getJobs()).toHaveLength(2);
		expect(await remainingKeys()).toEqual(["notify:receipt"]);
	});
});
