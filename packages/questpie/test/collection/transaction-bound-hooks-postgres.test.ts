import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { sql } from "drizzle-orm";
import pg from "pg";
import { z } from "zod";

import { channel } from "../../src/exports/channels.js";
import { collection, withTransaction } from "../../src/exports/index.js";
import { rowsOf } from "../../src/server/db/driver-result.js";
import {
	questpieChannelEventTable,
	questpieRealtimeLogTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

let failUpdateEffect = false;
let optimisticAccessTxids: string[] = [];
let optimisticHookTxids: string[] = [];

async function currentTransactionId(db: any): Promise<string> {
	const result = await db.execute(sql`
		SELECT pg_current_xact_id()::text AS txid
	`);
	return String(rowsOf<{ txid: string }>(result)[0]?.txid);
}

const postgresEffectsChannel = channel("postgres-effects-[targetId]").events({
	applied: z.object({
		targetId: z.string(),
		kind: z.enum(["create", "update"]),
	}),
});

const postgresEffectLogs = collection("postgres_effect_logs").fields(
	({ f }) => ({
		targetId: f.text().required(),
		kind: f.text().required(),
	}),
);

const postgresEffectTargets = collection("postgres_effect_targets")
	.fields(({ f }) => ({ name: f.text().required() }))
	.hooks({
		afterChange: async ({ channels, collections, data, operation }) => {
			await collections.postgresEffectLogs.create({
				targetId: data.id,
				kind: operation,
			});
			await channels.publish("postgresEffects", {
				params: { targetId: data.id },
				event: "applied",
				data: { targetId: data.id, kind: operation },
			});
			if (operation === "update" && failUpdateEffect) {
				throw new Error("postgres transaction-bound update effect failure");
			}
		},
	});

const postgresOptimisticAccessTargets = collection(
	"postgres_optimistic_access_targets",
)
	.fields(({ f }) => ({ name: f.text().required() }))
	.options({ optimisticConcurrency: true })
	.access({
		update: async ({ db }) => {
			optimisticAccessTxids.push(await currentTransactionId(db));
			return true;
		},
	})
	.hooks({
		beforeChange: async ({ db, operation }) => {
			if (operation === "update") {
				optimisticHookTxids.push(await currentTransactionId(db));
			}
		},
	});

describe.skipIf(!runPostgresContract)(
	"transaction-bound hooks on PostgreSQL",
	() => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		const context = createTestContext();
		const accessContext = createTestContext({ role: "user" });

		beforeAll(async () => {
			const pool = new pg.Pool({ connectionString: databaseUrl });
			try {
				await pool.query("create extension if not exists pg_trgm");
			} finally {
				await pool.end();
			}
			setup = await buildMockApp(
				{
					channels: {
						postgresEffects: postgresEffectsChannel,
					},
					collections: {
						postgresEffectLogs,
						postgresEffectTargets,
						postgresOptimisticAccessTargets,
					},
				},
				{ db: { url: databaseUrl!, pool: { max: 5 } } },
			);
			await runTestDbMigrations(setup.app);
		});

		afterAll(async () => {
			if (!setup) return;
			await setup.app.migrations.down();
			await setup.cleanup();
		});

		beforeEach(() => {
			failUpdateEffect = false;
			optimisticAccessTxids = [];
			optimisticHookTxids = [];
		});

		it("keeps optimistic update authority on the locked transaction", async () => {
			const target =
				await setup.app.collections.postgresOptimisticAccessTargets.create(
					{ name: "Before" },
					context,
				);

			await setup.app.collections.postgresOptimisticAccessTargets.updateById(
				{
					id: target.id,
					expectedRevision: target.revision,
					data: { name: "After" },
				},
				accessContext,
			);

			expect(optimisticAccessTxids.length).toBeGreaterThan(1);
			expect(optimisticHookTxids).toHaveLength(1);
			expect(
				new Set([...optimisticAccessTxids, ...optimisticHookTxids]).size,
			).toBe(1);
		});

		it("keeps optimistic updateBatch authority on its locked transaction", async () => {
			const first =
				await setup.app.collections.postgresOptimisticAccessTargets.create(
					{ name: "First" },
					context,
				);
			const second =
				await setup.app.collections.postgresOptimisticAccessTargets.create(
					{ name: "Second" },
					context,
				);

			await setup.app.collections.postgresOptimisticAccessTargets.updateBatch(
				{
					updates: [
						{
							id: first.id,
							expectedRevision: first.revision,
							data: { name: "First updated" },
						},
						{
							id: second.id,
							expectedRevision: second.revision,
							data: { name: "Second updated" },
						},
					],
				},
				accessContext,
			);

			expect(optimisticAccessTxids.length).toBeGreaterThan(2);
			expect(optimisticHookTxids).toHaveLength(2);
			expect(
				new Set([...optimisticAccessTxids, ...optimisticHookTxids]).size,
			).toBe(1);
		});

		it("rolls back row, channel, and realtime ledgers then commits once through a nested transaction", async () => {
			const target = await setup.app.collections.postgresEffectTargets.create(
				{ name: "Before" },
				context,
			);
			const channelRows = async () => {
				const rows = await setup.app.db
					.select()
					.from(questpieChannelEventTable);
				return rows.filter((row) => {
					const payload = row.payload as
						| { targetId?: unknown; kind?: unknown }
						| undefined;
					return (
						row.channel === `postgres-effects-${target.id}` &&
						row.event === "applied" &&
						payload?.targetId === target.id &&
						payload.kind === "update"
					);
				});
			};
			const realtimeRows = async () => {
				const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
				return rows.filter(
					(row) =>
						row.resourceType === "collection" &&
						row.resource === "postgresEffectTargets" &&
						row.operation === "update" &&
						row.recordId === target.id,
				);
			};
			failUpdateEffect = true;

			await expect(
				setup.app.collections.postgresEffectTargets.updateById(
					{ id: target.id, data: { name: "Rolled back" } },
					context,
				),
			).rejects.toThrow("postgres transaction-bound update effect failure");

			const afterRollback =
				await setup.app.collections.postgresEffectTargets.findOne(
					{ where: { id: target.id } },
					context,
				);
			expect(afterRollback?.name).toBe("Before");
			expect(
				await setup.app.collections.postgresEffectLogs.count(
					{ where: { targetId: target.id, kind: "update" } },
					context,
				),
			).toBe(0);
			expect(await channelRows()).toHaveLength(0);
			expect(await realtimeRows()).toHaveLength(0);

			failUpdateEffect = false;
			await withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.postgresEffectTargets.updateById(
					{ id: target.id, data: { name: "Committed" } },
					{ ...context, db: tx },
				);
			});

			expect(
				await setup.app.collections.postgresEffectLogs.count(
					{ where: { targetId: target.id, kind: "update" } },
					context,
				),
			).toBe(1);
			const committedChannelRows = await channelRows();
			expect(committedChannelRows).toHaveLength(1);
			expect(committedChannelRows[0]?.seq).toBe(2);
			expect(committedChannelRows[0]?.eventId).toEndWith(":2");
			expect(await realtimeRows()).toHaveLength(1);
			expect(
				await setup.app.collections.postgresEffectTargets.findOne(
					{ where: { id: target.id } },
					context,
				),
			).toMatchObject({ name: "Committed" });
		});
	},
);
