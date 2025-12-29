import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { sql } from "drizzle-orm";
import { text, varchar } from "drizzle-orm/pg-core";
import {
	closeTestDb,
	createTestDb,
	runTestDbMigrations,
} from "../utils/test-db";
import { createTestCms } from "../utils/test-cms";
import { createTestContext } from "../utils/test-context";
import { defineCollection } from "#questpie/cms/server/index.js";

const products = defineCollection("products")
	.fields({
		sku: varchar("sku", { length: 50 }).notNull(),
		name: text("name").notNull(),
		description: text("description"),
	})
	.localized(["name", "description"] as const)
	.title(({ table, i18n }) => sql`${i18n.name} || ' - ' || ${table.sku}`)
	.options({
		timestamps: true,
		softDelete: true,
		versioning: true,
	})
	.build();

const lockedProducts = defineCollection("locked_products")
	.fields({
		sku: varchar("sku", { length: 50 }).notNull(),
		name: text("name").notNull(),
	})
	.localized(["name"] as const)
	.title(({ table, i18n }) => sql`${i18n.name} || ' - ' || ${table.sku}`)
	.options({
		timestamps: true,
		softDelete: true,
		versioning: true,
	})
	.access({
		create: () => false,
	})
	.build();

// const ddl = [
// 	testUuidFunctionSql,
// 	`CREATE TABLE products (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		sku varchar(50) NOT NULL,
// 		_title text,
// 		created_at timestamp NOT NULL DEFAULT now(),
// 		updated_at timestamp NOT NULL DEFAULT now(),
// 		deleted_at timestamp
// 	)`,
// 	`CREATE TABLE products_i18n (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		parent_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
// 		locale text NOT NULL,
// 		_title text,
// 		name text,
// 		description text,
// 		UNIQUE(parent_id, locale)
// 	)`,
// 	`CREATE TABLE products_versions (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		parent_id uuid NOT NULL,
// 		version integer NOT NULL,
// 		operation text NOT NULL,
// 		data jsonb NOT NULL,
// 		user_id text,
// 		created_at timestamp NOT NULL DEFAULT now()
// 	)`,
// 	`CREATE TABLE locked_products (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		sku varchar(50) NOT NULL,
// 		_title text,
// 		created_at timestamp NOT NULL DEFAULT now(),
// 		updated_at timestamp NOT NULL DEFAULT now(),
// 		deleted_at timestamp
// 	)`,
// 	`CREATE TABLE locked_products_i18n (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		parent_id uuid NOT NULL REFERENCES locked_products(id) ON DELETE CASCADE,
// 		locale text NOT NULL,
// 		_title text,
// 		name text,
// 		UNIQUE(parent_id, locale)
// 	)`,
// 	`CREATE TABLE locked_products_versions (
// 		id uuid PRIMARY KEY DEFAULT test_uuid(),
// 		parent_id uuid NOT NULL,
// 		version integer NOT NULL,
// 		operation text NOT NULL,
// 		data jsonb NOT NULL,
// 		user_id text,
// 		created_at timestamp NOT NULL DEFAULT now()
// 	)`,
// ];

describe("collection CRUD", () => {
	let db: any;
	let client: any;
	let cms: ReturnType<typeof createTestCms>;

	beforeEach(async () => {
		const setup = await createTestDb();
		db = setup.db;
		client = setup.client;
		cms = createTestCms([products, lockedProducts], db);
		await runTestDbMigrations(cms);
	});

	afterEach(async () => {
		await closeTestDb(client);
	});

	it("creates, updates localized fields, and falls back to default locale", async () => {
		const ctx = createTestContext();
		// Use cms.api.collections.products directly

		const created = await cms.api.collections.products.create(
			{
				id: crypto.randomUUID(),
				sku: "sku-1",
				name: "Name EN",
				description: "Desc EN",
			},
			ctx,
		);

		await cms.api.collections.products.updateById(
			{
				id: created.id,
				data: { name: "Nazov SK" },
			},
			createTestContext({ locale: "sk" }),
		);

		const skRow = await cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			createTestContext({ locale: "sk" }),
		);
		expect(skRow?.name).toBe("Nazov SK");

		const deRow = await cms.api.collections.products.findOne(
			{ where: { id: created.id } },
			createTestContext({ locale: "de" }),
		);
		expect(deRow?.name).toBe("Name EN");
	});

	it("soft delete hides rows from findMany", async () => {
		const ctx = createTestContext();
		// Use cms.api.collections.products directly

		const created = await cms.api.collections.products.create(
			{
				id: crypto.randomUUID(),
				sku: "sku-2",
				name: "Name EN",
			},
			ctx,
		);

		await cms.api.collections.products.deleteById({ id: created.id }, ctx);

		const rows = await cms.api.collections.products.find({}, ctx);
		expect(rows.docs.length).toBe(0);
		expect(rows.totalDocs).toBe(0);
	});

	it("system access mode bypasses access rules", async () => {
		const _ctx = createTestContext();
		// Use cms.api.collections.locked_products directly

		await expect(
			cms.api.collections.locked_products.create(
				{
					id: crypto.randomUUID(),
					sku: "sku-3",
					name: "Locked",
				},
				createTestContext({ accessMode: "user" }),
			),
		).rejects.toThrow("Access denied: create");

		const created = await cms.api.collections.locked_products.create(
			{
				id: crypto.randomUUID(),
				sku: "sku-4",
				name: "System",
			},
			createTestContext({ accessMode: "system" }),
		);
		expect(created.sku).toBe("sku-4");
	});

	it("records versions on create, update, and delete", async () => {
		const ctx = createTestContext();
		// Use cms.api.collections.products directly

		const created = await cms.api.collections.products.create(
			{
				id: crypto.randomUUID(),
				sku: "sku-5",
				name: "Name EN",
			},
			ctx,
		);

		await cms.api.collections.products.updateById(
			{
				id: created.id,
				data: { sku: "sku-5b" },
			},
			ctx,
		);

		await cms.api.collections.products.deleteById({ id: created.id }, ctx);

		const versions = await cms.api.collections.products.findVersions(
			{ id: created.id },
			ctx,
		);
		expect(versions.length).toBe(3);
	});
});
