import { afterAll, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * End-to-end coverage for the typed field extension hatches:
 * .$type<T>() and schema-replacing .zod() round-trip through real CRUD,
 * and field-level schemas are enforced server-side — collection insert/
 * update schemas overlay each field's toZodSchema() (incl. .zod()
 * transforms) on top of the column-derived base.
 */

type Layout = { rows: { id: string; span: number }[] };

const widgets = collection("widgets").fields(({ f }) => ({
	name: f.text(255).required(),
	layout: f.json().$type<Layout>(),
	settings: f
		.json()
		.zod(() => z.object({ theme: z.enum(["light", "dark"]) }))
		.required(),
	// .drizzle() reaches the real column builder — generated default proves it
	source: f.text(50).drizzle((col) => col.$defaultFn(() => "from-drizzle")),
	// .drizzle() column constraints land in the DDL — unique proves it
	slug: f.text(255).drizzle((col) => col.unique()),
}));

describe("field extension through CRUD", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterAll(async () => {
		await setup?.cleanup();
	});

	it("typed json fields round-trip through create()", async () => {
		setup = await buildMockApp({ collections: { widgets } });
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();

		const w1 = await setup.app.collections.widgets.create(
			{
				name: "w1",
				layout: { rows: [{ id: "r1", span: 2 }] },
				settings: { theme: "dark" },
			},
			ctx,
		);
		expect(w1.layout.rows[0].span).toBe(2);
		expect(w1.settings.theme).toBe("dark");
		// .drizzle() transform reached the real column: generated default applied
		expect(w1.source).toBe("from-drizzle");

		// Nullability preserved: the .zod() transform runs BEFORE nullish
		// wrapping, so the non-required layout field still accepts null
		const w2 = await setup.app.collections.widgets.create(
			{ name: "w2", layout: null, settings: { theme: "light" } },
			ctx,
		);
		expect(w2.layout).toBeNull();
	});

	it(".drizzle() column constraints reach the database DDL", async () => {
		const ctx = createTestContext();

		await setup.app.collections.widgets.create(
			{ name: "u1", slug: "same-slug", settings: { theme: "dark" } },
			ctx,
		);

		// second insert with the same slug violates the .unique() constraint
		// added purely via the .drizzle() escape hatch
		await expect(
			setup.app.collections.widgets.create(
				{ name: "u2", slug: "same-slug", settings: { theme: "dark" } },
				ctx,
			),
		).rejects.toThrow();
	});

	it("server-side create enforces the replaced field schema", async () => {
		const ctx = createTestContext();

		// invalid enum value → rejected by the .zod() schema through create()
		await expect(
			setup.app.collections.widgets.create(
				{ name: "w-bad", settings: { theme: "blue" } },
				ctx,
			),
		).rejects.toThrow();
	});

	it("server-side update enforces the replaced field schema", async () => {
		const ctx = createTestContext();
		const w = await setup.app.collections.widgets.create(
			{ name: "w-upd", settings: { theme: "light" } },
			ctx,
		);

		await expect(
			setup.app.collections.widgets.update(
				{ where: { id: w.id }, data: { settings: { theme: "blue" } } },
				ctx,
			),
		).rejects.toThrow();

		const updated = await setup.app.collections.widgets.update(
			{ where: { id: w.id }, data: { settings: { theme: "dark" } } },
			ctx,
		);
		expect(
			(updated as any)[0]?.settings?.theme ?? (updated as any).settings?.theme,
		).toBe("dark");
	});

	it("replaced field schema validates (admin/OpenAPI surface)", () => {
		const settingsField = (widgets as any).state.fieldDefinitions.settings;
		const schema = settingsField.toZodSchema();

		expect(schema.safeParse({ theme: "dark" }).success).toBe(true);
		expect(schema.safeParse({ theme: "blue" }).success).toBe(false);
	});
});
