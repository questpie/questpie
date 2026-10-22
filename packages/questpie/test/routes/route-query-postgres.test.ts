/**
 * `route().query()` on PostgreSQL: a commit landing between two reads of one
 * evaluation stays invisible to it. PGlite cannot interleave a second
 * connection, so this needs a real server for each pooled driver.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { collection, route, withTransaction } from "../../src/exports/index.js";
import { rowsOf } from "../../src/server/db/driver-result.js";
import {
	executeJsonRoute,
	prepareJsonRoute,
} from "../../src/server/routes/execute.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe.each(["bun-sql", "node-postgres"] as const)(
	"route().query() snapshot on PostgreSQL (%s)",
	(driver) => {
		if (!databaseUrl) {
			it.skip("requires QUESTPIE_TRANSACTION_LOCK_DATABASE_URL", () => {});
			return;
		}

		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let leftId: string;
		let rightId: string;
		let betweenReads = async () => {};

		const left = collection("query_snapshot_left")
			.fields(({ f }) => ({ value: f.number().required() }))
			.access({ read: true, create: true, update: true });
		const right = collection("query_snapshot_right")
			.fields(({ f }) => ({ value: f.number().required() }))
			.access({ read: true, create: true, update: true });

		const pair = z.object({
			left: z.number(),
			right: z.number(),
			settings: z.string(),
		});
		const readPair = async ({ collections, db }: any) => {
			const first = await collections.query_snapshot_left.findOne({
				where: { id: leftId },
			});
			await betweenReads();
			const second = await collections.query_snapshot_right.findOne({
				where: { id: rightId },
			});
			const [settings] = rowsOf<{ value: string }>(
				await db.execute(
					sql`select current_setting('transaction_isolation') || '/' || current_setting('transaction_read_only') as value`,
				),
			);
			return {
				left: first.value,
				right: second.value,
				settings: settings!.value,
			};
		};
		const pairQuery = route()
			.post()
			.schema(z.object({}))
			.outputSchema(pair)
			.access(true)
			.query()
			.handler(readPair);
		const pairOrdinary = route()
			.post()
			.schema(z.object({}))
			.outputSchema(pair)
			.access(true)
			.handler(readPair);
		const writes = route()
			.post()
			.schema(z.object({}))
			.outputSchema(z.object({}))
			.access(true)
			.query()
			.handler(async ({ collections }: any) => {
				await collections.query_snapshot_left.updateById({
					id: leftId,
					data: { value: 100 },
				});
				return {};
			});

		const user = { accessMode: "user" as const };

		/** Commit an atomic update of both collections between the two reads. */
		async function commitBetweenReads(
			definition: typeof pairQuery,
			value: number,
			coherent = false,
		) {
			const firstRead = deferred();
			const committed = deferred();
			betweenReads = async () => {
				firstRead.resolve();
				await committed.promise;
			};
			try {
				const evaluation = coherent
					? prepareJsonRoute(setup.app, definition, {})
							.snapshot(user)
							.then((snapshot) => {
								expect(snapshot.upToDate).toMatch(/^\d+$/);
								return snapshot.data;
							})
					: executeJsonRoute(setup.app, definition, {}, user);
				await firstRead.promise;
				await withTransaction(setup.app.db, async (tx) => {
					await setup.app.collections.query_snapshot_left.updateById(
						{ id: leftId, data: { value } },
						{ db: tx },
					);
					await setup.app.collections.query_snapshot_right.updateById(
						{ id: rightId, data: { value } },
						{ db: tx },
					);
				});
				committed.resolve();
				return await evaluation;
			} finally {
				betweenReads = async () => {};
			}
		}

		beforeAll(async () => {
			setup = await buildMockApp(
				{
					collections: {
						query_snapshot_left: left,
						query_snapshot_right: right,
					},
				},
				{
					db: {
						url: databaseUrl,
						pool: { max: 4 },
						...(driver === "node-postgres" ? { driver } : {}),
					},
				},
			);
			await setup.app.db.execute(sql`create extension if not exists pg_trgm`);
			await runTestDbMigrations(setup.app);
			leftId = (
				await setup.app.collections.query_snapshot_left.create({ value: 1 })
			).id;
			rightId = (
				await setup.app.collections.query_snapshot_right.create({ value: 1 })
			).id;
		}, 30_000);

		afterAll(async () => {
			if (!setup) return;
			await setup.app.migrations.down();
			await setup.cleanup();
		});

		it("keeps both reads on the snapshot taken before a concurrent commit", async () => {
			expect(await commitBetweenReads(pairQuery, 2)).toEqual({
				left: 1,
				right: 1,
				settings: "repeatable read/on",
			});
			expect(await executeJsonRoute(setup.app, pairQuery, {}, user)).toEqual({
				left: 2,
				right: 2,
				settings: "repeatable read/on",
			});
		});

		it("control: an ordinary route observes the commit between its reads", async () => {
			expect(await commitBetweenReads(pairOrdinary, 3)).toEqual({
				left: 2,
				right: 3,
				settings: "read committed/off",
			});
		});

		it("keeps LIVE data and its captured watermark in the same old/old snapshot", async () => {
			expect(await commitBetweenReads(pairQuery, 4, true)).toEqual({
				left: 3,
				right: 3,
				settings: "repeatable read/on",
			});
		});

		it("rejects writes as read_only_sql_transaction", async () => {
			const failure = await executeJsonRoute(setup.app, writes, {}, user).catch(
				(error: unknown) =>
					error as { cause?: { code?: string; errno?: string } },
			);
			// Bun SQL reports SQLSTATE as `errno`, node-postgres as `code`.
			expect(failure?.cause?.errno ?? failure?.cause?.code).toBe("25006");
			expect(
				(
					await setup.app.collections.query_snapshot_left.findOne({
						where: { id: leftId },
					})
				)?.value,
			).toBe(4);
		});
	},
);
