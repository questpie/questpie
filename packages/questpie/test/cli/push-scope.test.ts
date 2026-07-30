import { describe, expect, it } from "bun:test";

import { pgSchema, pgTable, text } from "drizzle-orm/pg-core";

import {
	assertPushStatementsSafe,
	computePushEntities,
} from "../../src/cli/commands/push-scope.js";

/**
 * Regression tests for the push diff-scope incident: `questpie push`
 * planned and executed DROP TABLE questpie_migrations + pgboss state
 * because framework-internal objects entered the diff scope.
 */

describe("computePushEntities", () => {
	it("scopes to public + schemas used by app tables and excludes the ledger", () => {
		const web = pgSchema("web");
		const schema = {
			posts: pgTable("posts", { id: text("id") }),
			pages: web.table("pages", { id: text("id") }),
			somethingElse: { not: "a table" },
		};
		const entities = computePushEntities(schema);
		expect(entities.schemas.sort()).toEqual(["public", "web"]);
		expect(entities.tables).toContain("*");
		expect(entities.tables).toContain("!questpie_migrations");
	});
});

describe("assertPushStatementsSafe", () => {
	const appSchemas = ["public", "web"];

	it("passes ordinary app DDL through", () => {
		const stmts = [
			'CREATE TABLE "posts" ("id" text PRIMARY KEY)',
			'ALTER TABLE "pages" ADD COLUMN "title" text',
			'DROP TABLE "old_app_table"',
		];
		expect(assertPushStatementsSafe(stmts, appSchemas)).toEqual(stmts);
	});

	it("refuses to drop the migration ledger", () => {
		expect(() =>
			assertPushStatementsSafe(
				['DROP TABLE "questpie_migrations"'],
				appSchemas,
			),
		).toThrow(/framework or foreign database state/);
	});

	it("refuses to touch pgboss-owned state", () => {
		expect(() =>
			assertPushStatementsSafe(
				[
					'DROP TABLE "pgboss"."job"',
					"ALTER TABLE pgboss.schedule DROP COLUMN x",
				],
				appSchemas,
			),
		).toThrow(/pgboss/i);
	});

	it("refuses DROP SCHEMA outside the app's schemas", () => {
		expect(() =>
			assertPushStatementsSafe(["DROP SCHEMA pgboss"], appSchemas),
		).toThrow();
		expect(() =>
			assertPushStatementsSafe(
				['DROP SCHEMA IF EXISTS "analytics"'],
				appSchemas,
			),
		).toThrow();
		// app-owned schema drop is allowed (renames during dev)
		expect(assertPushStatementsSafe(['DROP SCHEMA "web"'], appSchemas)).toEqual(
			['DROP SCHEMA "web"'],
		);
	});
});
