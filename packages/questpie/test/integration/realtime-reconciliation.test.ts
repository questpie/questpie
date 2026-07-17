import { afterEach, describe, expect, it, spyOn } from "bun:test";

import {
	collection,
	type ChangeBroker,
	type ChangeBrokerState,
	type ChangeWake,
	type RealtimeChangeEvent,
} from "../../src/exports/index.js";
import { PgNotifyChangeBroker } from "../../src/server/modules/core/integrated/realtime/adapters/pg-notify.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

class DroppingChangeBroker implements ChangeBroker {
	readonly started: Promise<void>;
	startCalls = 0;
	stops = 0;
	private markStarted: () => void = () => {};
	private wakeHandler: ((wake: ChangeWake) => void) | undefined;
	private stateHandler: ((state: ChangeBrokerState) => void) | undefined;

	constructor() {
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	async start(input: Parameters<ChangeBroker["start"]>[0]): Promise<void> {
		this.startCalls += 1;
		this.wakeHandler = input.onWake;
		this.stateHandler = input.onStateChange;
		this.markStarted();
	}

	async stop(): Promise<void> {
		this.stops += 1;
	}

	async publish(_wake: ChangeWake): Promise<void> {
		// Simulate a broker that accepted but dropped the wake-up notice.
	}

	emit(wake: ChangeWake): void {
		this.wakeHandler?.(wake);
	}

	emitState(state: ChangeBrokerState): void {
		this.stateHandler?.(state);
	}
}

class SharedWakeBroker {
	private handlers = new Set<(wake: ChangeWake) => void>();

	subscribe(handler: (wake: ChangeWake) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	publish(wake: ChangeWake): void {
		for (const handler of this.handlers) handler(wake);
	}
}

class SharedChangeBroker implements ChangeBroker {
	readonly listening: Promise<void>;
	startCalls = 0;
	private markListening: () => void = () => {};
	private brokerUnsubscribe: (() => void) | undefined;
	private wakeHandler: ((wake: ChangeWake) => void) | undefined;

	constructor(private broker: SharedWakeBroker) {
		this.listening = new Promise((resolve) => {
			this.markListening = resolve;
		});
	}

	async start(input: Parameters<ChangeBroker["start"]>[0]): Promise<void> {
		this.startCalls += 1;
		this.wakeHandler = input.onWake;
		this.brokerUnsubscribe ??= this.broker.subscribe((wake) =>
			this.wakeHandler?.(wake),
		);
		this.markListening();
	}

	async stop(): Promise<void> {
		this.brokerUnsubscribe?.();
		this.brokerUnsubscribe = undefined;
	}

	async publish(wake: ChangeWake): Promise<void> {
		this.broker.publish(wake);
	}
}

type ReadGate = {
	reached: Promise<void>;
	release: () => void;
};

type SelectQuery = {
	from: () => SelectQuery;
	where: () => SelectQuery;
	orderBy: () => SelectQuery;
	limit: () => Promise<Array<Record<string, unknown>>>;
};

class ControlledRealtimeReadDb {
	rows: RealtimeChangeEvent[] = [];
	private nextReadGate:
		| (ReadGate & { markReached: () => void; released: Promise<void> })
		| undefined;

	pauseNextRead(): ReadGate {
		let markReached = () => {};
		let release = () => {};
		const reached = new Promise<void>((resolve) => {
			markReached = resolve;
		});
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.nextReadGate = { reached, released, markReached, release };
		return { reached, release };
	}

	select(selection?: unknown): SelectQuery {
		const isLatestSeqRead =
			selection !== undefined &&
			typeof selection === "object" &&
			selection !== null &&
			Object.keys(selection).length === 1 &&
			"seq" in selection;
		const query: SelectQuery = {
			from: () => query,
			where: () => query,
			orderBy: () => query,
			limit: async () => {
				if (isLatestSeqRead) {
					const latest = this.rows.at(-1);
					return latest ? [{ seq: latest.seq }] : [];
				}

				const snapshot = this.rows.map((row) => ({ ...row }));
				const gate = this.nextReadGate;
				this.nextReadGate = undefined;
				if (gate) {
					gate.markReached();
					await gate.released;
				}
				return snapshot;
			},
		};
		return query;
	}
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 10; index++) {
		await Promise.resolve();
	}
}

describe("realtime matrix reconciliation", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
	});

	it("G1: implicit pg broker publishes with zero local subscribers", async () => {
		const startSpy = spyOn(
			PgNotifyChangeBroker.prototype,
			"start",
		).mockResolvedValue();
		const publishSpy = spyOn(
			PgNotifyChangeBroker.prototype,
			"publish",
		).mockResolvedValue();
		const realtime = new RealtimeService(
			new ControlledRealtimeReadDb() as never,
			{ pollIntervalMs: 0 },
			"postgres://questpie.test/app",
		);
		cleanup = () => realtime.destroy();
		const change: RealtimeChangeEvent = {
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			recordId: "post-1",
			locale: null,
			payload: { id: "post-1" },
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		};

		try {
			await realtime.notify(change);
			expect(publishSpy).toHaveBeenCalledTimes(1);
			expect(publishSpy).toHaveBeenCalledWith({
				kind: "outbox-maybe-advanced",
				highWaterSeq: 1,
				reason: "publish",
			});
		} finally {
			publishSpy.mockRestore();
			startSpy.mockRestore();
		}
	});

	it("G1: app boot starts the broker without a subscription", async () => {
		const adapter = new DroppingChangeBroker();
		const setup = await buildMockApp(
			{},
			{ realtime: { changeBroker: adapter } },
		);
		cleanup = setup.cleanup;

		expect(adapter.startCalls).toBe(1);
	});

	it("G1: zero listeners keep the app-lifecycle publisher running", async () => {
		const adapter = new DroppingChangeBroker();
		const setup = await buildMockApp(
			{},
			{ realtime: { changeBroker: adapter } },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const unsubscribe = setup.app.realtime.subscribe(() => {}, {
			resourceType: "collection",
			resource: "posts",
		});
		await adapter.started;

		unsubscribe();
		await flushMicrotasks();

		expect(adapter.stops).toBe(0);
		expect(adapter.startCalls).toBe(1);
	});

	it("G1: a zero-subscriber instance wakes a second service instance", async () => {
		const broker = new SharedWakeBroker();
		const publisherAdapter = new SharedChangeBroker(broker);
		const receiverAdapter = new SharedChangeBroker(broker);
		const publisher = new RealtimeService(
			new ControlledRealtimeReadDb() as never,
			{ changeBroker: publisherAdapter, pollIntervalMs: 0 },
		);
		const receiverDb = new ControlledRealtimeReadDb();
		const receiver = new RealtimeService(receiverDb as never, {
			changeBroker: receiverAdapter,
			pollIntervalMs: 0,
		});
		cleanup = async () => {
			await Promise.all([publisher.destroy(), receiver.destroy()]);
		};
		const delivered: RealtimeChangeEvent[] = [];
		receiver.subscribe((event) => delivered.push(event), {
			resourceType: "collection",
			resource: "posts",
		});
		await receiverAdapter.listening;
		await flushMicrotasks();

		const change: RealtimeChangeEvent = {
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			recordId: "post-1",
			locale: null,
			payload: { id: "post-1" },
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		};
		receiverDb.rows = [change];
		await publisher.notify(change);
		await flushMicrotasks();

		expect(delivered).toEqual([change]);
		expect(publisherAdapter.startCalls).toBe(1);
	});

	it("G2: broker mode defaults to a slow reconciliation poll", async () => {
		const adapter = new DroppingChangeBroker();
		const db = new ControlledRealtimeReadDb();
		let scheduledDelay: number | undefined;
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(_handler, delay) => {
				scheduledDelay = Number(delay);
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
		);

		try {
			const realtime = new RealtimeService(db as never, {
				changeBroker: adapter,
			});
			cleanup = () => realtime.destroy();
			realtime.subscribe(() => {}, {
				resourceType: "collection",
				resource: "posts",
			});
			await adapter.started;
			await flushMicrotasks();

			expect(scheduledDelay).toBe(15_000);
		} finally {
			intervalSpy.mockRestore();
		}
	});

	it("G2: broker mode heals a dropped notice on the reconciliation poll", async () => {
		const adapter = new DroppingChangeBroker();
		let triggerPoll: (() => void) | undefined;
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(handler, delay) => {
				if (delay === 25_000) {
					triggerPoll = () => {
						if (typeof handler === "function") handler();
					};
				}
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
		);

		try {
			const setup = await buildMockApp(
				{
					collections: {
						posts: collection("posts").fields(({ f }) => ({
							title: f.text().required(),
						})),
					},
				},
				{ realtime: { changeBroker: adapter, pollIntervalMs: 25_000 } },
			);
			cleanup = setup.cleanup;
			await runTestDbMigrations(setup.app);
			const delivered = new Promise<RealtimeChangeEvent>((resolve) => {
				setup.app.realtime.subscribe(resolve, {
					resourceType: "collection",
					resource: "posts",
				});
			});
			await adapter.started;
			for (let attempt = 0; attempt < 100; attempt++) {
				if (triggerPoll) break;
				await new Promise((resolve) => setTimeout(resolve, 1));
			}

			expect(triggerPoll).toBeDefined();

			const change = await setup.app.realtime.appendChange({
				resourceType: "collection",
				resource: "posts",
				operation: "create",
				recordId: "post-1",
				locale: null,
				payload: { id: "post-1", title: "Dropped wake" },
			});
			await setup.app.realtime.notify(change);

			triggerPoll?.();
			expect(await delivered).toEqual(change);
		} finally {
			intervalSpy.mockRestore();
		}
	});

	it("G2: a notice during the final drain read triggers another drain", async () => {
		const adapter = new DroppingChangeBroker();
		const db = new ControlledRealtimeReadDb();
		const realtime = new RealtimeService(db as never, {
			changeBroker: adapter,
			pollIntervalMs: 0,
		});
		cleanup = () => realtime.destroy();
		const delivered: RealtimeChangeEvent[] = [];
		realtime.subscribe((event) => delivered.push(event), {
			resourceType: "collection",
			resource: "posts",
		});
		await adapter.started;
		await flushMicrotasks();

		const finalRead = db.pauseNextRead();
		adapter.emit({
			kind: "outbox-maybe-advanced",
			highWaterSeq: 1,
			reason: "publish",
		});
		await finalRead.reached;

		const change: RealtimeChangeEvent = {
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			recordId: "post-1",
			locale: null,
			payload: { id: "post-1" },
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		};
		db.rows = [change];
		adapter.emit({
			kind: "outbox-maybe-advanced",
			highWaterSeq: change.seq,
			reason: "publish",
		});
		finalRead.release();
		await flushMicrotasks();

		expect(delivered).toEqual([change]);
	});

	it("G2: reconnect triggers an immediate reconciliation drain", async () => {
		const adapter = new DroppingChangeBroker();
		const db = new ControlledRealtimeReadDb();
		const realtime = new RealtimeService(db as never, {
			changeBroker: adapter,
			pollIntervalMs: 0,
		});
		cleanup = () => realtime.destroy();
		const delivered: RealtimeChangeEvent[] = [];
		realtime.subscribe((event) => delivered.push(event), {
			resourceType: "collection",
			resource: "posts",
		});
		await adapter.started;
		await flushMicrotasks();

		const change: RealtimeChangeEvent = {
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
			recordId: "post-1",
			locale: null,
			payload: { id: "post-1" },
			createdAt: new Date("2026-07-13T20:00:00.000Z"),
		};
		db.rows = [change];
		adapter.emitState("connected");
		await flushMicrotasks();

		expect(delivered).toEqual([change]);
	});
});
