/**
 * A cancelled LIVE callback cannot issue SQL through a returned pooled handle.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { z } from "zod";

import { route, withTransaction } from "../../src/exports/index.js";
import { rowsOf } from "../../src/server/db/driver-result.js";
import { prepareJsonRoute } from "../../src/server/routes/execute.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const writes = pgTable("query_lifetime_writes", {
	id: serial().primaryKey(),
	note: text().notNull(),
});

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const waitFor = async (check: () => boolean, ms = 5000) => {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("probe condition timed out");
		await Bun.sleep(5);
	}
};

describe.each(["node-postgres", "bun-sql"] as const)(
	"cancelled query lifetime (%s)",
	(driver) => {
		if (!databaseUrl) {
			it.skip("requires QUESTPIE_TRANSACTION_LOCK_DATABASE_URL", () => {});
			return;
		}
		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeAll(async () => {
			setup = await buildMockApp(
				{ collections: {} },
				{
					db: {
						url: databaseUrl,
						pool: { max: 1 },
						...(driver === "node-postgres" ? { driver } : {}),
					},
				},
			);
			await setup.app.db.execute(sql`create extension if not exists pg_trgm`);
			await runTestDbMigrations(setup.app);
			await setup.app.db.execute(
				sql`create table if not exists query_lifetime_writes (id serial primary key, note text not null)`,
			);
			await setup.app.db.execute(sql`truncate query_lifetime_writes`);
		}, 30_000);

		afterAll(async () => {
			if (!setup) return;
			await setup.app.db.execute(
				sql`drop table if exists query_lifetime_writes`,
			);
			await setup.app.migrations.down();
			await setup.cleanup();
		});

		it("keeps a stricter connection statement timeout", async () => {
			await setup.app.db.execute(sql`set statement_timeout = '5000'`);
			try {
				const definition = route()
					.post()
					.schema(z.object({}))
					.outputSchema(z.string())
					.access(true)
					.query()
					.handler(async ({ db }) => {
						const [row] = rowsOf<{ value: string }>(
							await db.execute(
								sql`select current_setting('statement_timeout') as value`,
							),
						);
						return row!.value;
					});
				const result = await prepareJsonRoute(
					setup.app,
					definition,
					{},
				).snapshot({ accessMode: "system" });
				expect(result.data).toBe("5s");
			} finally {
				await setup.app.db.execute(sql`reset statement_timeout`);
			}
		});

		it("refuses nested transactions and expires completed query handles", async () => {
			let late!: () => Promise<unknown>;
			const definition = route()
				.post()
				.schema(z.object({}))
				.outputSchema(z.object({}))
				.access(true)
				.query()
				.handler(async ({ db }) => {
					await expect(
						Promise.resolve().then(() => db.transaction(async () => {})),
					).rejects.toThrow("Query routes cannot open nested transactions");
					late = async () => db.execute(sql`select 1`);
					return {};
				});
			await prepareJsonRoute(setup.app, definition, {}).snapshot({
				accessMode: "system",
			});
			await expect(late()).rejects.toThrow();
			expect(rowsOf(await setup.app.db.execute(sql`select 1`))).toHaveLength(1);
		});

		it.each(["raw", "prepared"] as const)(
			"rejects late %s statements before another owner can observe them",
			async (mode) => {
				const entered = deferred();
				const gate = deferred();
				let staleWrite: string | undefined;
				let staleError: unknown;
				const note = `stale-live-write-${driver}`;
				const definition = route()
					.post()
					.schema(z.object({}))
					.outputSchema(z.object({}))
					.access(true)
					.query()
					.handler(async ({ db }) => {
						const insert = db.execute(
							sql`insert into query_lifetime_writes (note) values (${note})`,
						);
						const prepared =
							mode === "prepared"
								? db
										.insert(writes)
										.values({ note })
										.prepare("lifetime_late_insert")
								: undefined;
						// Drizzle execute is lazy; raw and prepared handles both capture
						// the old session before cancellation, but run only afterward.
						await db.execute(sql`select 1`);
						entered.resolve();
						await gate.promise; // application JS that ignores request.signal
						try {
							if (prepared) await prepared.execute();
							else await insert;
							staleWrite = "ok";
						} catch (error) {
							staleError = error;
						}
						return {};
					});

				const cancellation = new AbortController();
				const request = new Request("http://localhost/api/probe", {
					method: "POST",
					signal: cancellation.signal,
				});
				const evaluation = prepareJsonRoute(
					setup.app,
					definition,
					{},
					request,
				).snapshot({ accessMode: "system" });
				await entered.promise;
				cancellation.abort(new Error("watch closed"));
				const failure = await evaluation.catch((error: unknown) => error);
				expect(String(failure)).toContain("watch closed");

				// An unrelated ordinary request now owns the only pooled connection.
				const otherEntered = deferred<{ pid: unknown; ro: unknown }>();
				const otherGate = deferred();
				let otherSawStaleRow: number | undefined;
				const other = withTransaction(setup.app.db, async (tx) => {
					const [row] = rowsOf<{ pid: number; ro: string }>(
						await tx.execute(
							sql`select pg_backend_pid() as pid, current_setting('transaction_read_only') as ro`,
						),
					);
					otherEntered.resolve(row!);
					await otherGate.promise;
					const [count] = rowsOf<{ n: number }>(
						await tx.execute(
							sql`select count(*)::int as n from query_lifetime_writes where note = ${note}`,
						),
					);
					otherSawStaleRow = Number(count!.n);
				});
				const otherRow = await otherEntered.promise;

				gate.resolve(); // the cancelled handler continues
				await waitFor(
					() => staleWrite !== undefined || staleError !== undefined,
				);
				otherGate.resolve();
				await other;

				const [committed] = rowsOf<{ n: number }>(
					await setup.app.db.execute(
						sql`select count(*)::int as n from query_lifetime_writes where note = ${note}`,
					),
				);
				expect(staleError).toBeDefined();
				expect(staleWrite).toBeUndefined();
				expect(otherSawStaleRow).toBe(0);
				expect(Number(committed!.n)).toBe(0);
				expect(otherRow.ro).toBe("off");
			},
			30_000,
		);
	},
);
