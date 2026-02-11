import { describe, expect, it } from "bun:test";
import { generateOpenApiSpec } from "../../../openapi/src/generator/index.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";

describe("OpenAPI schema generation", () => {
	describe("collection schemas", () => {
		it("generates proper JSON schema for collection fields", () => {
			const q = questpie({ name: "test-openapi" }).fields(defaultFields);

			const posts = q.collection("posts").fields((f) => ({
				title: f.text({ required: true, maxLength: 255 }),
				content: f.textarea(),
				viewCount: f.number({ default: 0 }),
				isPublished: f.boolean({ default: false }),
				tags: f.array({ of: f.text() }),
				metadata: f.object({
					fields: () => ({
						author: f.text(),
						category: f.text(),
					}),
				}),
			}));

			// Create a minimal mock CMS for testing
			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			// Check that schemas are generated
			expect(spec.components?.schemas).toBeDefined();

			const insertSchema = spec.components?.schemas?.PostsInsert as any;
			expect(insertSchema).toBeDefined();
			expect(insertSchema.type).toBe("object");
			expect(insertSchema.properties).toBeDefined();

			// Check individual field types
			expect(insertSchema.properties.title).toBeDefined();
			expect(insertSchema.properties.title.type).toBe("string");
			expect(insertSchema.properties.title.maxLength).toBe(255);

			expect(insertSchema.properties.content).toBeDefined();

			expect(insertSchema.properties.viewCount).toBeDefined();

			expect(insertSchema.properties.isPublished).toBeDefined();

			// Check required fields
			expect(insertSchema.required).toContain("title");
		});

		it("generates document schema with id and timestamps", () => {
			const q = questpie({ name: "test-openapi-doc" }).fields(defaultFields);

			const posts = q.collection("posts").fields((f) => ({
				title: f.text({ required: true }),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			const docSchema = spec.components?.schemas?.PostsDocument as any;
			expect(docSchema).toBeDefined();

			// Document schema should use allOf to combine id/timestamps with insert schema
			expect(docSchema.allOf).toBeDefined();
			expect(docSchema.allOf.length).toBeGreaterThan(0);

			// First part should have id
			const baseSchema = docSchema.allOf[0];
			expect(baseSchema.properties?.id).toBeDefined();
			expect(baseSchema.properties?.createdAt).toBeDefined();
			expect(baseSchema.properties?.updatedAt).toBeDefined();
		});

		it("handles relation fields", () => {
			const q = questpie({ name: "test-openapi-relations" }).fields(
				defaultFields,
			);

			const authors = q.collection("authors").fields((f) => ({
				name: f.text({ required: true }),
			}));

			const posts = q.collection("posts").fields((f) => ({
				title: f.text({ required: true }),
				author: f.relation({ to: "authors" }),
			}));

			const mockCms = {
				getCollections: () => ({ authors, posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			const insertSchema = spec.components?.schemas?.PostsInsert as any;
			expect(insertSchema).toBeDefined();
			expect(insertSchema.properties).toBeDefined();
			// Relation field should be present (as FK reference)
			expect(insertSchema.properties.author).toBeDefined();
		});

		it("does not generate empty schemas", () => {
			const q = questpie({ name: "test-openapi-nonempty" }).fields(
				defaultFields,
			);

			const posts = q.collection("posts").fields((f) => ({
				title: f.text({ required: true, maxLength: 100 }),
				content: f.textarea(),
				views: f.number(),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			const insertSchema = spec.components?.schemas?.PostsInsert as any;

			// Should have actual properties, not just empty object
			expect(Object.keys(insertSchema.properties || {}).length).toBeGreaterThan(
				0,
			);

			// Should have title, content, views
			expect(insertSchema.properties.title).toBeDefined();
			expect(insertSchema.properties.content).toBeDefined();
			expect(insertSchema.properties.views).toBeDefined();
		});
	});

	describe("global schemas", () => {
		it("generates proper JSON schema for global fields", () => {
			const q = questpie({ name: "test-openapi-globals" }).fields(
				defaultFields,
			);

			const settings = q.global("settings").fields((f) => ({
				siteName: f.text({ required: true, maxLength: 100 }),
				siteDescription: f.textarea(),
				maintenanceMode: f.boolean({ default: false }),
			}));

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings }),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			const updateSchema = spec.components?.schemas
				?.SettingsGlobalUpdate as any;
			expect(updateSchema).toBeDefined();
			expect(updateSchema.properties).toBeDefined();
			expect(updateSchema.properties.siteName).toBeDefined();
			expect(updateSchema.properties.siteDescription).toBeDefined();
			expect(updateSchema.properties.maintenanceMode).toBeDefined();
		});
	});
});
