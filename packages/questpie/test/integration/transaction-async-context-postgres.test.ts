import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle as bunDrizzle } from "drizzle-orm/bun-sql";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import pg from "pg";
import postgres from "postgres";

import {
	getCurrentTransaction,
	onAfterCommit,
	withTransaction,
} from "../../src/server/collection/crud/shared/transaction.js";
import dbService from "../../src/server/modules/core/services/db.js";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;

describe.skipIf(!databaseUrl)(
	"transaction callback async context on PostgreSQL",
	() => {
		test("Bun idle reconnect preserves caller and transaction context", async () => {
			const connection = new SQL(databaseUrl!, { max: 1, idleTimeout: 1 });
			const caller = new AsyncLocalStorage<string>();
			const db = bunDrizzle({ client: connection });
			try {
				const [{ pid: originalPid }] =
					await connection`SELECT pg_backend_pid() AS pid`;
				await Bun.sleep(2500);
				const reader = caller.run("reader", async () => {
					await connection`SELECT pg_sleep(0.05)`;
					expect(caller.getStore()).toBe("reader");
				});
				const writer = caller.run("owner", () =>
					withTransaction(db, async (tx) => {
						expect(caller.getStore()).toBe("owner");
						expect(getCurrentTransaction()).toBe(tx);
						const [{ pid }] = await tx.execute(
							sql`SELECT pg_backend_pid() AS pid`,
						);
						expect(caller.getStore()).toBe("owner");
						return pid;
					}),
				);
				const emptyWriter = withTransaction(db, async (tx) => {
					expect(caller.getStore()).toBeUndefined();
					expect(getCurrentTransaction()).toBe(tx);
				});
				const [, reconnectedPid] = await Promise.all([
					reader,
					writer,
					emptyWriter,
				]);
				expect(reconnectedPid).not.toBe(originalPid);
				expect(caller.getStore()).toBeUndefined();
			} finally {
				await connection.close();
			}
		}, 15000);

		test("a foreign driver callback preserves nesting, rollback and commit effects", async () => {
			const connection = new SQL(databaseUrl!, { max: 1 });
			const caller = new AsyncLocalStorage<string>();
			const db = bunDrizzle({ client: connection });
			const driver = {
				transaction: (callback: Parameters<typeof db.transaction>[0]) =>
					db.transaction((tx) => caller.run("foreign", () => callback(tx))),
			};
			try {
				await connection`CREATE TEMP TABLE context_proof (value integer)`;
				let committed = 0;
				await caller.run("owner", () =>
					withTransaction(driver, async (tx) => {
						expect(caller.getStore()).toBe("owner");
						expect(getCurrentTransaction()).toBe(tx);
						await tx.execute(sql`INSERT INTO context_proof VALUES (1)`);
						await withTransaction(driver, async (nested) => {
							expect(nested).toBe(tx);
							expect(caller.getStore()).toBe("owner");
							onAfterCommit(() => {
								expect(getCurrentTransaction()).toBeUndefined();
								expect(caller.getStore()).toBe("owner");
								committed++;
							});
						});
					}),
				);
				expect(committed).toBe(1);
				await expect(
					caller.run("owner", () =>
						withTransaction(driver, async (tx) => {
							await tx.execute(sql`INSERT INTO context_proof VALUES (2)`);
							onAfterCommit(() => {
								committed++;
							});
							throw new Error("rollback proof");
						}),
					),
				).rejects.toThrow("rollback proof");
				expect(committed).toBe(1);
				expect(await connection`SELECT value FROM context_proof`).toEqual([
					{ value: 1 },
				]);
				expect(caller.getStore()).toBeUndefined();
			} finally {
				await connection.close();
			}
		});

		test.each(["bun-sql", "node-postgres", "postgres-js"] as const)(
			"%s retains caller context through concurrent cold transactions",
			async (driver) => {
				const bunClient =
					driver === "bun-sql" ? new SQL(databaseUrl!, { max: 1 }) : undefined;
				const pgClient =
					driver === "node-postgres"
						? new pg.Pool({ connectionString: databaseUrl, max: 1 })
						: undefined;
				const postgresClient =
					driver === "postgres-js"
						? postgres(databaseUrl!, { max: 1 })
						: undefined;
				const db = bunClient
					? bunDrizzle({ client: bunClient })
					: pgClient
						? pgDrizzle({ client: pgClient })
						: postgresDrizzle({ client: postgresClient! });
				const caller = new AsyncLocalStorage<string>();
				try {
					await Promise.all(
						["first", "second", "third"].map((owner) =>
							caller.run(owner, () =>
								withTransaction(db, async (tx) => {
									expect(caller.getStore()).toBe(owner);
									expect(getCurrentTransaction()).toBe(tx);
									await tx.execute(sql`SELECT pg_sleep(0.01)`);
									expect(caller.getStore()).toBe(owner);
								}),
							),
						),
					);
				} finally {
					await bunClient?.close();
					await pgClient?.end();
					await postgresClient?.end();
				}
			},
		);

		test.each([undefined, "node-postgres"] as const)(
			"db.url selects driver %s on Bun",
			async (driver) => {
				const app = {
					config: { db: { url: databaseUrl!, driver, pool: { max: 1 } } },
					getSchema: () => ({}),
					_dbCleanup: undefined as undefined | (() => Promise<void>),
				};
				try {
					const db = await dbService.state.create!({ app });
					if (driver) expect(db.$client).toBeInstanceOf(pg.Pool);
					else {
						expect(db.$client).not.toBeInstanceOf(pg.Pool);
						expect(db.$client.begin).toBeTypeOf("function");
					}
					await db.execute(sql`SELECT 1`);
				} finally {
					await app._dbCleanup?.();
				}
			},
		);
		test("Node selects pg automatically and honors the explicit driver", async () => {
			const fixture = fileURLToPath(
				new URL("../fixtures/db-service-node.ts", import.meta.url),
			);
			const directory = await mkdtemp(
				join(dirname(fixture), ".db-service-node-"),
			);
			try {
				const result = await Bun.build({
					entrypoints: [fixture],
					target: "node",
					external: ["drizzle-orm", "pg", "bun", "@electric-sql/pglite"],
				});
				expect(result.success).toBe(true);
				const entrypoint = join(directory, "proof.mjs");
				await Bun.write(entrypoint, result.outputs[0]);
				const child = Bun.spawn(["node", entrypoint], {
					stdout: "pipe",
					stderr: "pipe",
				});
				const [code, error] = await Promise.all([
					child.exited,
					new Response(child.stderr).text(),
				]);
				expect(error).toBe("");
				expect(code).toBe(0);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
	},
);
