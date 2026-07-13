import { afterEach, describe, expect, it, spyOn } from "bun:test";

import {
	collection,
	type RealtimeAdapter,
	type RealtimeChangeEvent,
	type RealtimeNotice,
} from "../../src/exports/index.js";
import { RealtimeService } from "../../src/server/modules/core/integrated/realtime/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

class DroppingRealtimeAdapter implements RealtimeAdapter {
	readonly started: Promise<void>;
	private markStarted: () => void = () => {};
	private noticeHandler: ((notice: RealtimeNotice) => void) | undefined;
	private stateHandler:
		| ((state: "connected" | "disconnected") => void)
		| undefined;

	constructor() {
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	async start(): Promise<void> {
		this.markStarted();
	}

	async stop(): Promise<void> {}

	subscribe(handler: (notice: RealtimeNotice) => void): () => void {
		this.noticeHandler = handler;
		return () => {
			this.noticeHandler = undefined;
		};
	}

	async notify(_event: RealtimeChangeEvent): Promise<void> {
		// Simulate a broker that accepted but dropped the wake-up notice.
	}

	emit(notice: RealtimeNotice): void {
		this.noticeHandler?.(notice);
	}

	onStateChange(
		handler: (state: "connected" | "disconnected") => void,
	): () => void {
		this.stateHandler = handler;
		return () => {
			this.stateHandler = undefined;
		};
	}

	emitState(state: "connected" | "disconnected"): void {
		this.stateHandler?.(state);
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
		const isLatestSeqRead = selection !== undefined;
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

describe("realtime reconciliation", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
	});

	it("G2: adapter mode defaults to a slow reconciliation poll", async () => {
		const adapter = new DroppingRealtimeAdapter();
		const db = new ControlledRealtimeReadDb();
		let scheduledDelay: number | undefined;
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(_handler, delay) => {
				scheduledDelay = Number(delay);
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
		);

		try {
			const realtime = new RealtimeService(db as never, { adapter });
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

	it("G2: adapter mode heals a dropped notice on the reconciliation poll", async () => {
		const adapter = new DroppingRealtimeAdapter();
		const setup = await buildMockApp(
			{
				collections: {
					posts: collection("posts").fields(({ f }) => ({
						title: f.text().required(),
					})),
				},
			},
			{ realtime: { adapter, pollIntervalMs: 25_000 } },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);

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
			const delivered = new Promise<RealtimeChangeEvent>((resolve) => {
				setup.app.realtime.subscribe(resolve, {
					resourceType: "collection",
					resource: "posts",
				});
			});
			await adapter.started;
			await Promise.resolve();

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
		const adapter = new DroppingRealtimeAdapter();
		const db = new ControlledRealtimeReadDb();
		const realtime = new RealtimeService(db as never, {
			adapter,
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
			seq: 1,
			resourceType: "collection",
			resource: "posts",
			operation: "create",
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
		adapter.emit(RealtimeService.noticeFromEvent(change));
		finalRead.release();
		await flushMicrotasks();

		expect(delivered).toEqual([change]);
	});

	it("G2: reconnect triggers an immediate reconciliation drain", async () => {
		const adapter = new DroppingRealtimeAdapter();
		const db = new ControlledRealtimeReadDb();
		const realtime = new RealtimeService(db as never, {
			adapter,
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
