/**
 * The outbox drain against a real PostgreSQL server, with real concurrency.
 *
 * These cover the properties that used to be bought with a fleet-wide lock on
 * `questpie_realtime_head` and are now bought with the `(txid, seq)` cursor:
 * nothing is skipped when transaction ids and sequences invert, one
 * transaction's appends stay together and in order, aborted work never
 * surfaces, a resuming client is only told "current" when that is provable, a
 * booting node does not replay the retained log, and retention pruning does not
 * drag the cursor backwards.
 *
 * PGlite cannot host them: every one needs two connections whose transactions
 * overlap. Point the suite at a throwaway server:
 *
 *   QUESTPIE_REALTIME_TXID_DATABASE_URL=postgresql://probe:probe@127.0.0.1:55450/qp_rt_test \
 *     bun test packages/questpie/test/integration/realtime-drain-cursor-postgres.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { eq, sql } from "drizzle-orm";
import pg from "pg";

import { withTransaction } from "../../src/exports/index.js";
import { questpieRealtimeLogTable } from "../../src/server/modules/core/integrated/realtime/collection.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import type { ChangeBroker } from "../../src/server/modules/core/integrated/realtime/transport.js";
import type { RealtimeChangeEvent } from "../../src/server/modules/core/integrated/realtime/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const databaseUrl =
	process.env.QUESTPIE_REALTIME_TXID_DATABASE_URL ??
	process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

/** A broker that accepts and drops every notice, so drains are driven here. */
const silentBroker: ChangeBroker = {
	start: async () => {},
	stop: async () => {},
	publish: async () => {},
};

let app: any;
let cleanup: (() => Promise<void>) | undefined;

/**
 * Run drains until the service is quiet.
 *
 * `drain()` collapses concurrent calls, so a single call can return without
 * having read anything when the startup drain is still in flight.
 */
async function drainFully(): Promise<void> {
	const realtime = app.realtime as any;
	for (let attempt = 0; attempt < 200; attempt++) {
		await realtime.drain("poll");
		if (!realtime.draining && !realtime.drainPending) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("realtime drain never settled");
}

const append = (
	recordId: string,
	operation = "update",
): Promise<RealtimeChangeEvent> =>
	app.realtime.appendChange({
		resourceType: "collection",
		resource: "posts",
		operation,
		recordId,
	});

/** Assign a transaction id without appending — what an ordinary write does. */
const takeXid = (tx: any): Promise<unknown> =>
	tx.execute(sql`select pg_current_xact_id()`);

async function collect(): Promise<{
	seen: RealtimeChangeEvent[];
	stop: () => void;
}> {
	const seen: RealtimeChangeEvent[] = [];
	const stop = app.realtime.subscribe((event: RealtimeChangeEvent) => {
		seen.push(event);
	});
	// subscribe() starts the service in the background; the cursor is only
	// seeded once that resolves.
	await (app.realtime as any).ensureStarted();
	await drainFully();
	seen.length = 0;
	return { seen, stop };
}

const recordIds = (events: RealtimeChangeEvent[]): (string | null)[] =>
	events.map((event) => event.recordId);

describe.skipIf(!databaseUrl)("realtime drain cursor on PostgreSQL", () => {
	beforeAll(async () => {
		const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
		try {
			await pool.query("create extension if not exists pg_trgm");
		} finally {
			await pool.end();
		}
		const setup = await buildMockApp(
			{},
			{
				db: { url: databaseUrl!, pool: { max: 16 } },
				realtime: { changeBroker: silentBroker, pollIntervalMs: 0 },
			},
		);
		await runTestDbMigrations(setup.app);
		app = setup.app;
		cleanup = async () => {
			await setup.app.migrations.down();
			await setup.cleanup();
		};
	}, 120_000);

	afterAll(async () => {
		await cleanup?.();
	}, 120_000);

	it("delivers a change whose transaction id inverts against its sequence", async () => {
		const { seen, stop } = await collect();

		let firstHasXid = () => {};
		const firstXid = new Promise<void>((resolve) => {
			firstHasXid = resolve;
		});
		let releaseFirst = () => {};
		const holdFirst = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let secondAppended = () => {};
		const appended = new Promise<void>((resolve) => {
			secondAppended = resolve;
		});
		let releaseSecond = () => {};
		const holdSecond = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});

		try {
			// T1 takes the LOWER transaction id first and appends nothing yet.
			const first = withTransaction(app.db, async (tx: any) => {
				await takeXid(tx);
				firstHasXid();
				await holdFirst;
				return append("low-txid-high-seq");
			});
			await firstXid;

			// T2 takes a HIGHER transaction id and appends the LOWER sequence.
			const second = withTransaction(app.db, async (tx: any) => {
				await takeXid(tx);
				const event = await append("high-txid-low-seq");
				secondAppended();
				await holdSecond;
				return event;
			});
			await appended;

			releaseFirst();
			const firstEvent = await first;

			// While T2 is open only T1's row is settled — and its sequence is the
			// HIGHER one. A seq-only cursor advances past T2's row here and never
			// comes back for it.
			await drainFully();
			expect(recordIds(seen)).toEqual(["low-txid-high-seq"]);

			releaseSecond();
			const secondEvent = await second;
			expect(secondEvent.seq).toBeLessThan(firstEvent.seq);
			expect(BigInt(secondEvent.txid!)).toBeGreaterThan(
				BigInt(firstEvent.txid!),
			);

			await drainFully();
			expect(recordIds(seen)).toEqual([
				"low-txid-high-seq",
				"high-txid-low-seq",
			]);
		} finally {
			releaseFirst();
			releaseSecond();
			stop();
		}
	}, 60_000);

	it("delivers every append of one transaction, in insertion order", async () => {
		const { seen, stop } = await collect();
		try {
			const events = await withTransaction(app.db, async () => [
				await append("one"),
				await append("two"),
				await append("three"),
			]);
			expect(new Set(events.map((event) => event.txid)).size).toBe(1);

			await drainFully();
			expect(recordIds(seen)).toEqual(["one", "two", "three"]);
		} finally {
			stop();
		}
	}, 60_000);

	it("never delivers an aborted transaction's appends", async () => {
		const { seen, stop } = await collect();
		try {
			await expect(
				withTransaction(app.db, async () => {
					await append("rolled-back");
					throw new Error("business failure");
				}),
			).rejects.toThrow("business failure");

			await append("committed");
			await drainFully();
			expect(recordIds(seen)).toEqual(["committed"]);

			// The aborted row consumed a sequence number; the cursor must not stall
			// on the hole it left behind.
			await append("after-the-hole");
			await drainFully();
			expect(recordIds(seen)).toEqual(["committed", "after-the-hole"]);
		} finally {
			stop();
		}
	}, 60_000);

	it("resumes from a stored cursor without replaying or skipping", async () => {
		const { seen, stop } = await collect();
		try {
			await append("before-disconnect");
			await drainFully();
			expect(recordIds(seen)).toEqual(["before-disconnect"]);
			const storedCursor = await app.realtime.getLatestSeq();
			stop();

			// Nothing happened while the client was away.
			expect(await app.realtime.getResumeState(storedCursor)).toEqual({
				latestSeq: storedCursor,
				reset: false,
				current: true,
			});

			// Something did.
			await append("while-away");
			const afterWrite = await app.realtime.getResumeState(storedCursor);
			expect(afterWrite.current).toBe(false);
			expect(afterWrite.reset).toBe(false);
			expect(afterWrite.latestSeq).toBeGreaterThan(storedCursor);
		} finally {
			stop();
		}
	}, 60_000);

	it("refuses to call a resuming client current while an unsettled change is already committed", async () => {
		const { stop } = await collect();
		let hasXid = () => {};
		const blocker = new Promise<void>((resolve) => {
			hasXid = resolve;
		});
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});

		try {
			await append("stored");
			await drainFully();
			const storedCursor = await app.realtime.getLatestSeq();
			expect((await app.realtime.getResumeState(storedCursor)).current).toBe(
				true,
			);

			// An unrelated transaction holds a LOW id open...
			const blocking = withTransaction(app.db, async (tx: any) => {
				await takeXid(tx);
				hasXid();
				await hold;
			});
			await blocker;

			// ...so this append commits, is visible, and is still not settled. The
			// settled head therefore still equals the client's stored cursor, and a
			// sequence comparison alone would wrongly report "current".
			await append("committed-but-unsettled");
			const whileBlocked = await app.realtime.getResumeState(storedCursor);
			expect(whileBlocked.latestSeq).toBe(storedCursor);
			expect(whileBlocked.current).toBe(false);

			release();
			await blocking;
			const afterRelease = await app.realtime.getResumeState(storedCursor);
			expect(afterRelease.current).toBe(false);
			expect(afterRelease.latestSeq).toBeGreaterThan(storedCursor);
		} finally {
			release();
			stop();
		}
	}, 60_000);

	it("does not replay the retained log when a node boots with no subscribers", async () => {
		for (const id of ["old-1", "old-2", "old-3"]) await append(id);

		// A second node, booting after those writes with an empty listener set.
		// It must adopt the settled head, so its first subscriber sees what
		// happens next rather than the whole retained log — three days of it by
		// default, on every deploy.
		const booting = new RealtimeService(app.db, {
			changeBroker: silentBroker,
			pollIntervalMs: 0,
		});
		const seen: RealtimeChangeEvent[] = [];
		const stop = booting.subscribe((event: RealtimeChangeEvent) => {
			seen.push(event);
		});
		const drainBooting = async () => {
			for (let attempt = 0; attempt < 200; attempt++) {
				await (booting as any).drain("poll");
				if (!(booting as any).draining && !(booting as any).drainPending)
					return;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			throw new Error("booting node drain never settled");
		};

		try {
			await (booting as any).ensureStarted();
			await drainBooting();
			expect(seen).toEqual([]);

			await append("after-boot");
			await drainBooting();
			expect(recordIds(seen)).toEqual(["after-boot"]);
		} finally {
			stop();
			await booting.destroy();
		}
	}, 60_000);

	it("keeps the cursor and the resume horizon consistent after retention pruning", async () => {
		const { seen, stop } = await collect();
		try {
			await append("kept-1");
			await drainFully();
			const cursorAfterFirst = await app.realtime.getLatestSeq();

			await append("kept-2");
			await drainFully();
			expect(recordIds(seen)).toEqual(["kept-1", "kept-2"]);

			// Age every row past the retention window and prune, exactly as
			// scheduleRetentionCleanup does.
			await app.db.execute(
				sql`update questpie_realtime_log set created_at = now() - interval '30 days', settled_at = now() - interval '30 days'`,
			);
			await app.realtime.cleanupOutbox(true);

			// A drained node keeps its position: pruning resurrects nothing.
			await drainFully();
			expect(seen).toHaveLength(2);

			// A client resuming from a pruned position is told to reset.
			const pruned = await app.realtime.getResumeState(cursorAfterFirst);
			expect(pruned.reset).toBe(true);
			expect(pruned.current).toBe(false);

			// New changes still flow through the same cursor.
			await append("after-prune");
			await drainFully();
			expect(recordIds(seen)).toEqual(["kept-1", "kept-2", "after-prune"]);
		} finally {
			stop();
		}
	}, 60_000);

	it("never prunes a committed row before the settlement frontier lets a node drain it", async () => {
		const { seen, stop } = await collect();
		await append("stored-before-blocker");
		await drainFully();
		const storedCursor = await app.realtime.getLatestSeq();
		seen.length = 0;
		let hasXid = () => {};
		const blocker = new Promise<void>((resolve) => {
			hasXid = resolve;
		});
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});

		try {
			const blocking = withTransaction(app.db, async (tx: any) => {
				await takeXid(tx);
				hasXid();
				await hold;
			});
			await blocker;

			const event = await append("old-but-unsettled");
			await app.db.execute(
				sql`update questpie_realtime_log set created_at = now() - interval '30 days' where seq = ${event.seq}`,
			);
			await app.realtime.cleanupOutbox(true);

			const whileBlocked = await app.db
				.select({ settledAt: questpieRealtimeLogTable.settledAt })
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.seq, event.seq));
			expect(whileBlocked).toEqual([{ settledAt: null }]);
			expect((await app.realtime.getResumeState(storedCursor)).current).toBe(
				false,
			);
			await drainFully();
			expect(seen).toEqual([]);

			release();
			await blocking;
			await app.realtime.cleanupOutbox(true);

			const afterSettlement = await app.db
				.select({ settledAt: questpieRealtimeLogTable.settledAt })
				.from(questpieRealtimeLogTable)
				.where(eq(questpieRealtimeLogTable.seq, event.seq));
			expect(afterSettlement).toHaveLength(1);
			expect(afterSettlement[0]?.settledAt).not.toBeNull();
			expect((await app.realtime.getResumeState(storedCursor)).current).toBe(
				false,
			);

			await drainFully();
			expect(recordIds(seen)).toEqual(["old-but-unsettled"]);
		} finally {
			release();
			stop();
		}
	}, 60_000);

	it("delivers a change held back by an older transaction without waiting for a poll", async () => {
		// pollIntervalMs is 0 here, so nothing but the settlement retry can
		// deliver this: the publisher's wake-up fires at commit, when the change
		// is still unreadable.
		const { seen, stop } = await collect();
		let hasXid = () => {};
		const blocker = new Promise<void>((resolve) => {
			hasXid = resolve;
		});
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});

		try {
			const blocking = withTransaction(app.db, async (tx: any) => {
				await takeXid(tx);
				hasXid();
				await hold;
			});
			await blocker;

			await append("behind-a-blocker");
			await drainFully();
			expect(seen).toEqual([]);

			release();
			await blocking;

			for (let attempt = 0; attempt < 100; attempt++) {
				if (seen.length > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(recordIds(seen)).toEqual(["behind-a-blocker"]);
		} finally {
			release();
			stop();
		}
	}, 60_000);

	it("captures concurrently instead of serializing on a global row", async () => {
		const { seen, stop } = await collect();
		let holderAppended = () => {};
		const captured = new Promise<void>((resolve) => {
			holderAppended = resolve;
		});
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});

		try {
			// One transaction captures and then keeps working, the way a bulk import
			// inside a single withTransaction does. Under the head-row lock this
			// blocked every other capture in the fleet until it committed.
			const holder = withTransaction(app.db, async () => {
				await append("long-transaction");
				holderAppended();
				await hold;
			});
			await captured;

			const others = await Promise.all(
				Array.from({ length: 6 }, (_, index) => append(`concurrent-${index}`)),
			);
			expect(others).toHaveLength(6);

			release();
			await holder;
			await drainFully();
			expect(seen).toHaveLength(7);
		} finally {
			release();
			stop();
		}
	}, 60_000);
});
