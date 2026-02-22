/**
 * Tests for Drizzle to Zod transformer
 */

import { describe, expect, test } from "bun:test";
import {
	bigint,
	boolean,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	real,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import type z from "zod";
import {
	createInsertSchema,
	createUpdateSchema,
	drizzleColumnsToZod,
	drizzleColumnToZod,
} from "../../src/server/utils/drizzle-to-zod.js";

describe("drizzle-to-zod", () => {
	describe("drizzleColumnToZod", () => {
		test("varchar with notNull", () => {
			const column = varchar("name", { length: 255 }).notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("John Doe")).toBe("John Doe");
			expect(() => schema.parse(null)).toThrow();
			expect(() => schema.parse(undefined)).toThrow();
		});

		test("varchar nullable", () => {
			const column = varchar("name", { length: 255 });
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("John Doe")).toBe("John Doe");
			expect(schema.parse(null)).toBe(null);
		});

		test("varchar with default", () => {
			const column = varchar("name", { length: 255 }).default("Unknown");
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("John Doe")).toBe("John Doe");
			expect(schema.parse(undefined)).toBe(undefined);
		});

		test("varchar with runtime default ($default)", () => {
			const column = varchar("name", { length: 255 }).$default(
				() => "Generated",
			);
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("John Doe")).toBe("John Doe");
			// Should be optional - can be omitted entirely
			expect(schema.parse(undefined)).toBe(undefined);
			// Should pass validation when field is not provided (optional)
			const result = schema.safeParse(undefined);
			expect(result.success).toBe(true);
		});

		test("varchar with enum values", () => {
			const column = varchar("status", {
				length: 50,
				enum: ["draft", "published"],
			}).notNull();
			const schema = drizzleColumnToZod(column);

			// Should accept valid enum values
			expect(schema.parse("draft")).toBe("draft");
			expect(schema.parse("published")).toBe("published");

			// Should reject invalid enum values
			const invalidResult = schema.safeParse("invalid");
			expect(invalidResult.success).toBe(false);
		});

		test("pgEnum column notNull", () => {
			const statusEnum = pgEnum("status", ["draft", "published", "archived"]);
			const column = statusEnum("status").notNull();
			const schema = drizzleColumnToZod(column);

			// Should accept valid enum values
			expect(schema.parse("draft")).toBe("draft");
			expect(schema.parse("published")).toBe("published");
			expect(schema.parse("archived")).toBe("archived");

			// Should reject invalid enum values
			const invalidResult = schema.safeParse("invalid");
			expect(invalidResult.success).toBe(false);
		});

		test("pgEnum column nullable", () => {
			const roleEnum = pgEnum("role", ["admin", "user", "guest"]);
			const column = roleEnum("role");
			const schema = drizzleColumnToZod(column);

			// Should accept valid enum values
			expect(schema.parse("admin")).toBe("admin");
			expect(schema.parse("user")).toBe("user");

			// Should accept null
			expect(schema.parse(null)).toBe(null);
		});

		test("pgEnum column with default", () => {
			const statusEnum = pgEnum("status", ["active", "inactive"]);
			const column = statusEnum("status").default("active");
			const schema = drizzleColumnToZod(column);

			// Should accept valid enum values
			expect(schema.parse("active")).toBe("active");
			expect(schema.parse("inactive")).toBe("inactive");

			// Should be optional
			expect(schema.parse(undefined)).toBe(undefined);
		});

		test("integer notNull", () => {
			const column = integer("age").notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(25)).toBe(25);
			expect(() => schema.parse(null)).toThrow();
			expect(() => schema.parse("25")).toThrow();
		});

		test("integer nullable", () => {
			const column = integer("age");
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(25)).toBe(25);
			expect(schema.parse(null)).toBe(null);
		});

		test("boolean with default", () => {
			const column = boolean("is_active").default(true);
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(true)).toBe(true);
			expect(schema.parse(false)).toBe(false);
			expect(schema.parse(undefined)).toBe(undefined);
		});

		test("text column", () => {
			const column = text("description").notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("Long description text")).toBe(
				"Long description text",
			);
		});

		test("uuid column", () => {
			const column = uuid("id").notNull();
			const schema = drizzleColumnToZod(column);

			const validUuid = "123e4567-e89b-12d3-a456-426614174000";
			expect(schema.parse(validUuid)).toBe(validUuid);
			expect(() => schema.parse("invalid-uuid")).toThrow();
		});

		test("timestamp with date mode", () => {
			const column = timestamp("created_at", { mode: "date" }).notNull();
			const schema = drizzleColumnToZod(column);

			const date = new Date();
			expect(schema.parse(date)).toEqual(date);
		});

		test("timestamp with string mode", () => {
			const column = timestamp("created_at", { mode: "string" }).notNull();
			const schema = drizzleColumnToZod(column);

			const dateStr = "2025-01-03T12:00:00Z";
			expect(schema.parse(dateStr)).toBe(dateStr);
		});

		test("bigint with number mode", () => {
			const column = bigint("amount", { mode: "number" }).notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(1000)).toBe(1000);
		});

		test("bigint with bigint mode", () => {
			const column = bigint("amount", { mode: "bigint" }).notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(BigInt(1000))).toBe(BigInt(1000));
		});

		test("numeric column", () => {
			const column = numeric("price", { precision: 10, scale: 2 }).notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse("123.45")).toBe("123.45");
		});

		test("real/float column", () => {
			const column = real("rating").notNull();
			const schema = drizzleColumnToZod(column);

			expect(schema.parse(4.5)).toBe(4.5);
		});

		test("jsonb column", () => {
			const column = jsonb("metadata").$type<{ tags: string[] }>().notNull();
			const schema = drizzleColumnToZod(column);

			const data = { tags: ["tag1", "tag2"] };
			expect(schema.parse(data)).toEqual(data);
		});
	});

	describe("drizzleColumnsToZod", () => {
		test("transforms pgTable to zod schema", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age"),
				isActive: boolean("is_active").default(true),
			});

			const schema = drizzleColumnsToZod(usersTable);

			const validData: z.infer<typeof schema> = {
				name: "John Doe",
				age: 30,
				isActive: false,
			};

			expect(schema.parse(validData)).toEqual(validData);
		});

		test("handles nullable and optional fields", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age"), // nullable
				bio: text("bio").default(""), // optional (has default)
			});

			const schema = drizzleColumnsToZod(usersTable);

			// All nullable fields can be null
			expect(schema.parse({ name: "John", age: null, bio: null })).toEqual({
				name: "John",
				age: null,
				bio: null,
			});

			// Optional fields can be undefined
			expect(schema.parse({ name: "John", age: null })).toEqual({
				name: "John",
				age: null,
			});
		});

		test("validates required fields", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				email: varchar("email", { length: 255 }).notNull(),
			});

			const schema = drizzleColumnsToZod(usersTable);

			expect(() => schema.parse({ name: "John" })).toThrow();
			expect(() => schema.parse({ email: "john@example.com" })).toThrow();
			expect(schema.parse({ name: "John", email: "john@example.com" })).toEqual(
				{
					name: "John",
					email: "john@example.com",
				},
			);
		});

		test("omits reserved keys like $inferInsert and $inferSelect", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age"),
			});

			const schema = drizzleColumnsToZod(usersTable);

			// Should only have name and age, not $inferInsert, $inferSelect, _, etc.
			const parsed = schema.parse({ name: "John", age: 30 });
			expect(Object.keys(parsed)).toEqual(["name", "age"]);
		});
	});

	describe("createInsertSchema", () => {
		test("excludes specified fields", () => {
			const usersTable = pgTable("users", {
				id: uuid("id").notNull(),
				name: varchar("name", { length: 255 }).notNull(),
				createdAt: timestamp("created_at", { mode: "date" }).notNull(),
			});

			const schema = createInsertSchema(usersTable, {
				exclude: { id: true, createdAt: true },
			});

			const validData: z.infer<typeof schema> = { name: "John Doe" };
			expect(schema.parse(validData)).toEqual(validData);

			// Should not require excluded fields
			expect(schema.parse({ name: "Jane" })).toEqual({ name: "Jane" });
		});

		test("makes fields optional when specified", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				email: varchar("email", { length: 255 }).notNull(),
			});

			const schema = createInsertSchema(usersTable, {
				optional: { email: true },
			});

			// Email should be optional
			expect(schema.parse({ name: "John" })).toEqual({ name: "John" });
			expect(schema.parse({ name: "John", email: "john@example.com" })).toEqual(
				{
					name: "John",
					email: "john@example.com",
				},
			);
		});

		test("applies custom refinements", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age").notNull(),
			});

			const schema = createInsertSchema(usersTable, {
				refine: {
					name: (s: any) =>
						s.refine(
							(v: string) => v.length >= 3,
							"Name must be at least 3 characters",
						),
					age: (s: any) => s.min(18, "Must be 18 or older"),
				},
			});

			expect(() => schema.parse({ name: "Jo", age: 25 })).toThrow();
			expect(() => schema.parse({ name: "John", age: 16 })).toThrow();
			expect(schema.parse({ name: "John", age: 25 })).toEqual({
				name: "John",
				age: 25,
			});
		});

		test("works with collection-like structure", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				email: varchar("email", { length: 255 }).notNull(),
				age: integer("age"),
				bio: text("bio"),
			});

			const schema = createInsertSchema(usersTable, {
				exclude: {},
				refine: {
					email: (s: any) =>
						s.refine(
							(v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
							"Invalid email format",
						),
					age: (s: any) =>
						s.refine(
							(v: number | null | undefined) => v == null || v >= 0,
							"Age must be positive",
						),
				},
			});

			expect(() =>
				schema.parse({ name: "John", email: "not-an-email" }),
			).toThrow();

			// bio and age are nullable, so can be omitted or null
			expect(
				schema.parse({
					name: "John",
					email: "john@example.com",
					age: 25,
					bio: null,
				}),
			).toEqual({
				name: "John",
				email: "john@example.com",
				age: 25,
				bio: null,
			});
		});
	});

	describe("createUpdateSchema", () => {
		test("makes all fields optional", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				email: varchar("email", { length: 255 }).notNull(),
				age: integer("age").notNull(),
			});

			const schema = createUpdateSchema(usersTable);

			// All fields should be optional
			expect(schema.parse({ name: "John" })).toEqual({ name: "John" });
			expect(schema.parse({ email: "john@example.com" })).toEqual({
				email: "john@example.com",
			});
			expect(schema.parse({ age: 30 })).toEqual({ age: 30 });
			expect(schema.parse({})).toEqual({});
		});

		test("excludes specified fields", () => {
			const usersTable = pgTable("users", {
				id: uuid("id").notNull(),
				name: varchar("name", { length: 255 }).notNull(),
				createdAt: timestamp("created_at", { mode: "date" }).notNull(),
			});

			const schema = createUpdateSchema(usersTable, {
				exclude: { id: true, createdAt: true },
			});

			expect(schema.parse({ name: "Updated Name" })).toEqual({
				name: "Updated Name",
			});

			// Should not allow excluded fields
			const result = schema.safeParse({ id: "some-id", name: "John" });
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({ name: "John" });
			}
		});

		test("applies custom refinements", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age").notNull(),
			});

			const schema = createUpdateSchema(usersTable, {
				refine: {
					name: (s) => (s as any).min(3, "Name must be at least 3 characters"),
					age: (s) => (s as any).min(0, "Age must be positive"),
				},
			});
			expect(() => schema.parse({ name: "Jo" })).toThrow();
			expect(() => schema.parse({ age: -5 })).toThrow();
			expect(schema.parse({ name: "John" })).toEqual({ name: "John" });
			expect(schema.parse({ age: 25 })).toEqual({ age: 25 });
		});
	});

	describe("real-world usage example", () => {
		test("complete collection validation flow", () => {
			// Define a typical collection structure
			const productFields = pgTable("products", {
				name: varchar("name", { length: 255 }).notNull(),
				description: text("description"),
				price: integer("price").notNull(), // in cents
				stock: integer("stock").default(0),
				isAvailable: boolean("is_available").default(true),
				metadata: jsonb("metadata").$type<{ sku: string; weight: number }>(),
			});

			// Create insert schema (for creating new products)
			const insertSchema = createInsertSchema(productFields, {
				refine: {
					name: (s) =>
						(s as any)
							.refine(
								(v: string) => v.length >= 3,
								"Product name must be at least 3 characters",
							)
							.refine((v: string) => v.length <= 255, "Product name too long"),
					price: (s) => (s as any).min(0, "Price must be positive"),
					stock: (s) =>
						(s as any).refine(
							(v: number | null | undefined) => v == null || v >= 0,
							"Stock cannot be negative",
						),
				},
			});

			// Create update schema (for updating products)
			const updateSchema = createUpdateSchema(productFields, {
				refine: {
					name: (s: any) =>
						s
							.refine(
								(v: string | undefined) => !v || v.length >= 3,
								"Product name must be at least 3 characters",
							)
							.refine(
								(v: string | undefined) => !v || v.length <= 255,
								"Product name too long",
							),
					price: (s: any) => s.min(0, "Price must be positive"),
					stock: (s: any) =>
						s.refine(
							(v: number | null | undefined) => v == null || v >= 0,
							"Stock cannot be negative",
						),
				},
			});

			// Test insert validation
			const newProduct: z.infer<typeof insertSchema> = {
				name: "Test Product",
				description: "A great product",
				price: 1999, // $19.99
				stock: 10,
				isAvailable: true,
				metadata: { sku: "TP-001", weight: 1.5 },
			};
			expect(insertSchema.parse(newProduct)).toEqual(newProduct);

			// Test update validation
			const updates = { price: 2499, stock: 5 };
			expect(updateSchema.parse(updates)).toEqual(updates);

			// Test validation errors
			expect(() => insertSchema.parse({ name: "AB", price: 1999 })).toThrow();
			expect(() => insertSchema.parse({ name: "Test", price: -100 })).toThrow();
			expect(() => updateSchema.parse({ stock: -5 })).toThrow();
		});
	});

	describe("type safety", () => {
		test("maintains type inference", () => {
			const usersTable = pgTable("users", {
				name: varchar("name", { length: 255 }).notNull(),
				age: integer("age"),
			});

			const schema = drizzleColumnsToZod(usersTable);

			// This should compile and pass
			const parsed = schema.parse({ name: "John", age: 30 });

			// TypeScript should know the shape
			expect(parsed.name).toBe("John");
			expect(parsed.age).toBe(30);
		});

		test("enum type inference", () => {
			const productsTable = pgTable("products", {
				status: varchar("status", {
					length: 50,
					enum: ["draft", "published", "archived"],
				}).notNull(),
				name: varchar("name", { length: 255 }).notNull(),
			});

			const schema = drizzleColumnsToZod(productsTable);

			// Should parse valid enum values
			const parsed = schema.parse({
				status: "draft",
				name: "Product",
			});

			expect(parsed.status).toBe("draft");
		});

		test("pgEnum type inference", () => {
			const statusEnum = pgEnum("status", ["pending", "approved", "rejected"]);
			const ordersTable = pgTable("orders", {
				status: statusEnum("status").notNull(),
				itemName: varchar("item_name", { length: 255 }).notNull(),
			});

			const schema = drizzleColumnsToZod(ordersTable);

			// Should parse valid enum values
			const parsed = schema.parse({
				status: "pending",
				itemName: "Widget",
			});

			expect(parsed.status).toBe("pending");

			// Should reject invalid enum values
			const invalidResult = schema.safeParse({
				status: "invalid",
				itemName: "Widget",
			});
			expect(invalidResult.success).toBe(false);
		});
	});
});
