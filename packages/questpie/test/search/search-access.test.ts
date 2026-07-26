/**
 * Search Access Control Tests
 *
 * Tests for access filtering via SQL JOINs in the search adapter.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import {
	createPostgresSearchAdapter,
	type PostgresSearchAdapter,
} from "../../src/server/modules/core/integrated/search/adapters/postgres.js";
import type { CollectionAccessFilter } from "../../src/server/modules/core/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

setDefaultTimeout(30000);

const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		content: f.textarea(),
		tenantId: f.text(64),
		category: f.text(64),
		price: f.number(),
	}))
	.title(({ f }) => f.title)
	.searchable({
		content: (record) => record.content || "",
		metadata: (record) => ({
			category: record.category,
			price: record.price,
		}),
		facets: {
			category: true,
			price: {
				type: "range",
				buckets: [
					{ label: "low", max: 50 },
					{ label: "high", min: 50 },
				],
			},
		},
	})
	.options({ timestamps: true, softDelete: true });

describe("Search Access Filtering", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let adapter: PostgresSearchAdapter;

	beforeEach(async () => {
		adapter = createPostgresSearchAdapter();

		setup = await buildMockApp({ collections: { posts } }, { search: adapter });

		await runTestDbMigrations(setup.app);
		await runSearchMigrations(setup.app.db);

		// Index some test data
		await setup.app.search.index({
			collection: "posts",
			recordId: "post-1",
			locale: "en",
			title: "First Post",
			content: "This is the first post",
		});

		await setup.app.search.index({
			collection: "posts",
			recordId: "post-2",
			locale: "en",
			title: "Second Post",
			content: "This is the second post",
		});

		await setup.app.search.index({
			collection: "posts",
			recordId: "post-3",
			locale: "en",
			title: "Third Post",
			content: "This is the third post",
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("without accessFilters", () => {
		it("should return all matching results", async () => {
			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
			});

			expect(response.results.length).toBe(3);
			expect(response.total).toBe(3);
		});

		it("rejects semantic and hybrid modes it does not implement", async () => {
			expect(adapter.capabilities.hybrid).toBe(false);
			expect(adapter.capabilities.semantic).toBe(false);
			await expect(
				setup.app.search.search({
					query: "Post",
					locale: "en",
					mode: "hybrid",
				}),
			).rejects.toThrow('does not support "hybrid"');
			await expect(
				setup.app.search.search({
					query: "Post",
					locale: "en",
					mode: "semantic",
				}),
			).rejects.toThrow('does not support "semantic"');
		});
	});

	describe("with accessWhere: false", () => {
		it("should return no results when collection access is denied", async () => {
			const accessFilters: CollectionAccessFilter[] = [
				{
					collection: "posts",
					table: {} as any, // Table not needed when accessWhere is false
					accessWhere: false,
				},
			];

			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
				accessFilters,
			});

			expect(response.results.length).toBe(0);
			expect(response.total).toBe(0);
		});

		it("should filter browse mode results too", async () => {
			const accessFilters: CollectionAccessFilter[] = [
				{
					collection: "posts",
					table: {} as any,
					accessWhere: false,
				},
			];

			// Empty query = browse mode
			const response = await setup.app.search.search({
				query: "",
				locale: "en",
				accessFilters,
			});

			expect(response.results.length).toBe(0);
			expect(response.total).toBe(0);
		});
	});

	describe("with accessWhere: true", () => {
		it("should return all results when full access is granted", async () => {
			const collections = setup.app.getCollections();
			const crud = collections.posts.generateCRUD(setup.app.db, setup.app);

			const accessFilters: CollectionAccessFilter[] = [
				{
					collection: "posts",
					table: collections.posts.table,
					accessWhere: true,
					state: collections.posts.state,
					i18nTable: crud["~internalI18nTable"],
					context: {
						accessMode: "user",
						locale: "en",
						db: setup.app.db,
					},
					app: setup.app,
					db: setup.app.db,
				},
			];

			// Note: This will only work if records exist in the actual table
			// Since we only indexed (not created via CRUD), the JOIN won't match
			// This is expected behavior - access filtering requires records to exist
			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
				accessFilters,
			});

			// With true access but no records in table, results should be 0
			// (because JOIN can't match non-existent records)
			expect(response.results.length).toBe(0);
		});
	});

	describe("total count accuracy", () => {
		it("should return accurate total after filtering", async () => {
			const accessFilters: CollectionAccessFilter[] = [
				{
					collection: "posts",
					table: {} as any,
					accessWhere: false,
				},
			];

			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
				limit: 1,
				accessFilters,
			});

			// Total should be 0, not the unfiltered count
			expect(response.total).toBe(0);
		});
	});

	describe("canonical authorized candidate universe", () => {
		it("supports in and nested boolean predicates without broadening", async () => {
			const allowed = await createAndIndexPost(setup, {
				title: "Allowed Post",
				tenantId: "tenant-a",
				category: "public",
				price: 20,
			});
			await createAndIndexPost(setup, {
				title: "Also Allowed Post",
				tenantId: "tenant-a",
				category: "internal",
				price: 80,
			});
			await createAndIndexPost(setup, {
				title: "Secret Post",
				tenantId: "tenant-b",
				category: "secret",
				price: 500,
			});

			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
				accessFilters: [
					buildAccessFilter(setup, {
						AND: [
							{ tenantId: { in: ["tenant-a"] } },
							{
								OR: [
									{ category: "public" },
									{ NOT: { id: { in: ["never-block", allowed.id] } } },
								],
							},
						],
					}),
				],
			});

			expect(response.total).toBe(2);
			expect(response.results.map((result) => result.recordId).sort()).toEqual(
				expect.arrayContaining([allowed.id]),
			);
			expect(
				response.results.some((result) => result.title === "Secret Post"),
			).toBe(false);
		});

		it("uses the same candidates for page, total, facets, and statistics", async () => {
			await createAndIndexPost(setup, {
				title: "Public Post",
				tenantId: "tenant-a",
				category: "public",
				price: 20,
			});
			await createAndIndexPost(setup, {
				title: "Internal Post",
				tenantId: "tenant-a",
				category: "internal",
				price: 80,
			});
			await createAndIndexPost(setup, {
				title: "Leaking Post",
				tenantId: "tenant-b",
				category: "secret",
				price: 500,
			});

			const response = await setup.app.search.search({
				query: "Post",
				locale: "en",
				limit: 1,
				facets: [{ field: "category" }, { field: "price" }],
				accessFilters: [
					buildAccessFilter(setup, {
						tenantId: { in: ["tenant-a"] },
					}),
				],
			});

			expect(response.results).toHaveLength(1);
			expect(response.total).toBe(2);
			expect(response.facets?.[0].values).toEqual(
				expect.arrayContaining([
					{ value: "public", count: 1 },
					{ value: "internal", count: 1 },
				]),
			);
			expect(response.facets?.[0].values).not.toContainEqual({
				value: "secret",
				count: 1,
			});
			expect(response.facets?.[1].stats).toEqual({ min: 20, max: 80 });
		});

		it("excludes stale index rows after a source row is soft-deleted", async () => {
			const post = await createAndIndexPost(setup, {
				title: "Deleted Post",
				tenantId: "tenant-a",
				category: "public",
				price: 20,
			});
			await setup.app.collections.posts.deleteById(
				{ id: post.id },
				{ accessMode: "system" },
			);

			const response = await setup.app.search.search({
				query: "Deleted",
				locale: "en",
				accessFilters: [buildAccessFilter(setup, true)],
			});

			expect(response.results).toEqual([]);
			expect(response.total).toBe(0);
		});

		it("rejects an unsupported access operator instead of weakening it", async () => {
			await createAndIndexPost(setup, {
				title: "Protected Post",
				tenantId: "tenant-a",
				category: "public",
				price: 20,
			});

			await expect(
				setup.app.search.search({
					query: "Protected",
					locale: "en",
					accessFilters: [
						buildAccessFilter(setup, {
							tenantId: { unsupportedOperator: "tenant-a" },
						}),
					],
				}),
			).rejects.toThrow("Cannot compile access predicate");

			await expect(
				setup.app.search.search({
					query: "Protected",
					locale: "en",
					accessFilters: [buildAccessFilter(setup, { OR: [] })],
				}),
			).rejects.toThrow("empty or invalid OR branch");
		});
	});
});

function buildAccessFilter(
	setup: Awaited<ReturnType<typeof buildMockApp>>,
	accessWhere: CollectionAccessFilter["accessWhere"],
): CollectionAccessFilter {
	const collectionConfig = setup.app.getCollections().posts;
	const crud = collectionConfig.generateCRUD(setup.app.db, setup.app);
	return {
		collection: "posts",
		table: collectionConfig.table,
		accessWhere,
		softDelete: true,
		state: collectionConfig.state,
		i18nTable: crud["~internalI18nTable"],
		context: {
			accessMode: "user",
			locale: "en",
			defaultLocale: "en",
			db: setup.app.db,
		},
		app: setup.app,
		db: setup.app.db,
	};
}

async function createAndIndexPost(
	setup: Awaited<ReturnType<typeof buildMockApp>>,
	input: {
		title: string;
		tenantId: string;
		category: string;
		price: number;
	},
): Promise<Record<string, any>> {
	const post = await setup.app.collections.posts.create(
		{ ...input, content: input.title },
		{ accessMode: "system" },
	);
	await setup.app.search.index({
		collection: "posts",
		recordId: post.id,
		locale: "en",
		title: input.title,
		content: input.title,
		metadata: {
			category: input.category,
			price: input.price,
		},
		facets: [
			{ name: "category", value: input.category },
			{
				name: "price",
				value: input.price < 50 ? "low" : "high",
				numericValue: input.price,
			},
		],
	});
	return post;
}

async function runSearchMigrations(db: any): Promise<void> {
	const adapter = createPostgresSearchAdapter();
	const migrations = adapter.getMigrations();

	for (const migration of migrations) {
		try {
			await db.execute(sql.raw(migration.up));
		} catch (error: any) {
			if (
				!error.message?.includes("already exists") &&
				!error.message?.includes("does not exist")
			) {
				console.warn(`Migration ${migration.name} warning:`, error.message);
			}
		}
	}
}
