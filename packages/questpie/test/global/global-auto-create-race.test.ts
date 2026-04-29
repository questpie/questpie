/**
 * Regression test for the race condition where two concurrent
 * `globals.<name>.get(...)` calls each saw zero rows and each inserted a
 * fresh "auto-created" singleton, leaving the database with two rows for
 * a global that is supposed to have exactly one.
 *
 * The fix takes a Postgres transaction-scoped advisory lock keyed on the
 * table name, then re-checks existence inside the locked transaction
 * before inserting. See `acquireAutoCreateLock` in
 * `packages/questpie/src/server/global/crud/global-crud-generator.ts`.
 */

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const header_settings = global("header_settings").fields(({ f }) => ({
	title: f.text().default("Header"),
}));

const versioned_settings = global("versioned_settings")
	.fields(({ f }) => ({
		title: f.text().default("Versioned"),
	}))
	.options({ versioning: { enabled: true } });

describe("globals auto-create race condition", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: any;

	beforeEach(async () => {
		setup = await buildMockApp({
			globals: { header_settings, versioned_settings },
		});
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("produces exactly one row under N concurrent get() calls (plain branch)", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const results = await Promise.all(
			Array.from({ length: 20 }, () => app.globals.header_settings.get({}, ctx)),
		);

		// All callers see the auto-created row
		expect(results.every((r) => r != null)).toBe(true);

		const countResult = await app.db.execute(
			sql`SELECT COUNT(*)::int AS c FROM header_settings`,
		);
		const row = (countResult.rows ?? countResult)[0];
		expect(row.c).toBe(1);
	});

	it("produces exactly one row under N concurrent get() calls (versioned branch)", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				app.globals.versioned_settings.get({}, ctx),
			),
		);

		expect(results.every((r) => r != null)).toBe(true);

		const countResult = await app.db.execute(
			sql`SELECT COUNT(*)::int AS c FROM versioned_settings`,
		);
		const row = (countResult.rows ?? countResult)[0];
		expect(row.c).toBe(1);

		// And exactly one initial version
		const versionsResult = await app.db.execute(
			sql`SELECT COUNT(*)::int AS c FROM versioned_settings_versions`,
		);
		const versionsRow = (versionsResult.rows ?? versionsResult)[0];
		expect(versionsRow.c).toBe(1);
	});
});
