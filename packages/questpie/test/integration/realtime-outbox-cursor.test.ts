/**
 * The outbox cursor, with the concurrency simulated instead of real.
 *
 * `realtime-drain-cursor-postgres.test.ts` proves the same properties against a
 * real server with overlapping transactions, but that needs a PostgreSQL URL and
 * only runs in the realtime matrix job. These write the `txid` column directly,
 * relative to the current visibility watermark, so the ordering rules are
 * covered on PGlite in the ordinary test run too.
 *
 * A row whose `txid` sits above `pg_snapshot_xmin(pg_current_snapshot())` is
 * exactly what an open transaction's row looks like to a reader: present in the
 * table, not yet drainable. Lowering it afterwards is that transaction ending.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { rowsOf } from "../../src/server/db/driver-result.js";
import type { ChangeBroker } from "../../src/server/modules/core/integrated/realtime/transport.js";
import type { RealtimeChangeEvent } from "../../src/server/modules/core/integrated/realtime/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const silentBroker: ChangeBroker = {
	start: async () => {},
	stop: async () => {},
	publish: async () => {},
};

let teardown: (() => Promise<void>) | undefined;

async function buildApp(): Promise<any> {
	const setup = await buildMockApp(
		{},
		{ realtime: { changeBroker: silentBroker, pollIntervalMs: 0 } },
	);
	await runTestDbMigrations(setup.app);
	teardown = setup.cleanup;
	return setup.app;
}

/** The lowest transaction id still open — everything below it has ended. */
async function watermark(app: any): Promise<bigint> {
	const rows = rowsOf<{ xmin: string }>(
		await app.db.execute(
			sql`select pg_snapshot_xmin(pg_current_snapshot())::text as "xmin"`,
		),
	);
	return BigInt(rows[0]!.xmin);
}

/** Append one outbox row with a chosen transaction id. */
async function appendWithTxid(
	app: any,
	txid: bigint,
	recordId: string,
): Promise<number> {
	const rows = rowsOf<{ seq: string | number }>(
		await app.db.execute(sql`
			insert into questpie_realtime_log
				(txid, resource_type, resource, operation, record_id, payload)
			values (${txid.toString()}::text::xid8, 'collection', 'posts', 'update', ${recordId}, '{}'::jsonb)
			returning seq
		`),
	);
	return Number(rows[0]!.seq);
}

async function collect(app: any): Promise<{
	seen: RealtimeChangeEvent[];
	stop: () => void;
}> {
	const seen: RealtimeChangeEvent[] = [];
	const stop = app.realtime.subscribe((event: RealtimeChangeEvent) => {
		seen.push(event);
	});
	await (app.realtime as any).ensureStarted();
	await (app.realtime as any).drain("poll");
	seen.length = 0;
	return { seen, stop };
}

const drain = (app: any): Promise<void> => (app.realtime as any).drain("poll");

describe("realtime outbox cursor", () => {
	afterEach(async () => {
		await teardown?.();
		teardown = undefined;
	});

	it("delivers a lower sequence that becomes readable after a higher one", async () => {
		const app = await buildApp();
		const { seen, stop } = await collect(app);
		try {
			const open = await watermark(app);
			// Still open: a higher transaction id, appended first, so a LOWER seq.
			const pendingSeq = await appendWithTxid(app, open + 1000n, "still-open");
			// Committed: a lower transaction id, appended second, so a HIGHER seq.
			const settledSeq = await appendWithTxid(
				app,
				open - 1n,
				"already-settled",
			);
			expect(pendingSeq).toBeLessThan(settledSeq);

			await drain(app);
			expect(seen.map((event) => event.recordId)).toEqual(["already-settled"]);

			// The open transaction ends: its row becomes readable, still carrying a
			// transaction id above the one already delivered. A seq-only cursor sits
			// at the higher sequence and never comes back for this row.
			const now = await watermark(app);
			await app.db.execute(sql`
				update questpie_realtime_log
				   set txid = ${(now - 1n).toString()}::text::xid8
				 where seq = ${pendingSeq}
			`);

			await drain(app);
			expect(seen.map((event) => event.recordId)).toEqual([
				"already-settled",
				"still-open",
			]);
		} finally {
			stop();
		}
	});

	it("never re-delivers a change the cursor has passed", async () => {
		const app = await buildApp();
		const { seen, stop } = await collect(app);
		try {
			const open = await watermark(app);
			await appendWithTxid(app, open - 1n, "one");
			await appendWithTxid(app, open - 1n, "two");

			await drain(app);
			await drain(app);
			await drain(app);
			expect(seen.map((event) => event.recordId)).toEqual(["one", "two"]);
		} finally {
			stop();
		}
	});

	it("reports the settled head, not the newest row", async () => {
		const app = await buildApp();
		const open = await watermark(app);
		const settledSeq = await appendWithTxid(app, open - 1n, "settled");
		const pendingSeq = await appendWithTxid(app, open + 1000n, "pending");
		expect(pendingSeq).toBeGreaterThan(settledSeq);

		expect(await app.realtime.getLatestSeq()).toBe(settledSeq);
	});

	it("refuses to resume as current while a newer change is unreadable", async () => {
		const app = await buildApp();
		const open = await watermark(app);
		const settledSeq = await appendWithTxid(app, open - 1n, "settled");

		expect(await app.realtime.getResumeState(settledSeq)).toEqual({
			latestSeq: settledSeq,
			reset: false,
			current: true,
		});

		await appendWithTxid(app, open + 1000n, "pending");
		const blocked = await app.realtime.getResumeState(settledSeq);
		// The settled head has not moved, so a sequence comparison alone would
		// call this client current. It is not: a change it never saw is committed.
		expect(blocked.latestSeq).toBe(settledSeq);
		expect(blocked.current).toBe(false);
		expect(blocked.reset).toBe(false);
	});
});
