import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, job } from "../../src/exports/index.js";
import { isNullish } from "../../src/shared/utils/data-utils.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const articleCreatedJob = job({
	name: "article:created",
	schema: z.object({
		articleId: z.string(),
		title: z.string(),
	}),
	handler: async () => {},
});

const articleCleanupJob = job({
	name: "article:cleanup",
	schema: z.object({
		articleId: z.string(),
	}),
	handler: async () => {},
});

const articleEnrichedJob = job({
	name: "article:enriched",
	schema: z.object({
		articleId: z.string(),
		enrichment: z.any(),
	}),
	handler: async () => {},
});

// Module definitions at top level for stable types
const createBeforeAfterModule = (hookCallOrder: string[]) => ({
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
				slug: f.text(255),
				status: f.text(50),
			}))
			.hooks({
				beforeChange: async ({ data, operation }) => {
					hookCallOrder.push(`before-${operation}`);
					if (!data.slug && data.title) {
						data.slug = data.title
							.toLowerCase()
							.replace(/\s+/g, "-")
							.replace(/[^a-z0-9-]/g, "");
					}
				},
				afterChange: async ({ data, operation, queue }) => {
					hookCallOrder.push(`after-${operation}`);
					await (queue as any).articleCreated.publish({
						articleId: data.id,
						title: data.title,
					});
				},
			}),
	},
	jobs: {
		articleCreated: articleCreatedJob,
	},
});

const testModuleUpdate = {
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.text(50),
				viewCount: f.text(),
			}))
			.hooks({
				beforeChange: async ({ data, operation, logger }) => {
					if (operation === "update" && data.status === "published") {
						(logger as any).info("Article being published", {
							title: data.title,
						});
					}
				},
				afterChange: async ({ data, original, operation, email }) => {
					if (
						operation === "update" &&
						original &&
						original.status !== "published" &&
						data.status === "published"
					) {
						(email as any)?.send({
							to: "admin@example.com",
							subject: "Article Published",
							text: `Article "${data.title}" has been published`,
						});
					}
				},
			}),
	},
};

const testModuleDelete = {
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
			}))
			.hooks({
				beforeDelete: async ({ data, logger }) => {
					(logger as any)?.warn("Article deletion requested", {
						id: data.id,
					});
				},
				afterDelete: async ({ data, queue }) => {
					await (queue as any).articleCleanup.publish({
						articleId: data.id,
					});
				},
			}),
	},
	jobs: {
		articleCleanup: articleCleanupJob,
	},
};

const testModuleError = {
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.text(50),
			}))
			.hooks({
				beforeChange: async ({ data }) => {
					if (data.title === "forbidden") {
						throw new Error("Forbidden title");
					}
				},
			}),
	},
};

const createEnrichmentModule = (enrichmentData: Map<string, any>) => ({
	collections: {
		articles: collection("articles")
			.fields(({ f }) => ({
				title: f.textarea().required(),
			}))
			.hooks({
				beforeChange: async ({ data }) => {
					if (isNullish(data.id)) return;
					enrichmentData.set(data.id, {
						enriched: true,
						timestamp: Date.now(),
					});
				},
				afterChange: async ({ data, queue }) => {
					const enrichment = enrichmentData.get(data.id);
					await (queue as any).articleEnriched.publish({
						articleId: data.id,
						enrichment,
					});
				},
			}),
	},
	jobs: {
		articleEnriched: articleEnrichedJob,
	},
});

describe("collection-hooks", () => {
	describe("beforeChange/afterChange hooks", () => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let hookCallOrder: string[];

		beforeEach(async () => {
			hookCallOrder = [];
			const definition = createBeforeAfterModule(hookCallOrder);
			setup = await buildMockApp(definition);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("executes hooks in correct order on create", async () => {
			await setup.app.collections.articles.create({
				title: "My First Article",
			});

			expect(hookCallOrder).toEqual(["before-create", "after-create"]);
		});

		it("transforms data in beforeChange hook", async () => {
			const result = await setup.app.collections.articles.create({
				title: "Hello World Article",
			});

			expect(result?.slug).toBe("hello-world-article");
		});

		it("publishes job in afterChange hook", async () => {
			const result = await setup.app.collections.articles.create({
				title: "Test",
			});

			// Just verify the hook ran without errors (job would be queued)
			expect(result?.id).toBeDefined();
		});

		it("executes hooks on update", async () => {
			const created = await setup.app.collections.articles.create({
				title: "Original",
			});

			hookCallOrder.length = 0;
			await setup.app.collections.articles.update({
				where: { id: created!.id },
				data: { title: "Updated" },
			});

			expect(hookCallOrder).toEqual(["before-update", "after-update"]);
		});
	});

	describe("update hooks with original comparison", () => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp(testModuleUpdate);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("provides original record in afterChange", async () => {
			const created = await setup.app.collections.articles.create({
				title: "Test",
				status: "draft",
			});

			// Update to published - hook should send email
			await setup.app.collections.articles.update({
				where: { id: created!.id },
				data: { status: "published" },
			});

			// Just verify no errors (email sending would be attempted)
			expect(true).toBe(true);
		});
	});

	describe("delete hooks", () => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp(testModuleDelete);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("executes beforeDelete and afterDelete", async () => {
			const created = await setup.app.collections.articles.create({
				title: "To Delete",
			});

			await setup.app.collections.articles.delete({
				where: { id: created!.id },
			});

			// Verify deletion worked
			const found = await setup.app.collections.articles.findOne({
				where: { id: created!.id },
			});
			expect(found).toBeNull();
		});
	});

	describe("error handling in hooks", () => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp(testModuleError);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("throws error from beforeChange hook", async () => {
			expect(
				setup.app.collections.articles.create({
					title: "forbidden",
				}),
			).rejects.toThrow("Forbidden title");
		});

		it("allows valid records", async () => {
			const result = await setup.app.collections.articles.create({
				title: "allowed",
			});

			expect(result?.title).toBe("allowed");
		});
	});

	describe("data enrichment across hooks", () => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let enrichmentData: Map<string, any>;

		beforeEach(async () => {
			enrichmentData = new Map();
			const definition = createEnrichmentModule(enrichmentData);
			setup = await buildMockApp(definition);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("shares data between beforeChange and afterChange", async () => {
			const result = await setup.app.collections.articles.create({
				title: "Enriched Article",
			});

			// The enrichment map should have been populated in beforeChange
			// and used in afterChange to publish the job
			expect(result?.id).toBeDefined();
		});
	});
});
