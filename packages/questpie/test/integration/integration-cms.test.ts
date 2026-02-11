import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { job, questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const articlePublishedJob = job({
	name: "article:published",
	schema: z.object({
		articleId: z.string(),
		title: z.string(),
		authorId: z.string(),
	}),
	handler: async () => {},
});

const articleDeletedJob = job({
	name: "article:deleted",
	schema: z.object({
		articleId: z.string(),
	}),
	handler: async () => {},
});

const createTestModule = () => {
	const q = questpie({ name: "integration-test" }).fields(defaultFields);

	const authors = q
		.collection("authors")
		.fields((f) => ({
			name: f.textarea({ required: true }),
			email: f.text({ required: true, maxLength: 255 }),
			bio: f.textarea(),
		}))
		.title(({ f }) => f.name)
		.hooks({
			afterChange: async ({ data, operation, app }) => {
				if (operation !== "create") return;
				const cms = app as any;
				// Send welcome email when author is created
				await cms.email?.send({
					to: data.email,
					subject: "Welcome to our platform!",
					text: `Hi ${data.name}, welcome!`,
				});
			},
		});

	// Define articles collection with relations
	const articles = q
		.collection("articles")
		.fields((f) => ({
			author: f.relation({
				to: "authors",
				required: true,
				relationName: "author",
			}),
			title: f.textarea({ required: true }),
			slug: f.text({ required: true, maxLength: 255 }),
			content: f.json(),
			featuredImage: f.json(),
			status: f.text({ maxLength: 50 }),
			viewCount: f.number(),
			publishedAt: f.datetime(),
			tags: f.relation({
				to: "tags",
				hasMany: true,
				through: "article_tags",
				sourceField: "article", // FK column key is field name with unified API
				targetField: "tag",
			}),
		}))
		.title(({ f }) => f.title)
		.options({
			timestamps: true,
			softDelete: true,
			versioning: true,
		})
		.hooks({
			beforeChange: async ({ data, operation }) => {
				if (operation !== "create") return;
				// Auto-generate slug if not provided
				if (!data.slug && data.title) {
					data.slug = (data.title as string)
						.toLowerCase()
						.replace(/\s+/g, "-")
						.replace(/[^a-z0-9-]/g, "");
				}
			},
			afterChange: async ({ data, original, operation, app }) => {
				const cms = app as any;
				if (operation === "create") {
					await cms.logger?.info("Article created", {
						id: data.id,
						title: data.title,
					});
				} else if (operation === "update" && original) {
					// Track publication
					if (original.status !== "published" && data.status === "published") {
						await cms.queue.articlePublished.publish({
							articleId: data.id,
							title: data.title,
							authorId: (data as any).author, // FK column key is field name with unified API
						});

						await cms.logger?.info("Article published", {
							id: data.id,
							title: data.title,
						});
					}
				}
			},
			afterDelete: async ({ data, app }) => {
				const cms = app as any;
				await cms.queue.articleDeleted.publish({ articleId: data.id });
			},
		});

	// Define tags collection
	const tags = q
		.collection("tags")
		.fields((f) => ({
			name: f.textarea({ required: true }),
			articles: f.relation({
				to: "articles",
				hasMany: true,
				through: "article_tags",
				sourceField: "tag", // FK column key is field name with unified API
				targetField: "article",
			}),
		}))
		.title(({ f }) => f.name);

	// Define junction table
	const articleTags = q.collection("article_tags").fields((f) => ({
		article: f.relation({
			to: "articles",
			required: true,
			onDelete: "cascade",
		}),
		tag: f.relation({
			to: "tags",
			required: true,
			onDelete: "cascade",
		}),
	}));

	return q
		.collections({
			authors,
			articles,
			tags,
			article_tags: articleTags,
		})
		.jobs({
			articlePublished: articlePublishedJob,
			articleDeleted: articleDeletedJob,
		});
};

describe("integration: full CMS workflow", () => {
	let setup: Awaited<
		ReturnType<typeof buildMockApp<ReturnType<typeof createTestModule>>>
	>;

	beforeEach(async () => {
		// Define authors collection
		const testModule = createTestModule();
		setup = (await buildMockApp(testModule)) as any;
		await runTestDbMigrations(setup.cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("complete blog workflow: create author, create article, publish, track metrics", async () => {
		const ctx = createTestContext();

		// 1. Create an author
		const authorsCrud = setup.cms.api.collections.authors;
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "Jane Doe",
				email: "jane@example.com",
				bio: "Tech writer and blogger",
			},
			ctx,
		);

		// Verify welcome email was sent
		expect(setup.cms.mocks.mailer.getSentCount()).toBe(1);
		const sentEmail = setup.cms.mocks.mailer.getSentMails();
		const lastSent = sentEmail[sentEmail.length - 1];
		expect(lastSent?.to).toBe("jane@example.com");
		expect(lastSent?.subject).toBe("Welcome to our platform!");

		// 2. Create a draft article
		const articlesCrud = setup.cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author.id, // Use field name, not FK column - types and runtime both accept this
				title: "Getting Started with TypeScript",
				slug: `getting-started-with-typescript`,
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "TypeScript is a typed superset of JavaScript...",
								},
							],
						},
					],
				},
				status: "draft",
			},
			ctx,
		);

		// Verify slug was auto-generated
		expect(article.slug).toBe("getting-started-with-typescript");

		// Verify article creation was logged
		expect(setup.cms.mocks.logger.wasLogged("info", "Article created")).toBe(
			true,
		);

		// 3. Add featured image
		await articlesCrud.updateById(
			{
				id: article.id,
				data: {
					featuredImage: {
						key: "images/typescript-hero.jpg",
						url: "https://cdn.example.com/images/typescript-hero.jpg",
						alt: "TypeScript Logo",
						width: 1200,
						height: 630,
					},
				},
			},
			ctx,
		);

		// 4. Publish the article
		await articlesCrud.updateById(
			{
				id: article.id,
				data: {
					status: "published",
					publishedAt: new Date(),
				},
			},
			ctx,
		);

		// Verify publication job was queued
		const jobs = setup.cms.mocks.queue.getJobs();
		expect(jobs.some((j) => j.name === "article:published")).toBe(true);
		const publishJob = jobs.find((j) => j.name === "article:published");
		expect(publishJob?.payload.articleId).toBe(article.id);

		// Verify publication was logged
		expect(setup.cms.mocks.logger.wasLogged("info", "Article published")).toBe(
			true,
		);

		// 5. Retrieve article with author relation
		const publishedArticle = await articlesCrud.findOne(
			{
				where: { id: article.id },
				with: { author: true },
			},
			ctx,
		);

		expect(publishedArticle?.status).toBe("published");
		expect((publishedArticle?.author as any)?.name).toBe("Jane Doe");
		expect((publishedArticle?.featuredImage as any)?.url).toBe(
			"https://cdn.example.com/images/typescript-hero.jpg",
		);

		// 6. Check version history
		const versions = await articlesCrud.findVersions({ id: article.id }, ctx);
		expect(versions.length).toBe(3); // create + 2 updates
		expect(versions[0].versionOperation).toBe("create");
		expect(versions[versions.length - 1].versionOperation).toBe("update");

		// 7. Soft delete the article
		await articlesCrud.deleteById({ id: article.id }, ctx);

		// Verify deletion job was queued
		const jobsAfterDelete = setup.cms.mocks.queue.getJobs();
		expect(jobsAfterDelete.some((j) => j.name === "article:deleted")).toBe(
			true,
		);

		// Verify article is hidden from queries
		const deletedArticle = await articlesCrud.findOne(
			{ where: { id: article.id } },
			ctx,
		);
		expect(deletedArticle).toBeNull();
	});

	it("handles many-to-many relationships with tags", async () => {
		const ctx = createTestContext();

		// Create author and article
		const author = await setup.cms.api.collections.authors.create(
			{
				id: crypto.randomUUID(),
				name: "John Smith",
				email: "john@example.com",
			},
			ctx,
		);

		const article = await setup.cms.api.collections.articles.create(
			{
				id: crypto.randomUUID(),
				author: author.id,
				title: "Advanced Patterns",
				slug: "advanced-patterns",
			},
			ctx,
		);

		// Create tags
		const tagsCrud = setup.cms.api.collections.tags;
		const tag1 = await tagsCrud.create(
			{ id: crypto.randomUUID(), name: "Architecture" },
			ctx,
		);
		const tag2 = await tagsCrud.create(
			{ id: crypto.randomUUID(), name: "Design" },
			ctx,
		);

		// Link tags via junction table
		const articleTagsCrud = setup.cms.api.collections.article_tags;
		await articleTagsCrud.create(
			{
				id: crypto.randomUUID(),
				article: article.id,
				tag: tag1.id,
			},
			ctx,
		);
		await articleTagsCrud.create(
			{
				id: crypto.randomUUID(),
				article: article.id,
				tag: tag2.id,
			},
			ctx,
		);

		// Query article with tags
		const fetchedArticle = await setup.cms.api.collections.articles.findOne(
			{
				where: { id: article.id },
				with: { tags: true },
			},
			ctx,
		);

		expect(fetchedArticle?.tags).toHaveLength(2);
		const tagNames = fetchedArticle?.tags?.map((t: any) => t.name).sort();
		expect(tagNames).toEqual(["Architecture", "Design"]);

		// Query tag with articles
		const fetchedTag = await tagsCrud.findOne(
			{
				where: { id: tag1.id },
				with: { articles: true },
			},
			ctx,
		);

		expect(fetchedTag?.articles).toHaveLength(1);
		expect((fetchedTag?.articles as any)?.[0].title).toBe("Advanced Patterns");
	});

	it("supports nested writes for relations", async () => {
		const ctx = createTestContext();

		// Create author
		const authorsCrud = setup.cms.api.collections.authors;
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "John Smith",
				email: "john@example.com",
			},
			ctx,
		);

		// Create article with nested tag creation
		const articlesCrud = setup.cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author.id,
				title: "Advanced React Patterns",
				slug: "advanced-react-patterns",
				status: "published",
				tags: {
					create: [
						{ name: "React" },
						{ name: "JavaScript" },
						{ name: "Frontend" },
					],
				},
			} as any, // as any for nested mutation - type support coming later
			ctx,
		);

		// Retrieve article with tags
		const articleWithTags = await articlesCrud.findOne(
			{
				where: { id: article.id },
				with: { tags: true },
			},
			ctx,
		);

		expect(articleWithTags?.tags).toHaveLength(3);
		expect(articleWithTags?.tags.map((t: any) => t.name)).toContain("React");
		expect(articleWithTags?.tags.map((t: any) => t.name)).toContain(
			"JavaScript",
		);
		expect(articleWithTags?.tags.map((t: any) => t.name)).toContain("Frontend");

		// Create another article with existing tags
		const tagsCrud = setup.cms.api.collections.tags;
		const reactTag = await tagsCrud.findOne({ where: { name: "React" } }, ctx);

		expect(reactTag).not.toBeNull();
		if (!reactTag) return;

		const article2 = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author.id,
				title: "React Hooks Deep Dive",
				slug: "react-hooks-deep-dive",
				tags: {
					connect: [{ id: reactTag.id }],
					create: [{ name: "Hooks" }],
				},
			} as any, // as any for nested mutation - type support coming later
			ctx,
		);

		// Verify second article has correct tags
		const article2WithTags = await articlesCrud.findOne(
			{
				where: { id: article2.id },
				with: { tags: true },
			},
			ctx,
		);

		expect(article2WithTags?.tags).toHaveLength(2);
		expect(article2WithTags?.tags.map((t: any) => t.name)).toContain("React");
		expect(article2WithTags?.tags.map((t: any) => t.name)).toContain("Hooks");
	});

	it("filters and sorts across relations", async () => {
		const ctx = createTestContext();

		// Create multiple authors
		const authorsCrud = setup.cms.api.collections.authors;
		const author1 = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "Alice",
				email: "alice@example.com",
			},
			ctx,
		);
		const author2 = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "Bob",
				email: "bob@example.com",
			},
			ctx,
		);

		// Create articles for different authors
		const articlesCrud = setup.cms.api.collections.articles;
		await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author1.id,
				title: "Alice Post 1",
				slug: "alice-post-1",
				status: "published",
				viewCount: 100,
			},
			ctx,
		);
		await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author1.id,
				title: "Alice Post 2",
				slug: "alice-post-2",
				status: "published",
				viewCount: 50,
			},
			ctx,
		);
		await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author2.id,
				title: "Bob Post 1",
				slug: "bob-post-1",
				status: "published",
				viewCount: 200,
			},
			ctx,
		);

		// Find all published articles by Alice
		const aliceArticles = await articlesCrud.find(
			{
				where: {
					author: author1.id, // FK column key is field name with unified API
					status: "published",
				},
				orderBy: { viewCount: "desc" },
			},
			ctx,
		);

		expect(aliceArticles.docs.length).toBe(2);
		expect(aliceArticles.totalDocs).toBe(2);
		expect(aliceArticles.docs[0].title).toBe("Alice Post 1"); // 100 views
		expect(aliceArticles.docs[1].title).toBe("Alice Post 2"); // 50 views

		// Find top article overall
		const topArticle = await articlesCrud.findOne(
			{
				where: { status: "published" },
				orderBy: { viewCount: "desc" },
			},
			ctx,
		);

		expect(topArticle?.title).toBe("Bob Post 1"); // 200 views
	});

	it("handles access control with system and user modes", async () => {
		const authorsCrud = setup.cms.api.collections.authors;

		// Create author in system mode
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "System Author",
				email: "system@example.com",
			},
			createTestContext({ accessMode: "system" }),
		);

		expect(author.name).toBe("System Author");

		// Query in user mode should work for reads (default access)
		const found = await authorsCrud.findOne(
			{ where: { id: author.id } },
			createTestContext({ accessMode: "user" }),
		);

		expect(found?.name).toBe("System Author");
	});

	it("tracks complete audit trail with versioning", async () => {
		const ctx = createTestContext();

		// Create author and article
		const authorsCrud = setup.cms.api.collections.authors;
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "Versioned Author",
				email: "version@example.com",
			},
			ctx,
		);

		const articlesCrud = setup.cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				author: author.id,
				title: "Version 1",
				slug: "version-1",
				status: "draft",
			},
			ctx,
		);

		// Make several updates
		await articlesCrud.updateById(
			{
				id: article.id,
				data: { title: "Version 2", status: "review" },
			},
			ctx,
		);

		await articlesCrud.updateById(
			{
				id: article.id,
				data: { title: "Version 3", status: "published" },
			},
			ctx,
		);

		await articlesCrud.updateById(
			{
				id: article.id,
				data: { viewCount: 100 },
			},
			ctx,
		);

		// Check version history
		const versions = await articlesCrud.findVersions({ id: article.id }, ctx);

		expect(versions).toHaveLength(4); // 1 create + 3 updates
		expect(versions[0].versionOperation).toBe("create");
		expect(versions[0]).toMatchObject({
			title: "Version 1",
			status: "draft",
		});
		expect(versions[1].versionOperation).toBe("update");
		expect(versions[2].versionOperation).toBe("update");
		expect(versions[3].versionOperation).toBe("update");

		// Final state should be version 3 with 100 views
		const current = await articlesCrud.findOne(
			{ where: { id: article.id } },
			ctx,
		);
		expect(current?.title).toBe("Version 3");
		expect(current?.status).toBe("published");
		expect(current?.viewCount).toBe(100);
	});
});
