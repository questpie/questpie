/**
 * How the collection read path COMPILES a query — the three ways it used to
 * disagree with itself.
 *
 * 1. Range operators bound their value with the noop encoder while `eq` bound
 *    the same value with the column's own encoder, so one predicate could put
 *    two different wire values on the same column in one query.
 * 2. An `orderBy` term that resolved to nothing was dropped in silence, so the
 *    rows came back in an arbitrary order that merely looked sorted.
 * 3. `?page=N` was parsed onto an option nobody read, so it always returned
 *    page 1.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import {
	boolean,
	integer,
	jsonb,
	numeric,
	PgDialect,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildOperatorCondition } from "../../src/server/collection/crud/query-builders/where-builder.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db.js";

// ---------------------------------------------------------------------------
// 1 · Range operators must bind exactly like equality
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const render = (condition: ReturnType<typeof buildOperatorCondition>) =>
	dialect.sqlToQuery(condition as never).params;

/** Columns standing in for the field factories that produce each of them. */
const probe = pgTable("probe", {
	// f.text() / f.email() / f.url() / f.select()
	vc: varchar("vc", { length: 255 }),
	// f.boolean()
	flag: boolean("flag"),
	// f.number()
	count: integer("count"),
	// f.number({ mode: "decimal" }) — the encoder sends text so Postgres keeps
	// `numeric` semantics instead of comparing in float8.
	price: numeric("price", { precision: 20, scale: 0, mode: "number" }),
	// f.datetime() — timestamptz
	startsAt: timestamp("starts_at", {
		precision: 3,
		withTimezone: true,
		mode: "date",
	}),
	// createdAt / updatedAt / deletedAt — timestamp WITHOUT time zone
	updatedAt: timestamp("updated_at", { precision: 3, mode: "date" }),
	// f.json() / f.object()
	meta: jsonb("meta"),
	// .array()
	tags: text("tags").array(),
});

const instant = new Date("2026-08-05T06:00:00.000Z");

const bindingCases: Array<{ label: string; column: unknown; value: unknown }> =
	[
		{ label: "varchar (f.text)", column: probe.vc, value: "abc" },
		{ label: "boolean (f.boolean)", column: probe.flag, value: true },
		{ label: "integer (f.number)", column: probe.count, value: 42 },
		{
			label: "numeric (f.number({mode:'decimal'}))",
			column: probe.price,
			value: 10000000000000000,
		},
		{
			label: "timestamptz (f.datetime)",
			column: probe.startsAt,
			value: instant,
		},
		{
			label: "timestamp without tz (createdAt/updatedAt)",
			column: probe.updatedAt,
			value: instant,
		},
		{ label: "jsonb (f.json)", column: probe.meta, value: { a: 1 } },
		{ label: "text[] (.array())", column: probe.tags, value: ["a", "b"] },
	];

describe("range operators bind like equality", () => {
	for (const { label, column, value } of bindingCases) {
		it(`binds gt/gte/lt/lte/ne the same as eq — ${label}`, () => {
			const expected = render(buildOperatorCondition(column, "eq", value));

			for (const op of ["gt", "gte", "lt", "lte", "ne"]) {
				expect(
					render(buildOperatorCondition(column, op, value)),
					`operator '${op}' on ${label} must bind the value the same way 'eq' does`,
				).toEqual(expected);
			}
		});
	}

	it("keeps the value untouched when the column is a bare SQL expression", () => {
		// A localized COALESCE or a virtual(sql) carries no encoder, so there is
		// nothing to apply and the value must pass through exactly as before.
		const expr = sql`COALESCE(a, b)`;
		expect(render(buildOperatorCondition(expr, "gt", instant))).toEqual([
			instant,
		]);
	});
});

describe("a range boundary does not move with the server timezone", () => {
	/**
	 * `createdAt`/`updatedAt` are `timestamp` WITHOUT time zone. node-postgres
	 * serializes a raw `Date` in LOCAL time with an offset, and Postgres discards
	 * the offset for such a column — so binding a `Date` instead of the column's
	 * own encoding moves the boundary by the process's UTC offset. That is
	 * invisible on a UTC machine, which is why it survived CI.
	 *
	 * Rendering through node-postgres's own `prepareValue` is what the Node
	 * runtime actually puts on the wire (`services/db.ts` picks `pg` off Bun).
	 */
	const script = `
		import { PgDialect, pgTable, timestamp } from "drizzle-orm/pg-core";
		import pgUtils from "pg/lib/utils.js";
		import { buildOperatorCondition } from "./src/server/collection/crud/query-builders/where-builder.ts";

		const t = pgTable("t", {
			updatedAt: timestamp("updated_at", { precision: 3, mode: "date" }),
		});
		const dialect = new PgDialect();
		const instant = new Date("2026-08-05T06:00:00.000Z");
		const wire = (op) =>
			pgUtils.prepareValue(
				dialect.sqlToQuery(buildOperatorCondition(t.updatedAt, op, instant)).params[0],
			);

		console.log(JSON.stringify({ eq: wire("eq"), gt: wire("gt"), lte: wire("lte") }));
	`;

	const timezones = ["UTC", "Europe/Bratislava", "America/Los_Angeles"];
	const packageRoot = new URL("../..", import.meta.url).pathname;

	it("renders the same wire value in every timezone, and the same one eq renders", async () => {
		const rendered: Array<Record<string, string>> = [];

		for (const timezone of timezones) {
			const child = Bun.spawn([process.execPath, "-e", script], {
				cwd: packageRoot,
				env: { ...Bun.env, TZ: timezone },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(exitCode, stderr).toBe(0);
			rendered.push(JSON.parse(stdout));
		}

		// The boundary is the same instant no matter where the server runs.
		for (const [index, timezone] of timezones.entries()) {
			expect(
				rendered[index]?.gt,
				`gt boundary under TZ=${timezone} must not depend on the timezone`,
			).toBe(rendered[0]?.gt);
		}

		// ...and it is the same instant equality would have compared against, so a
		// predicate mixing `eq` and `gt` on one column compares like with like.
		for (const [index, timezone] of timezones.entries()) {
			const row = rendered[index];
			expect(row?.gt, `gt must bind like eq under TZ=${timezone}`).toBe(
				row?.eq,
			);
			expect(row?.lte, `lte must bind like eq under TZ=${timezone}`).toBe(
				row?.eq,
			);
		}

		// The value written to the column is its UTC rendering, so the boundary
		// compared against it must be too.
		expect(rendered[0]?.gt).toBe("2026-08-05T06:00:00.000Z");
	}, 30_000);
});

// ---------------------------------------------------------------------------
// 2 · orderBy must not drop terms it cannot resolve
// ---------------------------------------------------------------------------

const widgets = collection("widgets")
	.fields(({ f }) => ({
		name: f.text().required(),
		priceCents: f.number().required(),
		// Filterable through `where` before this change, but not orderable.
		priceDoubled: f.number().virtual(sql<number>`(widgets."priceCents" * 2)`),
	}))
	.access({ create: true, read: true, update: true });

describe("orderBy refuses terms it cannot resolve", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeAll(async () => {
		setup = await buildMockApp({ collections: { widgets } });
		await runTestDbMigrations(setup.app);
		ctx = createTestContext();

		// Inserted in an order that is NOT the sorted order, so a dropped ORDER BY
		// term shows up as the insertion order rather than accidentally passing.
		for (const [name, priceCents] of [
			["beta", 300],
			["alpha", 100],
			["delta", 400],
			["gamma", 200],
		] as const) {
			await setup.app.collections.widgets.create(
				{ id: crypto.randomUUID(), name, priceCents },
				ctx,
			);
		}
	}, 60_000);

	afterAll(async () => {
		await setup?.cleanup();
	});

	it("throws on an order term that is not a column", async () => {
		await expect(
			setup.app.collections.widgets.find(
				{ orderBy: { pricecents: "asc" } as never },
				ctx,
			),
		).rejects.toThrow(/Cannot order by 'pricecents'/);
	});

	it("still sorts by a real column", async () => {
		const result = await setup.app.collections.widgets.find(
			{ orderBy: { name: "asc" } },
			ctx,
		);
		expect(result.docs.map((d: any) => d.name)).toEqual([
			"alpha",
			"beta",
			"delta",
			"gamma",
		]);
	});

	it("sorts by a virtual(sql) column instead of ignoring it", async () => {
		const result = await setup.app.collections.widgets.find(
			{ orderBy: { priceDoubled: "desc" } as never },
			ctx,
		);
		expect(result.docs.map((d: any) => d.priceCents)).toEqual([
			400, 300, 200, 100,
		]);
	});
});

// ---------------------------------------------------------------------------
// 3 · ?page=N
// ---------------------------------------------------------------------------

const notes = collection("notes")
	.fields(({ f }) => ({ title: f.text().required() }))
	.access({ create: true, read: true, update: true });

describe("?page=N", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let handler: ReturnType<typeof createFetchHandler>;

	beforeAll(async () => {
		setup = await buildMockApp({ collections: { notes } });
		await runTestDbMigrations(setup.app);
		handler = createFetchHandler(setup.app, { accessMode: "system" });

		const ctx = createTestContext();
		for (const title of ["n1", "n2", "n3", "n4", "n5", "n6"]) {
			await setup.app.collections.notes.create(
				{ id: crypto.randomUUID(), title },
				ctx,
			);
		}
	}, 60_000);

	afterAll(async () => {
		await setup?.cleanup();
	});

	const get = (query: string) =>
		handler(new Request(`http://localhost/notes?${query}`));

	it("returns the requested page, not page 1", async () => {
		const paged = await get("page=2&limit=2&orderBy[title]=asc");
		expect(paged.status).toBe(200);
		const body = (await paged.json()) as { docs: any[]; page: number };

		expect(body.docs.map((d) => d.title)).toEqual(["n3", "n4"]);
		expect(body.page).toBe(2);
	});

	it("agrees with the equivalent offset", async () => {
		const byPage = (await (
			await get("page=3&limit=2&orderBy[title]=asc")
		).json()) as { docs: any[] };
		const byOffset = (await (
			await get("offset=4&limit=2&orderBy[title]=asc")
		).json()) as { docs: any[] };

		expect(byPage.docs.map((d) => d.title)).toEqual(["n5", "n6"]);
		expect(byPage.docs.map((d) => d.title)).toEqual(
			byOffset.docs.map((d) => d.title),
		);
	});

	it("refuses a page it cannot honor rather than ignoring it", async () => {
		// No page size to multiply by.
		expect((await get("page=2")).status).toBe(400);
		// Pages are 1-based.
		expect((await get("page=0&limit=2")).status).toBe(400);
		// Two ways of saying where to start.
		expect((await get("page=2&limit=2&offset=0")).status).toBe(400);
	});

	it("leaves plain offset paging alone", async () => {
		const body = (await (
			await get("offset=2&limit=2&orderBy[title]=asc")
		).json()) as { docs: any[]; page: number };
		expect(body.docs.map((d) => d.title)).toEqual(["n3", "n4"]);
		expect(body.page).toBe(2);
	});
});
