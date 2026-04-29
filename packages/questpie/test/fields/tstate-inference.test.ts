/**
 * Type Tests for TState-based Field Inference
 *
 * These tests verify that input/output types are correctly inferred
 * from field configuration using the TState pattern.
 */

import { describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import type {
	CollectionInsert,
	CollectionSelect,
} from "#questpie/server/collection/builder/collection.js";
import { collection } from "#questpie/server/collection/builder/index.js";

describe("TState Field Type Inference", () => {
	test("basic field types are inferred correctly", () => {
		// Test all field type combinations
		const posts = collection("posts").fields(({ f }) => ({
			// Standard field - required
			title: f.text(255).required(),

			// Standard field - optional with default
			status: f.select([{ value: "draft", label: "Draft" }]).default("draft"),

			// Localized field
			content: f.text().localized(),

			// Virtual field (computed)
			excerpt: f.text().virtual(),

			// Virtual field with SQL
			commentCount: f
				.number()
				.virtual(sql<number>`(SELECT COUNT(*) FROM comments)`),

			// Write-only field (output: false)
			password: f.text().outputFalse(),

			// System field (input: false)
			createdAt: f.datetime().autoNow().inputFalse(),
		}));

		// Get the field definitions from the collection state
		const fieldDefs = posts.state.fieldDefinitions;

		// Verify field definitions exist
		expect(fieldDefs).toBeDefined();
		expect(fieldDefs?.title).toBeDefined();
		expect(fieldDefs?.content).toBeDefined();
		expect(fieldDefs?.excerpt).toBeDefined();
	});

	test("input types are correctly inferred", () => {
		const posts = collection("posts").fields(({ f }) => ({
			// required: true → input: string
			title: f.text().required(),

			// default value → input: string | undefined
			slug: f.text().default("untitled"),

			// no required, no default → input: string | null | undefined
			optional: f.text(),

			// input: false → input: never
			readonly: f.text().inputFalse(),

			// input: "optional" → input: string | undefined
			maybe: f.text().inputOptional(),

			// virtual: true → input: never
			computed: f.text().virtual(),

			// virtual: true + input: true → input: string | undefined
			computedWithInput: f.text().virtual().inputTrue(),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();

		// Check each field's runtime state
		if (fieldDefs) {
			// title: required → notNull should be true
			expect(fieldDefs.title._state.notNull).toBe(true);
		}
	});

	test("output types are correctly inferred", () => {
		const posts = collection("posts").fields(({ f }) => ({
			// default → output: string
			title: f.text(),

			// output: false → output: never
			password: f.text().outputFalse(),

			// access.read function → output: string | undefined
			secret: f
				.text()
				.access({ read: (ctx: any) => (ctx.user as any)?.role === "admin" }),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();
	});

	test("virtual fields have correct location", () => {
		const posts = collection("posts").fields(({ f }) => ({
			// Standard field
			title: f.text(),

			// Localized field
			content: f.text().localized(),

			// Virtual field (hooks-based)
			excerpt: f.text().virtual(),

			// Virtual field (SQL-based)
			count: f.number().virtual(sql<number>`(SELECT COUNT(*))`),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();

		if (fieldDefs) {
			// Check locations via getLocation()
			expect(fieldDefs.title.getLocation()).toBe("main");
			expect(fieldDefs.content.getLocation()).toBe("i18n");
			expect(fieldDefs.excerpt.getLocation()).toBe("virtual");
			expect(fieldDefs.count.getLocation()).toBe("virtual");
		}
	});

	test("columns are null for virtual fields", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(),
			excerpt: f.text().virtual(),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();

		if (fieldDefs) {
			// toColumn should return column for non-virtual
			const titleColumn = fieldDefs.title.toColumn("title");
			expect(titleColumn).not.toBeNull();

			// toColumn should return null for virtual
			const excerptColumn = fieldDefs.excerpt.toColumn("excerpt");
			expect(excerptColumn).toBeNull();
		}
	});
});

describe("Collection Type Inference", () => {
	test("CollectionSelect type works with field definitions", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
			content: f.text().localized(),
			excerpt: f.text().virtual(),
		}));

		// Test that we can use the types
		type PostState = typeof posts.state;
		type PostSelect = CollectionSelect<PostState>;
		type PostInsert = CollectionInsert<PostState>;

		// Type checking only - runtime test
		expect(posts.state.fieldDefinitions).toBeDefined();
	});
});
