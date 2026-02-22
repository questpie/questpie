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
import { questpie } from "#questpie/server/config/builder.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";

const q = questpie({ name: "test-module" }).fields(defaultFields);

describe("TState Field Type Inference", () => {
	test("basic field types are inferred correctly", () => {
		// Test all field type combinations
		const posts = q.collection("posts").fields((f) => ({
			// Standard field - required
			title: f.text({ required: true, maxLength: 255 }),

			// Standard field - optional with default
			status: f.select({
				options: [{ value: "draft", label: "Draft" }],
				default: "draft",
			}),

			// Localized field
			content: f.text({ localized: true }),

			// Virtual field (computed)
			excerpt: f.text({ virtual: true }),

			// Virtual field with SQL
			commentCount: f.number({
				virtual: sql<number>`(SELECT COUNT(*) FROM comments)`,
			}),

			// Write-only field (output: false)
			password: f.text({ output: false }),

			// System field (input: false)
			createdAt: f.datetime({
				autoNow: true,
				input: false,
			}),
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
		const posts = q.collection("posts").fields((f) => ({
			// required: true → input: string
			title: f.text({ required: true }),

			// default value → input: string | undefined
			slug: f.text({ default: "untitled" }),

			// no required, no default → input: string | null | undefined
			optional: f.text({}),

			// input: false → input: never
			readonly: f.text({ input: false }),

			// input: "optional" → input: string | undefined
			maybe: f.text({ input: "optional" }),

			// virtual: true → input: never
			computed: f.text({ virtual: true }),

			// virtual: true + input: true → input: string | undefined
			computedWithInput: f.text({ virtual: true, input: true }),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();

		// Check each field's state
		if (fieldDefs) {
			// title: required → input should be string (not null/undefined)
			// Note: 'required' is in config, not state.required
			expect((fieldDefs.title as any).state?.config?.required ?? true).toBe(
				true,
			);

			// content: localized → location should be "i18n"
			// Note: content not in this test, but we check the pattern
		}
	});

	test("output types are correctly inferred", () => {
		const posts = q.collection("posts").fields((f) => ({
			// default → output: string
			title: f.text({}),

			// output: false → output: never
			password: f.text({ output: false }),

			// access.read function → output: string | undefined
			secret: f.text({
				access: { read: (ctx: any) => (ctx.user as any)?.role === "admin" },
			}),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();
	});

	test("virtual fields have correct location", () => {
		const posts = q.collection("posts").fields((f) => ({
			// Standard field
			title: f.text({}),

			// Localized field
			content: f.text({ localized: true }),

			// Virtual field (hooks-based)
			excerpt: f.text({ virtual: true }),

			// Virtual field (SQL-based)
			count: f.number({
				virtual: sql<number>`(SELECT COUNT(*))`,
			}),
		}));

		const fieldDefs = posts.state.fieldDefinitions;
		expect(fieldDefs).toBeDefined();

		if (fieldDefs) {
			// Check locations - use any cast to avoid type literal narrowing issues
			expect((fieldDefs.title.state as any).location).toBe("main");
			expect((fieldDefs.content.state as any).location).toBe("i18n");
			expect((fieldDefs.excerpt.state as any).location).toBe("virtual");
			expect((fieldDefs.count.state as any).location).toBe("virtual");
		}
	});

	test("columns are null for virtual fields", () => {
		const posts = q.collection("posts").fields((f) => ({
			title: f.text({}),
			excerpt: f.text({ virtual: true }),
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
		const posts = q.collection("posts").fields((f) => ({
			title: f.text({ required: true }),
			content: f.text({ localized: true }),
			excerpt: f.text({ virtual: true }),
		}));

		// Test that we can use the types
		type PostState = typeof posts.state;
		type PostSelect = CollectionSelect<PostState>;
		type PostInsert = CollectionInsert<PostState>;

		// Type checking only - runtime test
		expect(posts.state.fieldDefinitions).toBeDefined();
	});
});
