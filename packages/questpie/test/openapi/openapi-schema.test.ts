import { describe, expect, it } from "bun:test";

import { generateOpenApiSpec } from "../../../openapi/src/generator/index.js";
import { collection, global } from "../../src/exports/index.js";

describe("OpenAPI schema generation", () => {
	describe("collection schemas", () => {
		it("generates proper JSON schema for collection fields", () => {
			const posts = collection("posts").fields(({ f }) => ({
				title: f.text(255).required(),
				content: f.textarea(),
				viewCount: f.number().default(0),
				isPublished: f.boolean().default(false),
				tags: f.text().array(),
				metadata: f.object({
					author: f.text(),
					category: f.text(),
				}),
			}));

			// Create a minimal mock app for testing
			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
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
			const posts = collection("posts").fields(({ f }) => ({
				title: f.text().required(),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
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
			const authors = collection("authors").fields(({ f }) => ({
				name: f.text().required(),
			}));

			const posts = collection("posts").fields(({ f }) => ({
				title: f.text().required(),
				author: f.relation("authors"),
			}));

			const mockCms = {
				getCollections: () => ({ authors, posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			const insertSchema = spec.components?.schemas?.PostsInsert as any;
			expect(insertSchema).toBeDefined();
			expect(insertSchema.properties).toBeDefined();
			// Relation field should be present (as FK reference)
			expect(insertSchema.properties.author).toBeDefined();
		});

		it("does not generate empty schemas", () => {
			const posts = collection("posts").fields(({ f }) => ({
				title: f.text(100).required(),
				content: f.textarea(),
				views: f.number(),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
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

		it("generates collection versioning paths", () => {
			const posts = collection("posts")
				.fields(({ f }) => ({
					title: f.text().required(),
				}))
				.options({ versioning: true });

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			expect(spec.paths?.["//posts/{id}/versions"]?.get).toBeDefined();
			expect(spec.paths?.["//posts/{id}/revert"]?.post).toBeDefined();
		});

		it("generates transition path for workflow-enabled collections", () => {
			const posts = collection("posts")
				.fields(({ f }) => ({
					title: f.text().required(),
				}))
				.options({
					versioning: {
						workflow: {
							stages: ["draft", "published"],
							initialStage: "draft",
						},
					},
				});

			const pages = collection("pages").fields(({ f }) => ({
				title: f.text().required(),
			}));

			const mockCms = {
				getCollections: () => ({ posts, pages }),
				getGlobals: () => ({}),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			// Workflow-enabled collection should have transition endpoint
			const transitionOp = spec.paths?.["//posts/{id}/transition"]?.post;
			expect(transitionOp).toBeDefined();
			expect(transitionOp?.operationId).toBe("posts_transition");

			// Non-workflow collection should NOT have transition endpoint
			expect(spec.paths?.["//pages/{id}/transition"]).toBeUndefined();
		});
	});

	describe("global schemas", () => {
		it("generates proper JSON schema for global fields", () => {
			const settings = global("settings").fields(({ f }) => ({
				siteName: f.text(100).required(),
				siteDescription: f.textarea(),
				maintenanceMode: f.boolean().default(false),
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

		it("generates global versioning paths", () => {
			const settings = global("settings")
				.fields(({ f }) => ({
					siteName: f.text().required(),
				}))
				.options({ versioning: true });

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings }),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			expect(spec.paths?.["//globals/settings/versions"]?.get).toBeDefined();
			expect(spec.paths?.["//globals/settings/revert"]?.post).toBeDefined();
		});

		it("generates transition path for workflow-enabled globals", () => {
			const settings = global("settings")
				.fields(({ f }) => ({
					siteName: f.text().required(),
				}))
				.options({
					versioning: {
						workflow: {
							stages: ["draft", "published"],
							initialStage: "draft",
						},
					},
				});

			const nav = global("nav").fields(({ f }) => ({
				items: f.text().array(),
			}));

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings, nav }),
			};

			const spec = generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			// Workflow-enabled global should have transition endpoint
			const transitionOp = spec.paths?.["//globals/settings/transition"]?.post;
			expect(transitionOp).toBeDefined();
			expect(transitionOp?.operationId).toBe("global_settings_transition");

			// Non-workflow global should NOT have transition endpoint
			expect(spec.paths?.["//globals/nav/transition"]).toBeUndefined();
		});
	});
});
