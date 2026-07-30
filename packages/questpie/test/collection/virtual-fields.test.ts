/**
 * SQL virtual fields, end to end.
 *
 * `f.<type>().virtual(sql\`…\`)` is documented in the skill and used by the
 * barbershop example's `displayTitle`, but until this file nothing ran a query
 * against a collection carrying one and checked the value came back. The
 * type-level tests (test/fields/tstate-*.test.ts) only assert inference, and
 * every other `.virtual()` in the repo is the no-argument marker form, which
 * `collection-builder.ts:275` deliberately skips.
 *
 * That absence is how four getters with byte-identical bodies survived on
 * `Collection` — getVirtuals, getVirtualsWithAliases, getVirtualsForVersions
 * and getVirtualsForVersionsWithAliases all just return `state.virtuals`,
 * ignoring every parameter including the aliased i18n tables the last two are
 * named for. These tests pin what the feature actually does today so that
 * question can be settled against behaviour rather than by reading names.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const products = collection("products")
	.fields(({ f }) => ({
		name: f.text().required(),
		priceCents: f.number().required(),
		// Computed from another column of the same row.
		priceDoubled: f.number().virtual(sql<number>`(products."priceCents" * 2)`),
	}))
	.options({ timestamps: true });

describe("SQL virtual fields", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { products } });
		await runTestDbMigrations(setup.app);
		ctx = createTestContext();
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("comes back computed from create, not just from reads", async () => {
		const created = await setup.app.collections.products.create(
			{ name: "Widget", priceCents: 100 },
			ctx,
		);

		expect(created.name).toBe("Widget");
		expect(created.priceCents).toBe(100);
		// The write path refetches, so the create response carries the computed
		// value rather than omitting the key.
		expect((created as Record<string, unknown>).priceDoubled).toBe(200);
	});

	it("computes on read through findOne", async () => {
		const created = await setup.app.collections.products.create(
			{ name: "Widget", priceCents: 100 },
			ctx,
		);

		const row = await setup.app.collections.products.findOne(
			{ where: { id: created.id } },
			ctx,
		);

		expect(row).not.toBeNull();
		expect((row as Record<string, unknown>).priceDoubled).toBe(200);
	});

	it("computes on read through find, per row", async () => {
		await setup.app.collections.products.create(
			{ name: "Cheap", priceCents: 50 },
			ctx,
		);
		await setup.app.collections.products.create(
			{ name: "Dear", priceCents: 900 },
			ctx,
		);

		const result = await setup.app.collections.products.find(
			{ sort: { priceCents: "asc" } },
			ctx,
		);

		const doubled = result.docs.map(
			(d) => (d as Record<string, unknown>).priceDoubled,
		);
		expect(doubled).toEqual([100, 1800]);
	});
});
