import { beforeAll, describe, expect, it } from "bun:test";

import pg from "pg";

import { RealtimeTxidTracker } from "../../src/client/realtime/txid.js";
import { withTransaction } from "../../src/exports/index.js";
import type { ChangeBroker } from "../../src/server/modules/core/integrated/realtime/transport.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const databaseUrl =
	process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe.skipIf(!databaseUrl)("realtime txid PostgreSQL ordering", () => {
	beforeAll(async () => {
		const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
		try {
			// QUESTPIE's trigram indexes require pg_trgm to be provisioned
			// out-of-band before schema migrations run.
			await pool.query("create extension if not exists pg_trgm");
		} finally {
			await pool.end();
		}
	});

	it("serializes outbox sequence allocation across real connections", async () => {
		const broker: ChangeBroker = {
			start: async () => {},
			stop: async () => {},
			publish: async () => {},
		};
		const setup = await buildMockApp(
			{},
			{
				db: { url: databaseUrl!, pool: { max: 4 } },
				realtime: { changeBroker: broker },
			},
		);
		await runTestDbMigrations(setup.app);
		const baseSeq = await setup.app.realtime.getLatestSeq();
		let markFirstAppended = () => {};
		const firstAppended = new Promise<void>((resolve) => {
			markFirstAppended = resolve;
		});
		let releaseFirst = () => {};
		const holdFirst = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		try {
			const first = withTransaction(setup.app.db, async () => {
				const event = await setup.app.realtime.appendChange({
					resourceType: "collection",
					resource: "posts",
					operation: "update",
					recordId: "first",
				});
				markFirstAppended();
				await holdFirst;
				return event;
			});
			await firstAppended;

			let secondSettled = false;
			const second = withTransaction(setup.app.db, () =>
				setup.app.realtime.appendChange({
					resourceType: "collection",
					resource: "posts",
					operation: "update",
					recordId: "second",
				}),
			).then((event) => {
				secondSettled = true;
				return event;
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(secondSettled).toBe(false);

			releaseFirst();
			const [firstEvent, secondEvent] = await Promise.all([first, second]);
			expect([firstEvent.seq, secondEvent.seq]).toEqual([
				baseSeq + 1,
				baseSeq + 2,
			]);
			const delivered = await setup.app.realtime.readSince(baseSeq);
			expect(
				delivered.map((event) => ({
					seq: event.seq,
					recordId: event.recordId,
				})),
			).toEqual([
				{ seq: baseSeq + 1, recordId: "first" },
				{ seq: baseSeq + 2, recordId: "second" },
			]);
		} finally {
			releaseFirst();
			await setup.app.migrations.down();
			await setup.cleanup();
		}
	}, 30_000);

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
