import { describe, expect, it } from "bun:test";

import pg from "pg";

import { RealtimeTxidTracker } from "../../src/client/realtime/txid.js";

const databaseUrl =
	process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe.skipIf(!databaseUrl)("realtime txid PostgreSQL ordering", () => {
	it("keeps a lower active xid pending until xmin moves strictly past it", async () => {
		const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
		const mutation = await pool.connect();
		const observer = await pool.connect();

		try {
			await mutation.query("begin");
			const mutationResult = await mutation.query<{ txid: string }>(
				"select pg_current_xact_id()::text as txid",
			);
			const txid = mutationResult.rows[0]!.txid;
			const activeSnapshot = await observer.query<{ xmin: string }>(
				"select pg_snapshot_xmin(pg_current_snapshot())::text as xmin",
			);
			expect(BigInt(activeSnapshot.rows[0]!.xmin)).toBeLessThanOrEqual(
				BigInt(txid),
			);

			const tracker = new RealtimeTxidTracker();
			let settled = false;
			const pending = tracker.awaitTxId(txid).then(() => {
				settled = true;
			});
			tracker.observe({
				type: "up-to-date",
				topicId: "posts",
				seq: 1,
				upToDate: activeSnapshot.rows[0]!.xmin,
			});
			await tick();
			expect(settled).toBe(false);

			await mutation.query("commit");
			const committedSnapshot = await observer.query<{ xmin: string }>(
				"select pg_snapshot_xmin(pg_current_snapshot())::text as xmin",
			);
			expect(BigInt(committedSnapshot.rows[0]!.xmin)).toBeGreaterThan(
				BigInt(txid),
			);
			tracker.observe({
				type: "up-to-date",
				topicId: "posts",
				seq: 2,
				upToDate: committedSnapshot.rows[0]!.xmin,
			});
			await pending;
			expect(settled).toBe(true);
		} finally {
			await mutation.query("rollback").catch(() => {});
			mutation.release();
			observer.release();
			await pool.end();
		}
	});
});
