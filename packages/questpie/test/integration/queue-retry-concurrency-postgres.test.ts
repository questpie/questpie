import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { PgBossAdapter } from "../../src/server/modules/core/integrated/queue/adapters/pg-boss.js";

const databaseUrl =
	process.env.QUESTPIE_QUEUE_POSTGRES_URL ??
	process.env.QUESTPIE_QUEUE_SECRET_POSTGRES_URL;

describe.skipIf(!databaseUrl)("pg-boss concurrent retry settlement", () => {
	test("an earlier batch cannot complete a retry while its handler is executing", async () => {
		const schema = `queue_retry_${randomUUID().replaceAll("-", "")}`;
		const options = {
			connectionString: databaseUrl!,
			schema,
			useApplicationTransaction: false,
		};
		const originalWorker = new PgBossAdapter(options);
		const retryWorker = new PgBossAdapter(options);
		const pool = new pg.Pool({ connectionString: databaseUrl! });
		let releaseSibling!: () => void;
		const siblingBlocked = new Promise<void>((resolve) => {
			releaseSibling = resolve;
		});
		let releaseRetry!: () => void;
		const retryBlocked = new Promise<void>((resolve) => {
			releaseRetry = resolve;
		});
		let siblingStarted = false;
		let retryStarted = false;
		let attempts = 0;
		const failAttempt = async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("first attempt failed");
			retryStarted = true;
			await retryBlocked;
			throw new Error("retry failed");
		};
		const waitFor = async (predicate: () => boolean | Promise<boolean>) => {
			const deadline = Date.now() + 5_000;
			while (!(await predicate())) {
				if (Date.now() >= deadline)
					throw new Error("Queue condition timed out");
				await Bun.sleep(20);
			}
		};

		try {
			const failedId = await originalWorker.publish(
				"retry-contract",
				{ fail: true },
				{ retryLimit: 1, retryDelay: 0 },
			);
			const siblingId = await originalWorker.publish("retry-contract", {
				fail: false,
			});
			expect(failedId).not.toBeNull();
			expect(siblingId).not.toBeNull();
			await originalWorker.listen(
				{
					"retry-contract": async ({ data }) => {
						if ((data as { fail: boolean }).fail) {
							await failAttempt();
							return;
						}
						siblingStarted = true;
						await siblingBlocked;
					},
				},
				{ batchSize: 2 },
			);
			await waitFor(() => siblingStarted);
			await retryWorker.listen(
				{
					"retry-contract": failAttempt,
				},
				{ batchSize: 1 },
			);
			// Let the other worker claim a prematurely published retry. A safe
			// batch keeps that retry unavailable until the sibling has finished.
			const observationDeadline = Date.now() + 2_500;
			while (Date.now() < observationDeadline) {
				if (retryStarted) break;
				await Bun.sleep(20);
			}
			releaseSibling();
			await waitFor(() => retryStarted);
			await waitFor(
				async () =>
					(await originalWorker.inspectExecutionState(
						"retry-contract",
						siblingId!,
					)) === "completed",
			);
			expect(
				await retryWorker.inspectExecutionState("retry-contract", failedId!),
			).toBe("active");
			releaseRetry();
			await waitFor(
				async () =>
					(await retryWorker.inspectExecutionState(
						"retry-contract",
						failedId!,
					)) === "failed",
			);
			expect(attempts).toBe(2);
		} finally {
			releaseSibling();
			releaseRetry();
			try {
				await Promise.allSettled([originalWorker.stop(), retryWorker.stop()]);
			} finally {
				try {
					await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
				} finally {
					await pool.end();
				}
			}
		}
	}, 30_000);
});
