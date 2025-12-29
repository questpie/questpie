import {
	text,
	integer,
	varchar,
	jsonb,
	index,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { defineCollection } from "#questpie/cms/server/collection/builder/collection-builder.js";

export const categories = defineCollection("categories")
	.fields({
		name: text("name").notNull(),
		description: text("description"),
	})
	.relations(({ table, many }) => ({
		products: many("products", {
			relationName: "products",
		}),
	}))
	.options({
		timestamps: true,
	})
	.build();

export const products = defineCollection("products")
	.fields({
		// ✅ Use Drizzle columns directly - full type inference
		sku: varchar("sku", { length: 50 }).notNull(),
		name: text("name").notNull(),
		description: text("description"),
		price: integer("price").notNull(),
		stock: integer("stock").notNull().default(0),
		status: varchar("status", { length: 255 }).notNull().default("draft"),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => categories.table.id),
		tags: jsonb("tags").$type<string[]>().default([]),
	})
	// ✅ Mark localized fields
	.localized(["name", "description"] as const)
	.relations(({ table, one }) => ({
		// ✅ Relations with typed table
		category: one(categories.name, {
			fields: [table.categoryId],
			references: ["id"],
		}),
	}))
	// ✅ Virtual fields with typed table + i18n parameters
	.virtuals(({ table, i18n }) => ({
		// table has non-localized fields (sku, price, stock, status, categoryId, tags)
		// i18n has localized fields (name, description) as SQL expressions
		priceWithVat: sql<number>`${table.price} * 1.2`,
		inStock: sql<boolean>`${table.stock} > 0`,
		// Can use i18n for localized fields
		displayName: sql<string>`${i18n.name}`,
	}))
	// ✅ Indexes with typed table
	.indexes(({ table }) => [
		unique().on(table.sku),
		index().on(table.status),
		index().on(table.categoryId, table.status),
	])
	// ✅ Title with access to both table and i18n
	.title(({ table, i18n }) => sql`${i18n.name} || ' - ' || ${table.sku}`)
	// ✅ Options
	.options({
		timestamps: true,
		softDelete: true,
	})
	// ✅ Build and return fully typed collection
	.build();

// ✨ Test type inference!
type Product = typeof products.$infer.select;
/*
Should include:
- id: string (UUID)
- sku: string
- price: number
- stock: number
- status: string
- categoryId: number
- tags: string[]
- priceWithVat: number (virtual)
- inStock: boolean (virtual)
- displayName: string (virtual)
- _title: string (generated)
- createdAt: Date
- updatedAt: Date
- deletedAt: Date | null
*/

type CreateProduct = typeof products.$infer.insert;
/*
Should include main table fields + optional localized fields:
- sku, price, stock, status, categoryId, tags
- name?: string (localized, optional)
- description?: string (localized, optional)
*/

type UpdateProduct = typeof products.$infer.update;
/*
Should include partial main table fields + optional localized fields
*/

// Test table access
const _testPrice = products.table.price; // Should be PgInteger
const _testSku = products.table.sku; // Should be PgVarchar

// Test metadata
const meta = products.getMeta();
console.log("Collection metadata:", meta);

export type { Product, CreateProduct, UpdateProduct };
