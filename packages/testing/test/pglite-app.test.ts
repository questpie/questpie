import { describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import { createApp } from "questpie/app";
import { migration } from "questpie/migration";
import type { AppDefinition, RuntimeConfig } from "questpie/types";

import { createTestApp, TestAppSetupError } from "../src/index.js";

const schemaMigration = migration({
	id: "testing_001_schema",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE test_items (value text NOT NULL)`);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE test_items`);
	},
});

const appDefinition = {
	modules: [],
	migrations: [schemaMigration],
} satisfies AppDefinition;

const createAppForRuntime = (runtime: RuntimeConfig) =>
	createApp(appDefinition, runtime);

describe("createTestApp PGlite lifecycle", () => {
	it("creates and migrates a fresh isolated database per harness", async () => {
		const first = await createTestApp({ createApp: createAppForRuntime });
		const second = await createTestApp({ createApp: createAppForRuntime });

		try {
			await first.app.db.execute(
				sql`INSERT INTO test_items (value) VALUES ('first')`,
			);
			await second.app.db.execute(
				sql`INSERT INTO test_items (value) VALUES ('second')`,
			);

			const firstRows = await first.app.db.execute(
				sql`SELECT value FROM test_items`,
			);
			const secondRows = await second.app.db.execute(
				sql`SELECT value FROM test_items`,
			);

			expect(firstRows.rows).toEqual([{ value: "first" }]);
			expect(secondRows.rows).toEqual([{ value: "second" }]);
		} finally {
			await Promise.all([first.dispose(), second.dispose()]);
		}
	});

	it("keeps caller-owned PGlite open unless ownership is transferred", async () => {
		const callerOwned = await PGlite.create({ extensions: { pg_trgm } });
		const transferred = await PGlite.create({ extensions: { pg_trgm } });
		const first = await createTestApp({
			createApp: createAppForRuntime,
			database: { kind: "pglite", client: callerOwned },
		});
		const second = await createTestApp({
			createApp: createAppForRuntime,
			database: {
				kind: "pglite",
				client: transferred,
				ownership: "harness",
			},
		});

		await first.dispose();
		await second.dispose();

		expect(callerOwned.closed).toBe(false);
		expect(transferred.closed).toBe(true);
		await callerOwned.close();
	});

	it("makes concurrent repeated disposal idempotent", async () => {
		const database = await PGlite.create({ extensions: { pg_trgm } });
		const testApp = await createTestApp({
			createApp: createAppForRuntime,
			database: {
				kind: "pglite",
				client: database,
				ownership: "harness",
			},
		});

		await Promise.all([
			testApp.dispose(),
			testApp.dispose(),
			testApp.dispose(),
		]);

		expect(database.closed).toBe(true);
	});

	it("loads declared PGlite modules before extension migrations", async () => {
		const extensionMigration = migration({
			id: "testing_001_extension",
			async up({ db }) {
				await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
			},
			async down() {},
		});
		const extensionFactory = (runtime: RuntimeConfig) =>
			createApp({ modules: [], migrations: [extensionMigration] }, runtime);
		const testApp = await createTestApp({
			createApp: extensionFactory,
			database: {
				kind: "pglite",
				extensions: { pg_trgm },
			},
		});

		try {
			const result = await testApp.app.db.execute(
				sql`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
			);
			expect(result.rows).toEqual([{ extname: "pg_trgm" }]);
		} finally {
			await testApp.dispose();
		}
	});

	it("wraps setup phase failures while retaining the original cause", async () => {
		const cause = new Error("factory exploded");
		const failingFactory = async (_runtime: RuntimeConfig) => {
			throw cause;
		};

		try {
			await createTestApp({ createApp: failingFactory });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(TestAppSetupError);
			expect((error as TestAppSetupError).phase).toBe("app");
			expect((error as TestAppSetupError).cause).toBe(cause);
		}
	});

	it("bounds readiness and cleans up an app that never becomes ready", async () => {
		let destroyed = false;
		const stalledFactory = async (_runtime: RuntimeConfig) => ({
			migrations: { async up() {} },
			waitForInit: () => new Promise<void>(() => {}),
			async destroy() {
				destroyed = true;
			},
		});

		try {
			await createTestApp({ createApp: stalledFactory, timeoutMs: 10 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(TestAppSetupError);
			expect((error as TestAppSetupError).phase).toBe("readiness");
			expect((error as TestAppSetupError).cause).toBeInstanceOf(Error);
			expect(destroyed).toBe(true);
		}
	});
});
