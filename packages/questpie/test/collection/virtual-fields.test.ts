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

const posts = collection("posts")
	.fields(({ f }) => ({
		slug: f.text().required(),
		title: f.text().required().localized(),
		// Reaches into the i18n table. Note the correlated subquery: the author
		// writes it, because the aliased i18n joins the query already builds are
		// NOT offered to virtual SQL. See the note on Collection.getVirtuals.
		titleUpper: f.text().virtual(sql<string>`(
			SELECT UPPER(t.title) FROM posts_i18n t
			WHERE t.parent_id = posts.id LIMIT 1
		)`),
	}))
	.options({ timestamps: true });

describe("SQL virtual fields", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { products, posts } });
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

	it("can read a localized column, via the author's own subquery", async () => {
		const created = await setup.app.collections.posts.create(
			{ slug: "hello", title: "hello" },
			ctx,
		);

		expect((created as Record<string, unknown>).titleUpper).toBe("HELLO");

		const row = await setup.app.collections.posts.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect((row as Record<string, unknown>).titleUpper).toBe("HELLO");

		// This works because the field's SQL correlates to posts_i18n itself.
		// getVirtualsWithAliases receives the query's aliased i18n tables and
		// discards them, so locale selection and fallback are entirely on the
		// author of the expression — the framework contributes nothing here.
	});
});
