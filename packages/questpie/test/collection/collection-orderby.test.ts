/**
 * Multi-field ORDER BY regression tests
 *
 * Drizzle's `.orderBy(...)` REPLACES previous clauses instead of appending,
 * so multi-field ordering must be applied as ONE variadic call. These tests
 * pin the full result order (not just relative positions) so a regression to
 * "only the last clause applies" fails deterministically.
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

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const products = collection("products").fields(({ f }) => ({
	category: f.text(50).required(),
	name: f.text(255).required(),
}));

const stores = collection("stores").fields(({ f }) => ({
	name: f.text(255).required(),
	items: f
		.relation("items")
		.hasMany({ foreignKey: "store", relationName: "store" }),
}));

const items = collection("items").fields(({ f }) => ({
	store: f.relation("stores").required().relationName("store"),
	rank: f.number().required(),
	label: f.text(255).required(),
}));

describe("multi-field orderBy", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { products, stores, items } });
		await runTestDbMigrations(setup.app);

		const ctx = createTestContext();

		// Names chosen so secondary-only ordering (the bug) produces a
		// deterministically different sequence than primary+secondary:
		// alpha < beta < delta < gamma
		const rows = [
			{ category: "a", name: "alpha" },
			{ category: "a", name: "gamma" },
			{ category: "b", name: "beta" },
			{ category: "b", name: "delta" },
		];
		for (const row of rows) {
			await setup.app.collections.products.create(
				{ id: crypto.randomUUID(), ...row },
				ctx,
			);
		}
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	const expectedOrder = [
		["a", "gamma"],
		["a", "alpha"],
		["b", "delta"],
		["b", "beta"],
	];

	it("applies ALL clauses of array syntax, primary first", async () => {
		const ctx = createTestContext();

		const result = await setup.app.collections.products.find(
			{ orderBy: [{ category: "asc" }, { name: "desc" }] },
			ctx,
		);

		expect(result.docs.map((d: any) => [d.category, d.name])).toEqual(
			expectedOrder,
		);
	});

	it("applies ALL clauses of object syntax, key order = priority", async () => {
		const ctx = createTestContext();

		const result = await setup.app.collections.products.find(
			{ orderBy: { category: "asc", name: "desc" } },
			ctx,
		);

		expect(result.docs.map((d: any) => [d.category, d.name])).toEqual(
			expectedOrder,
		);
	});

	it("reconstructs the exact total order when paging over a tied primary field", async () => {
		const ctx = createTestContext();

		const pages: any[] = [];
		for (let offset = 0; offset < 4; offset += 2) {
			const page = await setup.app.collections.products.find(
				{
					orderBy: [{ category: "asc" }, { name: "desc" }],
					limit: 2,
					offset,
				},
				ctx,
			);
			pages.push(...page.docs);
		}

		expect(pages.map((d: any) => [d.category, d.name])).toEqual(expectedOrder);
		// No duplicates / skips across pages
		expect(new Set(pages.map((d: any) => d.id)).size).toBe(4);
	});

	it("applies multi-field orderBy inside relation `with` options", async () => {
		const ctx = createTestContext();

		const store = await setup.app.collections.stores.create(
			{ id: crypto.randomUUID(), name: "main" },
			ctx,
		);

		// rank ties; labels make secondary-only ordering distinguishable
		const itemRows = [
			{ rank: 1, label: "alpha" },
			{ rank: 1, label: "gamma" },
			{ rank: 2, label: "beta" },
			{ rank: 2, label: "delta" },
		];
		for (const row of itemRows) {
			await setup.app.collections.items.create(
				{ id: crypto.randomUUID(), store: store.id, ...row },
				ctx,
			);
		}

		const result = await setup.app.collections.stores.findOne(
			{
				where: { id: store.id },
				with: { items: { orderBy: [{ rank: "asc" }, { label: "desc" }] } },
			},
			ctx,
		);

		expect((result as any).items.map((i: any) => [i.rank, i.label])).toEqual([
			[1, "gamma"],
			[1, "alpha"],
			[2, "delta"],
			[2, "beta"],
		]);
	});
});
