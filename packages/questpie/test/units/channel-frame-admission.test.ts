import { expect, test } from "bun:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { ChannelAuthorityFenceStore } from "../../src/server/modules/core/integrated/realtime/channel-authority-fence.js";
import { ChannelEventLedger } from "../../src/server/modules/core/integrated/realtime/channel-event-ledger.js";
import type { ClientSink } from "../../src/server/modules/core/integrated/realtime/transport.js";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fenceDatabase(
	generations: Record<string, number>,
	options: {
		holdCommit?: boolean;
		beforeCoordinator?: () => void;
		commitError?: Error;
		afterCommit?: () => void;
	} = {},
) {
	const beforeCommit = deferred();
	const commit = deferred();
	const locks: string[] = [];
	const dialect = new PgDialect();
	const stats = { transactions: 0, active: 0, maximumActive: 0 };
	const queries: Array<{
		channel: unknown;
		subjects: unknown[];
		order: string;
	}> = [];
	const select = () => {
		let params: unknown[] = [];
		let order = "";
		const read = () => {
			const coordinator = params[1] === "channel-authority-coordinator";
			if (coordinator) options.beforeCoordinator?.();
			queries.push({ channel: params[0], subjects: params.slice(1), order });
			return coordinator
				? [{ subject: "channel-authority-coordinator", generation: 10 }]
				: Object.entries(generations)
						.filter(([subject]) => params.slice(1).includes(subject))
						.map(([subject, generation]) => ({ subject, generation }));
		};
		const builder = {
			from: () => builder,
			where(condition: SQL) {
				params = dialect.sqlToQuery(condition).params;
				return builder;
			},
			limit: () => builder,
			orderBy(condition: SQL) {
				order = dialect.sqlToQuery(condition).sql;
				return builder;
			},
			for(mode: string) {
				locks.push(
					`${params[1] === "channel-authority-coordinator" ? "coordinator" : "subjects"}:${mode}`,
				);
				return Promise.resolve(read());
			},
			// oxlint-disable-next-line unicorn/no-thenable -- models Drizzle's awaitable SELECT builder
			then(resolve: (rows: ReturnType<typeof read>) => unknown) {
				return Promise.resolve(read()).then(resolve);
			},
		};
		return builder;
	};
	const db = {
		select,
		async transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
			stats.transactions++;
			stats.active++;
			stats.maximumActive = Math.max(stats.maximumActive, stats.active);
			try {
				const result = await operation({ select });
				beforeCommit.resolve();
				if (options.holdCommit) await commit.promise;
				if (options.commitError) throw options.commitError;
				options.afterCommit?.();
				return result;
			} finally {
				stats.active--;
			}
		},
	};
	const store = new ChannelAuthorityFenceStore(
		db as unknown as ConstructorParameters<
			typeof ChannelAuthorityFenceStore
		>[0],
	);
	return { store, db, beforeCommit, commit, locks, queries, stats };
}

test("frame batch compares each expected generation, isolates errors and settles after commit", async () => {
	const db = fenceDatabase({ alice: 2, bob: 0 }, { holdCommit: true });
	const published: string[] = [];
	const failure = new Error("one publication failed");
	let settled = false;
	const result = db.store
		.admitExpectedBatch("room", [
			{
				subject: "alice",
				expectedGeneration: 1,
				publish: () => {
					published.push("stale");
					return undefined;
				},
			},
			{
				subject: "alice",
				expectedGeneration: 2,
				publish: () => {
					throw failure;
				},
			},
			{
				subject: "bob",
				expectedGeneration: 0,
				publish: () => {
					published.push("bob");
					return undefined;
				},
			},
			{ subject: "missing", expectedGeneration: 0, publish: () => undefined },
		])
		.then((value) => {
			settled = true;
			return value;
		});
	await db.beforeCommit.promise;
	expect(db.locks).toEqual(["coordinator:share", "subjects:share"]);
	expect(published).toEqual(["bob"]);
	expect(settled).toBe(false);
	db.commit.resolve();
	const outcomes = await result;
	expect(outcomes[0]).toEqual({
		status: "fulfilled",
		value: { admitted: false },
	});
	expect(outcomes[1]).toEqual({ status: "rejected", reason: failure });
	expect(outcomes[2]).toEqual({
		status: "fulfilled",
		value: { admitted: true, value: undefined },
	});
	expect(outcomes[3]).toMatchObject({ status: "rejected" });
	expect(db.queries[1].subjects).toEqual(["alice", "bob", "missing"]);
	expect(db.queries[1].order).toBe(
		'"questpie_channel_authority_fence"."subject" asc',
	);
});

function binding(subject: string, sink: ClientSink, seqs = [1]) {
	const pending = seqs.map((seq) => ({ seq, frame: new Uint8Array([seq]) }));
	return {
		id: subject,
		channel: "room",
		channelHash: "room",
		subject,
		authorityGeneration: 0,
		reauthorize: async () => true,
		sink,
		closed: false,
		active: true,
		cursor: 0,
		readSeq: 0,
		pending,
		pendingBytes: pending.length,
		retryTimer: null as ReturnType<typeof setTimeout> | null,
	};
}

function localLedger(db: ReturnType<typeof fenceDatabase>["db"]) {
	const ledger = new ChannelEventLedger(
		db as unknown as ConstructorParameters<typeof ChannelEventLedger>[0],
		undefined,
		undefined,
		{ busyRetryMs: 60_000 },
	);
	// Exercise the existing FIFO flush with a deterministic database boundary,
	// without booting an app or pretending an embedded database proves row locks.
	const delivery = ledger as unknown as {
		flushLocalPending(
			subscription: ReturnType<typeof binding>,
		): Promise<boolean>;
		removeLocalSubscription(subscription: ReturnType<typeof binding>): void;
		subscribeLocal(input: {
			subscriptionId: string;
			channel: string;
			sink: ClientSink;
			lastEventId: string;
		}): Promise<() => Promise<void>>;
		admitContiguous(
			subscription: ReturnType<typeof binding>,
			row: { seq: number },
		): Promise<boolean>;
	};
	return delivery;
}

test("65 concurrent oldest frames use two admission transactions and retain every delivery", async () => {
	const subjects = Array.from({ length: 65 }, (_, index) => `viewer-${index}`);
	const db = fenceDatabase(
		Object.fromEntries(subjects.map((subject) => [subject, 0])),
	);
	const events = localLedger(db.db);
	const writes: string[] = [];
	const deliveries = subjects.map((subject) => {
		const sink: ClientSink = {
			sessionId: subject,
			async write() {
				writes.push(subject);
				return { status: "accepted", bufferedBytes: 0 };
			},
			async close() {},
		};
		return events.flushLocalPending(binding(subject, sink));
	});
	expect(await Promise.all(deliveries)).toEqual(subjects.map(() => true));
	expect(writes).toEqual(subjects);
	expect(db.stats.transactions).toBe(2);
	expect(db.stats.maximumActive).toBe(1);
});

test("frame batching occupies at most two transactions across channels", async () => {
	const db = fenceDatabase({ viewer: 0 }, { holdCommit: true });
	const events = localLedger(db.db);
	const writes: string[] = [];
	const deliveries = Array.from({ length: 5 }, (_, index) => {
		const channel = `room-${index}`;
		const subscription = binding("viewer", {
			sessionId: channel,
			async write() {
				writes.push(channel);
				return { status: "accepted", bufferedBytes: 0 };
			},
			async close() {},
		});
		subscription.channelHash = channel;
		return events.flushLocalPending(subscription);
	});
	await db.beforeCommit.promise;
	expect(db.stats.active).toBe(2);
	expect(db.stats.transactions).toBe(2);
	expect(writes).toEqual([]);
	db.commit.resolve();
	await Promise.all(deliveries);
	expect(db.stats.transactions).toBe(5);
	expect(db.stats.maximumActive).toBe(2);
	expect(writes).toHaveLength(5);
});

test("an arrival after the batch is sealed needs its own fresh transaction", async () => {
	const generations = { viewer: 0 };
	const db = fenceDatabase(generations, { holdCommit: true });
	const events = localLedger(db.db);
	const writes: string[] = [];
	const sink = (sessionId: string): ClientSink => ({
		sessionId,
		async write() {
			writes.push(sessionId);
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	const first = events.flushLocalPending(binding("viewer", sink("first")));
	await db.beforeCommit.promise;
	const laterBinding = binding("viewer", sink("later"));
	laterBinding.reauthorize = async () => false;
	const later = events.flushLocalPending(laterBinding);
	// Model the cut visible to the next transaction. The first logical
	// admission has already happened; real lock/cut interleaving needs PG.
	generations.viewer = 1;
	db.commit.resolve();
	expect(await first).toBe(true);
	expect(await later).toBe(false);
	expect(writes).toEqual(["first"]);
	expect(db.stats.transactions).toBe(2);
});

test("busy oldest frame is retried before any newer frame is admitted", async () => {
	const db = fenceDatabase({ viewer: 0 });
	const events = localLedger(db.db);
	let busy = true;
	const started = deferred();
	const release = deferred();
	const attempts: number[] = [];
	const accepted: number[] = [];
	const subscription = binding(
		"viewer",
		{
			sessionId: "fifo",
			async write(frame) {
				attempts.push(frame[0]);
				if (busy) return { status: "busy", bufferedBytes: 0 };
				if (frame[0] === 1) {
					started.resolve();
					await release.promise;
				}
				accepted.push(frame[0]);
				return { status: "accepted", bufferedBytes: 0 };
			},
			async close() {},
		},
		[1, 2, 3],
	);
	try {
		expect(await events.flushLocalPending(subscription)).toBe(false);
		expect(subscription.cursor).toBe(0);
		expect(subscription.pending.map(({ seq }) => seq)).toEqual([1, 2, 3]);
		busy = false;
		const retry = events.flushLocalPending(subscription);
		await started.promise;
		expect(db.stats.transactions).toBe(2);
		expect(db.stats.active).toBe(0);
		expect(attempts).toEqual([1, 1]);
		release.resolve();
		expect(await retry).toBe(true);
		expect(accepted).toEqual([1, 2, 3]);
		expect(db.stats.transactions).toBe(4);
		expect(subscription.cursor).toBe(3);
		expect(subscription.pending).toEqual([]);
	} finally {
		release.resolve();
		if (subscription.retryTimer) clearTimeout(subscription.retryTimer);
	}
});

test("a cut between busy attempts discards the oldest frame and its backlog", async () => {
	const generations = { viewer: 0 };
	const db = fenceDatabase(generations);
	const events = localLedger(db.db);
	const attempts: number[] = [];
	const closes: string[] = [];
	const subscription = binding(
		"viewer",
		{
			sessionId: "cut-on-retry",
			async write(frame) {
				attempts.push(frame[0]);
				return { status: "busy", bufferedBytes: 0 };
			},
			async close(reason) {
				closes.push(reason);
			},
		},
		[1, 2],
	);
	try {
		expect(await events.flushLocalPending(subscription)).toBe(false);
		generations.viewer = 1;
		subscription.reauthorize = async () => false;
		expect(await events.flushLocalPending(subscription)).toBe(false);
		expect(attempts).toEqual([1]);
		expect(closes).toEqual(["access_revoked"]);
		expect(subscription.pending).toEqual([]);
		expect(subscription.cursor).toBe(0);
		expect(db.stats.transactions).toBe(2);
	} finally {
		if (subscription.retryTimer) clearTimeout(subscription.retryTimer);
	}
});

test("a cut before coordinator acquisition denies only the stale exact subject", async () => {
	const generations = { alice: 0, bob: 0 };
	const db = fenceDatabase(generations, {
		beforeCoordinator: () => {
			generations.alice = 1;
		},
	});
	const events = localLedger(db.db);
	const writes: string[] = [];
	const closes: string[] = [];
	const subscriptions = ["alice", "bob"].map((subject) => {
		const subscription = binding(subject, {
			sessionId: subject,
			async write() {
				writes.push(subject);
				return { status: "accepted", bufferedBytes: 0 };
			},
			async close(reason) {
				closes.push(`${subject}:${reason}`);
			},
		});
		subscription.reauthorize = async () => false;
		return subscription;
	});
	expect(
		await Promise.all(
			subscriptions.map((value) => events.flushLocalPending(value)),
		),
	).toEqual([false, true]);
	expect(writes).toEqual(["bob"]);
	expect(closes).toEqual(["alice:access_revoked"]);
	expect(db.stats.transactions).toBe(1);
});

test("a failed batch commit sends nothing and releases the channel for another attempt", async () => {
	const failure = new Error("commit failed");
	const options: { commitError?: Error } = { commitError: failure };
	const db = fenceDatabase({ viewer: 0 }, options);
	const events = localLedger(db.db);
	const writes: number[] = [];
	const subscription = binding("viewer", {
		sessionId: "commit-retry",
		async write(frame) {
			writes.push(frame[0]);
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	const failed = await Promise.allSettled([
		events.flushLocalPending(subscription),
		events.flushLocalPending(binding("viewer", subscription.sink)),
	]);
	expect(failed).toEqual([
		{ status: "rejected", reason: failure },
		{ status: "rejected", reason: failure },
	]);
	expect(writes).toEqual([]);
	expect(subscription.cursor).toBe(0);
	options.commitError = undefined;
	expect(await events.flushLocalPending(subscription)).toBe(true);
	expect(writes).toEqual([1]);
	expect(db.stats.transactions).toBe(2);
	expect(db.stats.active).toBe(0);
});

test("frame delivery refuses an ambient transaction before SQL or sink writes", async () => {
	const db = fenceDatabase({ viewer: 0 });
	const events = localLedger(db.db);
	let writes = 0;
	await expect(
		withTransaction(db.db, async () => {
			await events.flushLocalPending(
				binding("viewer", {
					sessionId: "ambient",
					async write() {
						writes++;
						return { status: "accepted", bufferedBytes: 0 };
					},
					async close() {},
				}),
			);
		}),
	).rejects.toThrow("own transaction");
	expect(writes).toBe(0);
	expect(db.stats.transactions).toBe(1);
	expect(db.queries).toEqual([]);
});

test("direct frame batches refuse ambient transactions before invoking publication", async () => {
	const db = fenceDatabase({ viewer: 0 });
	let published = false;
	await expect(
		withTransaction(db.db, () =>
			db.store.admitExpectedBatch("room", [
				{
					subject: "viewer",
					expectedGeneration: 0,
					publish: () => {
						published = true;
						return undefined;
					},
				},
			]),
		),
	).rejects.toThrow("own transaction");
	expect(published).toBe(false);
	expect(db.queries).toEqual([]);
});

test("subscribeLocal refuses gap output before an outer rollback", async () => {
	const db = fenceDatabase({});
	const events = localLedger(db.db);
	let writes = 0;
	await expect(
		withTransaction(db.db, async () => {
			await events.subscribeLocal({
				subscriptionId: "ambient-gap",
				channel: "room",
				lastEventId: "invalid-resume-id",
				sink: {
					sessionId: "ambient-gap",
					async write() {
						writes++;
						return { status: "accepted", bufferedBytes: 0 };
					},
					async close() {},
				},
			});
			throw new Error("outer rollback");
		}),
	).rejects.toThrow("own transaction");
	expect(writes).toBe(0);
});

test("a connected log gap cannot write from an ambient transaction", async () => {
	const db = fenceDatabase({});
	const events = localLedger(db.db);
	let writes = 0;
	const subscription = binding("viewer", {
		sessionId: "ambient-connected-gap",
		async write() {
			writes++;
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	await expect(
		withTransaction(db.db, () =>
			events.admitContiguous(subscription, { seq: 3 }),
		),
	).rejects.toThrow("own transaction");
	expect(writes).toBe(0);
	expect(db.queries).toEqual([]);
});

test("a rejected commit cannot publish a newly authorized binding generation", async () => {
	const failure = new Error("commit failed after reauthorization");
	let acquisitions = 0;
	const options: { commitError?: Error; beforeCoordinator: () => void } = {
		beforeCoordinator() {
			if (++acquisitions === 2) options.commitError = failure;
		},
	};
	const db = fenceDatabase({ viewer: 1 }, options);
	const events = localLedger(db.db);
	let writes = 0;
	const subscription = binding("viewer", {
		sessionId: "failed-new-generation",
		async write() {
			writes++;
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	await expect(events.flushLocalPending(subscription)).rejects.toThrow(
		failure.message,
	);
	expect(subscription.authorityGeneration).toBe(0);
	expect(subscription.cursor).toBe(0);
	expect(writes).toBe(0);
});

test("closing a queued binding removes its admission without starting SQL", async () => {
	const db = fenceDatabase({ viewer: 0 });
	const events = localLedger(db.db);
	let writes = 0;
	const subscription = binding("viewer", {
		sessionId: "closed-before-seal",
		async write() {
			writes++;
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	const delivery = events.flushLocalPending(subscription);
	events.removeLocalSubscription(subscription);
	expect(await delivery).toBe(false);
	expect(db.stats.transactions).toBe(0);
	expect(writes).toBe(0);
});

test("closing during commit prevents late delivery and remembered generation changes", async () => {
	const db = fenceDatabase({ viewer: 0 }, { holdCommit: true });
	const events = localLedger(db.db);
	let writes = 0;
	const subscription = binding("viewer", {
		sessionId: "closed-during-commit",
		async write() {
			writes++;
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	const delivery = events.flushLocalPending(subscription);
	await db.beforeCommit.promise;
	events.removeLocalSubscription(subscription);
	db.commit.resolve();
	expect(await delivery).toBe(false);
	expect(writes).toBe(0);
	expect(subscription.cursor).toBe(0);
});

test("a newer reconciliation wins over an older frame admission completing", async () => {
	const generations = { viewer: 0 };
	const options: { afterCommit?: () => void } = {};
	const db = fenceDatabase(generations, options);
	const events = localLedger(db.db);
	let writes = 0;
	const subscription = binding("viewer", {
		sessionId: "newer-reconciliation",
		async write() {
			writes++;
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	});
	options.afterCommit = () => {
		options.afterCommit = undefined;
		generations.viewer = 1;
		subscription.authorityGeneration = 1;
	};
	expect(await events.flushLocalPending(subscription)).toBe(true);
	expect(subscription.authorityGeneration).toBe(1);
	expect(db.stats.transactions).toBe(2);
	expect(writes).toBe(1);
});

test("pending frame admissions have a finite bound and explicit overflow", async () => {
	const db = fenceDatabase({ viewer: 0 });
	const events = localLedger(db.db);
	const sink: ClientSink = {
		sessionId: "bounded-pending",
		async write() {
			return { status: "accepted", bufferedBytes: 0 };
		},
		async close() {},
	};
	const results = await Promise.allSettled(
		Array.from({ length: 4097 }, () =>
			events.flushLocalPending(binding("viewer", sink)),
		),
	);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(4096);
	const failures = results.filter((result) => result.status === "rejected");
	expect(failures).toHaveLength(1);
	expect(failures[0]).toMatchObject({
		reason: expect.objectContaining({
			message: "Channel frame admission queue is full",
		}),
	});
});
