/**
 * System timestamp precision contract
 *
 * System timestamp columns (`created_at`, `updated_at`, `deleted_at`,
 * `version_created_at`) are `timestamp(3)` — millisecond precision — so a
 * `Date` read through the API equals the stored value exactly. Without the
 * precision cap, Postgres stores microseconds a JS `Date` cannot represent,
 * and round-tripped values (keyset cursors, `eq` comparisons) silently miss.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";

setDefaultTimeout(15_000);

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const events = collection("events")
	.fields(({ f }) => ({ title: f.text(255).required() }))
	.options({ timestamps: true, softDelete: true });

describe("system timestamp precision (timestamp(3) contract)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { events } });
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("emits timestamp(3) DDL for system timestamp columns", async () => {
		const { generateDrizzleJson, generateMigration } =
			await import("drizzle-kit/api-postgres");

		const emptySnapshot = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		const snapshot = await generateDrizzleJson(
			setup.app.getSchema(),
			emptySnapshot.id,
		);
		const upSql = (await generateMigration(emptySnapshot, snapshot)).join("\n");

		expect(upSql).toMatch(/"created_at" timestamp\s?\(3\)/);
		expect(upSql).toMatch(/"updated_at" timestamp\s?\(3\)/);
		expect(upSql).toMatch(/"deleted_at" timestamp\s?\(3\)/);
	});

	it("round-trips createdAt exactly: a returned Date matches via eq", async () => {
		const ctx = createTestContext();

		const doc = await setup.app.collections.events.create(
			{ id: crypto.randomUUID(), title: "round-trip" },
			ctx,
		);

		const found = await setup.app.collections.events.findOne(
			{ where: { createdAt: { eq: doc.createdAt } } },
			ctx,
		);

		expect(found?.id).toBe(doc.id);
	});

	it("rounds sub-ms values at insert so reads equal storage", async () => {
		const ctx = createTestContext();

		// Raw insert with explicit microseconds — timestamp(3) rounds at write,
		// so the value a JS Date reads back IS the stored value.
		await setup.app.db.execute(
			sql.raw(
				`INSERT INTO "events" ("id", "title", "created_at", "updated_at")
				 VALUES ('us-row', 'us', '2024-01-01 12:00:00.123456', '2024-01-01 12:00:00.123456')`,
			),
		);

		const doc = await setup.app.collections.events.findOne(
			{ where: { id: "us-row" } },
			ctx,
		);
		expect(doc).not.toBeNull();

		const again = await setup.app.collections.events.findOne(
			{ where: { createdAt: { eq: doc!.createdAt } } },
			ctx,
		);
		expect(again?.id).toBe("us-row");
	});

	it("keyset-paginates exactly across rows inside the same millisecond", async () => {
		const ctx = createTestContext();

		// Three rows that differ only in microseconds (all round to .123) plus
		// one row in a later millisecond. Before timestamp(3), the stored µs
		// made the ms-truncated cursor skip the .123 group entirely.
		await setup.app.db.execute(
			sql.raw(
				`INSERT INTO "events" ("id", "title", "created_at", "updated_at") VALUES
				 ('a', 'a', '2024-01-01 12:00:00.123100', '2024-01-01 12:00:00.123100'),
				 ('b', 'b', '2024-01-01 12:00:00.123200', '2024-01-01 12:00:00.123200'),
				 ('c', 'c', '2024-01-01 12:00:00.123300', '2024-01-01 12:00:00.123300'),
				 ('d', 'd', '2024-01-01 12:00:00.200100', '2024-01-01 12:00:00.200100')`,
			),
		);

		const seen: string[] = [];
		let cursor: { createdAt: Date; id: string } | null = null;

		for (let i = 0; i < 10; i++) {
			const page = await setup.app.collections.events.find(
				{
					where: cursor
						? {
								OR: [
									{ createdAt: { lt: cursor.createdAt } },
									{
										AND: [
											{ createdAt: { eq: cursor.createdAt } },
											{ id: { lt: cursor.id } },
										],
									},
								],
							}
						: undefined,
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					limit: 1,
				},
				ctx,
			);

			if (page.docs.length === 0) break;
			const doc = page.docs[0] as { id: string; createdAt: Date };
			seen.push(doc.id);
			cursor = { createdAt: doc.createdAt, id: doc.id };
		}

		// Later ms first, then the tied-.123 group by id desc — no skips, no dups
		expect(seen).toEqual(["d", "c", "b", "a"]);
	});
});
