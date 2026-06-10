/**
 * `questpie push` driver-result contract
 *
 * drizzle-kit's `pushSchema` assumes node-postgres result shape
 * (`execute().rows`), but drizzle returns driver-native results — bun-sql
 * (the default driver for `db: { url }`) returns a bare rows array, so
 * `res.rows` is `undefined` and introspection crashes (`namespaces.reduce`).
 *
 * `toKitDb` normalizes any questpie db to `{ rows }` at the
 * questpie ↔ drizzle-kit seam. These tests drive the real `pushSchema`
 * against PGlite through that seam, in both driver shapes.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";

setDefaultTimeout(30_000);

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { rowsOf, toKitDb } from "../../src/server/db/driver-result.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const articles = collection("articles")
	.fields(({ f }) => ({ title: f.text(255).required() }))
	.options({ timestamps: true });

describe("pushSchema through toKitDb", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { articles } });
		// The schema includes the search table's trigram index; in the real
		// flow the search adapter creates the extension at app init.
		await setup.app.db.execute(
			sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"),
		);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("pushes against a { rows }-shaped driver (PGlite passthrough) and is idempotent", async () => {
		const { pushSchema } = await import("drizzle-kit/api-postgres");
		const schema = setup.app.getSchema();

		// PGlite drizzle returns { rows } — proves toKitDb does not double-wrap
		const first = await pushSchema(schema, toKitDb(setup.app.db) as any);
		expect(first.sqlStatements.length).toBeGreaterThan(0);
		await first.apply();

		const second = await pushSchema(schema, toKitDb(setup.app.db) as any);
		expect(second.sqlStatements).toEqual([]);
	});

	it("pushes against a bare-array-shaped driver (bun-sql shape)", async () => {
		const { pushSchema } = await import("drizzle-kit/api-postgres");
		const schema = setup.app.getSchema();

		// Simulate bun-sql: execute() resolves to the rows array directly,
		// backed by real PGlite query results.
		const bunShapedDb = {
			execute: async (q: unknown) =>
				rowsOf(await (setup.app.db as any).execute(q)),
		};

		// Without toKitDb this crashes in introspection (`namespaces.reduce`)
		const first = await pushSchema(schema, toKitDb(bunShapedDb) as any);
		expect(first.sqlStatements.length).toBeGreaterThan(0);
		await first.apply();

		const second = await pushSchema(schema, toKitDb(bunShapedDb) as any);
		expect(second.sqlStatements).toEqual([]);
	});
});
