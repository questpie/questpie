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

describe("realtime transactional change capture", () => {
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
});
