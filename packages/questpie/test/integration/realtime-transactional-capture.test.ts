import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import {
	collection,
	global,
	questpieRealtimeLogTable,
	type RealtimeChangeEvent,
	withTransaction,
} from "../../src/exports/index.js";
import type {
	GlobalCollectionHookContext,
	GlobalGlobalHookContext,
} from "../../src/server/config/global-hooks-types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

async function settleWithinEventLoopTurns(
	promise: Promise<unknown>,
	turns = 50,
): Promise<boolean> {
	let settled = false;
	void promise.finally(() => {
		settled = true;
	});
	for (let turn = 0; turn < turns; turn += 1) {
		if (settled) return true;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	return settled;
}

async function flushEventLoopTurns(turns = 10): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

describe("realtime matrix transactional change capture", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;
	let observeCollectionHook:
		| ((hookContext: GlobalCollectionHookContext) => Promise<void>)
		| undefined;
	let observeGlobalHook:
		| ((hookContext: GlobalGlobalHookContext) => Promise<void>)
		| undefined;

	beforeEach(async () => {
		observeCollectionHook = undefined;
		observeGlobalHook = undefined;
		setup = await buildMockApp(
			{
				collections: {
					posts: collection("posts").fields(({ f }) => ({
						title: f.text().required(),
					})),
				},
				globals: {
					siteSettings: global("site_settings").fields(({ f }) => ({
						title: f.text().required(),
					})),
				},
				hooks: {
					collections: [
						{
							include: ["posts"],
							afterChange: async (hookContext) => {
								await observeCollectionHook?.(hookContext);
							},
							afterDelete: async (hookContext) => {
								await observeCollectionHook?.(hookContext);
							},
						},
					],
					globals: [
						{
							include: ["site_settings"],
							afterChange: async (hookContext) => {
								await observeGlobalHook?.(hookContext);
							},
						},
					],
				},
			},
			{ realtime: { pollIntervalMs: 10 } },
		);
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("G11: writes the outbox row inside the mutation transaction", async () => {
		let rowsVisibleInsideTransaction = 0;
		observeCollectionHook = async (hookContext) => {
			const rows = await hookContext.db.select().from(questpieRealtimeLogTable);
			rowsVisibleInsideTransaction = rows.length;
		};

		await setup.app.collections.posts.create({ title: "Captured" }, ctx);

		expect(rowsVisibleInsideTransaction).toBe(1);
	});

	it("G11: writes global changes inside the mutation transaction", async () => {
		let rowsVisibleInsideTransaction = 0;
		observeGlobalHook = async (hookContext) => {
			const rows = await hookContext.db.select().from(questpieRealtimeLogTable);
			rowsVisibleInsideTransaction = rows.length;
		};

		await setup.app.globals.siteSettings.update({ title: "Captured" }, ctx);

		expect(rowsVisibleInsideTransaction).toBe(1);
	});

	it("G11: runs bulk-delete post-hooks on the transaction-bound database", async () => {
		let usesTransactionBoundDb = false;
		observeCollectionHook = async (hookContext) => {
			if (hookContext.operation === "delete" && hookContext.isBatch) {
				usesTransactionBoundDb = hookContext.db !== setup.app.db;
			}
		};
		const post = await setup.app.collections.posts.create(
			{ title: "Delete me" },
			ctx,
		);

		await setup.app.collections.posts.delete({ where: { id: post.id } }, ctx);

		expect(usesTransactionBoundDb).toBe(true);
	});

	it("G11: rolls the outbox row back with the business mutation", async () => {
		await expect(
			withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.posts.create(
					{ title: "Rolled back" },
					{ ...ctx, db: tx },
				);
				throw new Error("rollback transaction");
			}),
		).rejects.toThrow("rollback transaction");

		const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
		expect(rows).toHaveLength(0);
	});

	it("G11: reconciliation delivers a committed row when notify is suppressed", async () => {
		let triggerPoll = () => {
			throw new Error("Realtime poll did not start");
		};
		let markPollStarted = () => {};
		const pollStarted = new Promise<void>((resolve) => {
			markPollStarted = resolve;
		});
		const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
			(handler) => {
				triggerPoll = () => {
					if (typeof handler === "function") handler();
				};
				markPollStarted();
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
		);

		const delivered = new Promise<RealtimeChangeEvent>((resolve) => {
			setup.app.realtime.subscribe(resolve, {
				resourceType: "collection",
				resource: "posts",
			});
		});

		try {
			await pollStarted;
			await setup.app.collections.posts.create({ title: "Poll me" }, ctx);

			const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
			expect(rows).toHaveLength(1);

			triggerPoll();
			expect(await delivered).toMatchObject({
				operation: "create",
				resource: "posts",
			});
		} finally {
			intervalSpy.mockRestore();
		}
	});

	it("G9: emits exactly one outbox row and notify for a bulk update", async () => {
		const notifications: RealtimeChangeEvent[] = [];
		const notifySpy = spyOn(setup.app.realtime, "notify").mockImplementation(
			async (event: RealtimeChangeEvent) => {
				notifications.push(event);
			},
		);
		const first = await setup.app.collections.posts.create(
			{ title: "First" },
			ctx,
		);
		const second = await setup.app.collections.posts.create(
			{ title: "Second" },
			ctx,
		);
		notifications.length = 0;

		try {
			await setup.app.collections.posts.update(
				{
					where: { id: { in: [first.id, second.id] } },
					data: { title: "Updated" },
				},
				ctx,
			);
		} finally {
			notifySpy.mockRestore();
		}

		const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
		const bulkRows = rows.filter(
			(row: { operation: string }) => row.operation === "bulk_update",
		);
		const bulkNotices = notifications.filter(
			(event) => event.operation === "bulk_update",
		);

		expect(bulkRows).toHaveLength(1);
		expect(bulkNotices).toHaveLength(1);
		expect(bulkRows[0]?.payload).toEqual({
			count: 2,
			recordIds: [first.id, second.id],
		});
	});

	it("G9: emits exactly one outbox row and notify for a bulk delete", async () => {
		const notifications: RealtimeChangeEvent[] = [];
		const notifySpy = spyOn(setup.app.realtime, "notify").mockImplementation(
			async (event: RealtimeChangeEvent) => {
				notifications.push(event);
			},
		);
		const first = await setup.app.collections.posts.create(
			{ title: "First" },
			ctx,
		);
		const second = await setup.app.collections.posts.create(
			{ title: "Second" },
			ctx,
		);
		notifications.length = 0;

		try {
			await setup.app.collections.posts.delete(
				{ where: { id: { in: [first.id, second.id] } } },
				ctx,
			);
		} finally {
			notifySpy.mockRestore();
		}

		const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
		const bulkRows = rows.filter(
			(row: { operation: string }) => row.operation === "bulk_delete",
		);
		const bulkNotices = notifications.filter(
			(event) => event.operation === "bulk_delete",
		);

		expect(bulkRows).toHaveLength(1);
		expect(bulkNotices).toHaveLength(1);
		expect(bulkRows[0]?.payload).toEqual({
			count: 2,
			recordIds: [first.id, second.id],
		});
	});

	it("G9: does not hold the bulk response open for adapter publish", async () => {
		const first = await setup.app.collections.posts.create(
			{ title: "First" },
			ctx,
		);
		const second = await setup.app.collections.posts.create(
			{ title: "Second" },
			ctx,
		);
		let signalPublishStarted = () => {};
		const publishStarted = new Promise<void>((resolve) => {
			signalPublishStarted = resolve;
		});
		let releasePublish = () => {};
		const blockedPublish = new Promise<void>((resolve) => {
			releasePublish = resolve;
		});
		const notifySpy = spyOn(setup.app.realtime, "notify").mockImplementation(
			async (event: RealtimeChangeEvent) => {
				if (event.operation !== "bulk_update") return;
				signalPublishStarted();
				await blockedPublish;
			},
		);
		const mutation = setup.app.collections.posts.update(
			{
				where: { id: { in: [first.id, second.id] } },
				data: { title: "Updated" },
			},
			ctx,
		);

		try {
			await publishStarted;
			expect(await settleWithinEventLoopTurns(mutation)).toBe(true);
		} finally {
			releasePublish();
			await mutation;
			notifySpy.mockRestore();
		}
	});

	it("G9: logs fire-and-forget adapter publish failures", async () => {
		const first = await setup.app.collections.posts.create(
			{ title: "First" },
			ctx,
		);
		const second = await setup.app.collections.posts.create(
			{ title: "Second" },
			ctx,
		);
		const notifySpy = spyOn(setup.app.realtime, "notify").mockImplementation(
			async (event: RealtimeChangeEvent) => {
				if (event.operation === "bulk_update") {
					throw new Error("publish failed for bulk_update");
				}
			},
		);

		try {
			await setup.app.collections.posts.update(
				{
					where: { id: { in: [first.id, second.id] } },
					data: { title: "Updated" },
				},
				ctx,
			);
			await flushEventLoopTurns();
		} finally {
			notifySpy.mockRestore();
		}

		expect(
			setup.app.mocks.logger.getLogsContaining("Realtime publish failed"),
		).toHaveLength(1);
	});

	it("G8: stores pre/post scalar projections for update and delete", async () => {
		const post = await setup.app.collections.posts.create(
			{ title: "Original" },
			ctx,
		);

		await setup.app.collections.posts.updateById(
			{ id: post.id, data: { title: "Updated" } },
			ctx,
		);
		await setup.app.collections.posts.deleteById({ id: post.id }, ctx);

		const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
		const update = rows.find(
			(row: { operation: string }) => row.operation === "update",
		);
		const deletion = rows.find(
			(row: { operation: string }) => row.operation === "delete",
		);

		expect(update?.payload).toMatchObject({
			before: { id: post.id, title: "Original" },
			after: { id: post.id, title: "Updated" },
		});
		expect(deletion?.payload).toMatchObject({
			before: { id: post.id, title: "Updated" },
			after: null,
		});
	});

	it("H11: silently ignores only a missing realtime table", async () => {
		const missingTable = new Error("realtime insert failed", {
			cause: Object.assign(new Error("relation does not exist"), {
				code: "42P01",
			}),
		});
		const appendSpy = spyOn(
			setup.app.realtime,
			"appendChange",
		).mockImplementation(async () => {
			throw missingTable;
		});

		try {
			await setup.app.collections.posts.create({ title: "No table yet" }, ctx);
		} finally {
			appendSpy.mockRestore();
		}

		expect(
			setup.app.mocks.logger.getLogsContaining(
				"Realtime change capture failed",
			),
		).toHaveLength(0);
	});

	it("H11: rate-limits warnings for non-42P01 capture failures", async () => {
		const appendSpy = spyOn(
			setup.app.realtime,
			"appendChange",
		).mockImplementation(async () => {
			throw Object.assign(new Error("database unavailable"), { code: "08006" });
		});

		try {
			await setup.app.collections.posts.create({ title: "First" }, ctx);
			await setup.app.collections.posts.create({ title: "Second" }, ctx);
		} finally {
			appendSpy.mockRestore();
		}

		expect(
			setup.app.mocks.logger.getLogsContaining(
				"Realtime change capture failed",
			),
		).toHaveLength(1);
	});
});
