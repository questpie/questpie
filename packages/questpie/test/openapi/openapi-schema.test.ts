import { describe, expect, it } from "bun:test";

import { generateOpenApiSpec } from "../../../openapi/src/generator/index.js";
import { collection, global } from "../../src/exports/index.js";

describe("OpenAPI schema generation", () => {
	describe("collection schemas", () => {
		it("generates proper JSON schema for collection fields", async () => {
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

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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

		it("generates document schema with id and timestamps", async () => {
			const posts = collection("posts").fields(({ f }) => ({
				title: f.text().required(),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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

		it("documents required optimistic-lock inputs on every CRUD mutation", async () => {
			const tags = collection("tags")
				.fields(({ f }) => ({
					name: f.text().required(),
					version: f.number().required().default(1),
				}))
				.options({
					softDelete: true,
					optimisticLock: { field: "version", required: true },
				});
			const mockCms = {
				getCollections: () => ({ tags }),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});
			const updateSchema = spec.components?.schemas?.TagsUpdate as any;
			expect(updateSchema.properties.version).toBeUndefined();

			const byId = spec.paths?.["//tags/{id}"] as any;
			const updateBody =
				byId.patch.requestBody.content["application/json"].schema;
			expect(updateBody.required).toEqual(["data", "expectedVersion"]);
			expect(
				byId.delete.requestBody.content["application/json"].schema.required,
			).toEqual(["expectedVersion"]);
			expect(byId.patch.responses["409"]).toBeDefined();

			const bulkUpdate = spec.paths?.["//tags"]?.patch as any;
			expect(
				bulkUpdate.requestBody.content["application/json"].schema.required,
			).toEqual(["where", "data", "expectedVersions"]);
			const updateBatch = spec.paths?.["//tags/update-batch"]?.post as any;
			expect(updateBatch).toBeDefined();
			const deleteMany = spec.paths?.["//tags/delete-many"]?.post as any;
			expect(
				deleteMany.requestBody.content["application/json"].schema.required,
			).toEqual(["where", "expectedVersions"]);
			const restore = spec.paths?.["//tags/{id}/restore"]?.post as any;
			expect(
				restore.requestBody.content["application/json"].schema.required,
			).toEqual(["expectedVersion"]);
			const purge = spec.paths?.["//tags/{id}/purge"]?.post as any;
			expect(
				purge.requestBody.content["application/json"].schema.required,
			).toEqual(["expectedVersion"]);
			expect(purge.responses["409"]).toBeDefined();
			const revert = spec.paths?.["//tags/{id}/revert"]?.post as any;
			expect(
				revert.requestBody.content["application/json"].schema.required,
			).toEqual(["expectedVersion"]);
			expect(revert.responses["409"]).toBeDefined();
		});

		it("handles relation fields", async () => {
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

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			const insertSchema = spec.components?.schemas?.PostsInsert as any;
			expect(insertSchema).toBeDefined();
			expect(insertSchema.properties).toBeDefined();
			// Relation field should be present (as FK reference)
			expect(insertSchema.properties.author).toBeDefined();
		});

		it("separates inputFalse and outputFalse fields in collection schemas", async () => {
			const credentials = collection("credentials").fields(({ f }) => ({
				title: f.text(255).required(),
				serverOnly: f.text(255).inputFalse(),
				secret: f.text(255).outputFalse(),
			}));

			const mockCms = {
				getCollections: () => ({ credentials }),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			const insertSchema = spec.components?.schemas?.CredentialsInsert as any;
			const updateSchema = spec.components?.schemas?.CredentialsUpdate as any;
			const documentSchema = spec.components?.schemas
				?.CredentialsDocument as any;
			const documentFields = documentSchema.allOf[1];

			expect(insertSchema.properties.title).toBeDefined();
			expect(insertSchema.properties.serverOnly).toBeUndefined();
			expect(insertSchema.properties.secret.writeOnly).toBe(true);
			expect(updateSchema.properties.serverOnly).toBeUndefined();
			expect(updateSchema.properties.secret.writeOnly).toBe(true);
			expect(documentFields.properties.serverOnly.readOnly).toBe(true);
			expect(documentFields.properties.secret).toBeUndefined();
		});

		it("does not generate empty schemas", async () => {
			const posts = collection("posts").fields(({ f }) => ({
				title: f.text(100).required(),
				content: f.textarea(),
				views: f.number(),
			}));

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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

		it("generates collection versioning paths", async () => {
			const posts = collection("posts")
				.fields(({ f }) => ({
					title: f.text().required(),
				}))
				.options({ versioning: true });

			const mockCms = {
				getCollections: () => ({ posts }),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			expect(spec.paths?.["//posts/{id}/versions"]?.get).toBeDefined();
			expect(spec.paths?.["//posts/{id}/revert"]?.post).toBeDefined();
		});

		it("generates transition path for workflow-enabled collections", async () => {
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

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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

	describe("auth schemas", () => {
		// A faithful slice of what Better Auth's `openAPI()` plugin emits from
		// `auth.api.generateOpenAPISchema()`: paths relative to /api/auth, real
		// request/response schemas, `$ref`s into components, and securitySchemes.
		function betterAuthOpenApiDoc() {
			return {
				openapi: "3.1.1",
				info: { title: "Better Auth", description: "", version: "1.0" },
				components: {
					securitySchemes: {
						apiKeyCookie: {
							type: "apiKey",
							in: "cookie",
							name: "better-auth.session_token",
							description: "",
						},
						bearerAuth: { type: "http", scheme: "bearer", description: "" },
					},
					schemas: {
						User: {
							type: "object",
							properties: {
								id: { type: "string" },
								email: { type: "string" },
							},
							required: ["id", "email"],
						},
						Session: {
							type: "object",
							properties: { id: { type: "string" } },
							required: ["id"],
						},
					},
				},
				security: [{ apiKeyCookie: [], bearerAuth: [] }],
				servers: [{ url: "http://localhost:3000/api/auth" }],
				tags: [{ name: "Default", description: "" }],
				paths: {
					"/sign-in/email": {
						post: {
							tags: ["Default"],
							operationId: "signInEmail",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												email: { type: "string" },
												password: { type: "string" },
											},
											required: ["email", "password"],
										},
									},
								},
							},
							responses: {
								"200": {
									description: "Success",
									content: {
										"application/json": {
											schema: {
												type: "object",
												properties: {
													user: { $ref: "#/components/schemas/User" },
												},
											},
										},
									},
								},
							},
						},
					},
					"/get-session": {
						get: {
							tags: ["Default"],
							operationId: "getSession",
							responses: {
								"200": {
									description: "Success",
									content: {
										"application/json": {
											schema: {
												type: ["object", "null"],
												properties: {
													session: { $ref: "#/components/schemas/Session" },
													user: { $ref: "#/components/schemas/User" },
												},
											},
										},
									},
								},
							},
						},
					},
					"/admin/list-users": {
						get: {
							tags: ["Default"],
							operationId: "listUsers",
							responses: {
								"200": {
									description: "Success",
									content: {
										"application/json": {
											schema: { type: "object" },
										},
									},
								},
							},
						},
					},
				},
			};
		}

		it("derives real auth paths + schemas from the better-auth openAPI plugin", async () => {
			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({}),
				auth: {
					api: {
						generateOpenAPISchema: async () => betterAuthOpenApiDoc(),
					},
				},
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			// Core endpoints are present and correctly prefixed <basePath>/auth/...
			expect(spec.paths?.["//auth/sign-in/email"]?.post).toBeDefined();
			expect(spec.paths?.["//auth/get-session"]?.get).toBeDefined();
			// Configured-plugin endpoints (admin/*) come through too.
			expect(spec.paths?.["//auth/admin/list-users"]?.get).toBeDefined();

			// Response schemas are NON-opaque: sign-in references a real schema,
			// not { type: "object" } with an empty `user`.
			const signIn = spec.paths?.["//auth/sign-in/email"]?.post as any;
			const userRef =
				signIn.responses["200"].content["application/json"].schema.properties
					.user.$ref;
			// $ref must be rewritten to the namespaced schema name.
			expect(userRef).toBe("#/components/schemas/AuthUser");

			// Namespaced component schemas exist and are not empty.
			const authUser = spec.components?.schemas?.AuthUser as any;
			expect(authUser).toBeDefined();
			expect(authUser.type).toBe("object");
			expect(Object.keys(authUser.properties || {}).length).toBeGreaterThan(0);
			expect(spec.components?.schemas?.AuthSession).toBeDefined();
			// Bare (un-namespaced) names must NOT leak into the merged spec.
			expect(spec.components?.schemas?.User).toBeUndefined();

			// Auth operations are retagged under a single "Auth" tag.
			expect(signIn.tags).toEqual(["Auth"]);
			expect(spec.tags?.some((t) => t.name === "Auth")).toBe(true);

			// Better Auth security schemes are merged in (deduped).
			expect(spec.components?.securitySchemes?.apiKeyCookie).toBeDefined();
			expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
			// QUESTPIE's own defaults still present.
			expect(spec.components?.securitySchemes?.cookieAuth).toBeDefined();
		});

		it("falls back to the hardcoded minimal set when app.auth is absent", async () => {
			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({}),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			// The four hardcoded fallback endpoints are documented.
			expect(spec.paths?.["//auth/sign-in/email"]?.post).toBeDefined();
			expect(spec.paths?.["//auth/sign-up/email"]?.post).toBeDefined();
			expect(spec.paths?.["//auth/get-session"]?.get).toBeDefined();
			expect(spec.paths?.["//auth/sign-out"]?.post).toBeDefined();
			// The richer plugin-only endpoints are NOT present in the fallback.
			expect(spec.paths?.["//auth/admin/list-users"]).toBeUndefined();
		});

		it("falls back when generateOpenAPISchema throws", async () => {
			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({}),
				auth: {
					api: {
						generateOpenAPISchema: async () => {
							throw new Error("boom");
						},
					},
				},
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			// Graceful fallback: no crash, hardcoded set present.
			expect(spec.paths?.["//auth/sign-in/email"]?.post).toBeDefined();
			expect(spec.paths?.["//auth/admin/list-users"]).toBeUndefined();
		});

		it("omits auth entirely when config.auth === false", async () => {
			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({}),
				auth: {
					api: {
						generateOpenAPISchema: async () => betterAuthOpenApiDoc(),
					},
				},
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
				auth: false,
			});

			expect(spec.paths?.["//auth/sign-in/email"]).toBeUndefined();
			expect(spec.paths?.["//auth/admin/list-users"]).toBeUndefined();
			expect(spec.components?.schemas?.AuthUser).toBeUndefined();
		});
	});

	describe("global schemas", () => {
		it("generates proper JSON schema for global fields", async () => {
			const settings = global("settings").fields(({ f }) => ({
				siteName: f.text(100).required(),
				siteDescription: f.textarea(),
				maintenanceMode: f.boolean().default(false),
			}));

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings }),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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

		it("separates inputFalse and outputFalse fields in global schemas", async () => {
			const settings = global("settings").fields(({ f }) => ({
				siteName: f.text(100).required(),
				serverOnly: f.text(100).inputFalse(),
				secret: f.text(100).outputFalse(),
			}));

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings }),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
			});

			const updateSchema = spec.components?.schemas
				?.SettingsGlobalUpdate as any;
			const valueSchema = spec.components?.schemas?.SettingsGlobal as any;
			const valueFields = valueSchema.allOf[1];

			expect(updateSchema.properties.siteName).toBeDefined();
			expect(updateSchema.properties.serverOnly).toBeUndefined();
			expect(updateSchema.properties.secret.writeOnly).toBe(true);
			expect(valueFields.properties.serverOnly.readOnly).toBe(true);
			expect(valueFields.properties.secret).toBeUndefined();
		});

		it("generates global versioning paths", async () => {
			const settings = global("settings")
				.fields(({ f }) => ({
					siteName: f.text().required(),
				}))
				.options({ versioning: true });

			const mockCms = {
				getCollections: () => ({}),
				getGlobals: () => ({ settings }),
			};

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
				info: { title: "Test API", version: "1.0.0" },
				basePath: "/",
			});

			expect(spec.paths?.["//globals/settings/versions"]?.get).toBeDefined();
			expect(spec.paths?.["//globals/settings/revert"]?.post).toBeDefined();
		});

		it("generates transition path for workflow-enabled globals", async () => {
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

			const spec = await generateOpenApiSpec(mockCms as any, undefined, {
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
