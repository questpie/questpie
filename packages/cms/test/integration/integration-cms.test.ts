import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import {
	text,
	varchar,
	uuid as uuidCol,
	jsonb,
	integer,
	timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
	closeTestDb,
	createTestDb,
	runTestDbMigrations,
} from "../utils/test-db";
import { createTestCms } from "../utils/test-cms";
import { createTestContext } from "../utils/test-context";
import { createMockServices } from "../utils/test-services";
import { defineCollection } from "#questpie/cms/server/index.js";

describe("integration: full CMS workflow", () => {
	let db: any;
	let client: any;
	let cms: ReturnType<typeof createTestCms>;
	let services: any;

	beforeEach(async () => {
		// Define authors collection
		const authors = defineCollection("authors")
			.fields({
				name: text("name").notNull(),
				email: varchar("email", { length: 255 }).notNull(),
				bio: text("bio"),
			})
			.title(({ table }) => sql`${table.name}`)
			.hooks({
				afterCreate: async ({ data, cms }) => {
					// Send welcome email when author is created
					await cms.email?.send({
						to: data.email,
						subject: "Welcome to our platform!",
						text: `Hi ${data.name}, welcome!`,
					});
				},
			})
			.build();

		// Define articles collection with relations
		const articles = defineCollection("articles")
			.fields({
				authorId: uuidCol("author_id")
					.notNull()
					.references(() => authors.table.id),
				title: text("title").notNull(),
				slug: varchar("slug", { length: 255 }).notNull(),
				content: jsonb("content"),
				featuredImage: jsonb("featured_image"),
				status: varchar("status", { length: 50 }),
				viewCount: integer("view_count"),
				publishedAt: timestamp("published_at", { mode: "date" }),
			})
			.title(({ table }) => sql`${table.title}`)
			.relations(({ one, manyToMany }) => ({
				author: one("authors", {
					fields: ["authorId"] as any,
					references: ["id"] as any,
				}),
				tags: manyToMany("tags", {
					through: "article_tags",
					sourceField: "articleId",
					targetField: "tagId",
				}),
			}))
			.options({
				timestamps: true,
				softDelete: true,
				versioning: true,
			})
			.hooks({
				beforeCreate: async ({ data }) => {
					// Auto-generate slug if not provided
					if (!data.slug && data.title) {
						data.slug = data.title
							.toLowerCase()
							.replace(/\s+/g, "-")
							.replace(/[^a-z0-9-]/g, "");
					}
					return data;
				},
				afterCreate: async ({ data, cms }) => {
					await cms.logger?.info("Article created", {
						id: data.id,
						title: data.title,
					});
				},
				afterUpdate: async ({ data, original, cms }) => {
					// Track publication
					if (original.status !== "published" && data.status === "published") {
						await cms.queue?.publish("article:published", {
							articleId: data.id,
							title: data.title,
							authorId: data.authorId,
						});

						await cms.logger?.info("Article published", {
							id: data.id,
							title: data.title,
						});
					}
				},
				afterDelete: async ({ data, cms }) => {
					await cms.queue?.publish("article:deleted", { articleId: data.id });
				},
			})
			.build();

		// Define tags collection
		const tags = defineCollection("tags")
			.fields({
				name: text("name").notNull(),
			})
			.title(({ table }) => sql`${table.name}`)
			.relations(({ manyToMany }) => ({
				articles: manyToMany("articles", {
					through: "article_tags",
					sourceField: "tagId",
					targetField: "articleId",
				}),
			}))
			.build();

		// Define junction table
		const articleTags = defineCollection("article_tags")
			.fields({
				articleId: uuidCol("article_id")
					.notNull()
					.references(() => articles.table.id),
				tagId: uuidCol("tag_id")
					.notNull()
					.references(() => tags.table.id),
			})
			.build();

		const setup = await createTestDb();
		db = setup.db;
		client = setup.client;
		services = createMockServices();
		cms = createTestCms([authors, articles, tags, articleTags], db, services);
		await runTestDbMigrations(cms);
	});

	afterEach(async () => {
		await closeTestDb(client);
	});

	it("complete blog workflow: create author, create article, publish, track metrics", async () => {
		const ctx = createTestContext(services);

		// 1. Create an author
		const authorsCrud = cms.api.collections.authors;
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
		expect(services.email.__sent).toHaveLength(1);
		expect(services.email.__sent[0].to).toBe("jane@example.com");
		expect(services.email.__sent[0].subject).toBe("Welcome to our platform!");

		// 2. Create a draft article
		const articlesCrud = cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				authorId: author.id,
				title: "Getting Started with TypeScript",
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
		expect(
			services.logger.__logs.some((l: any) => l.message === "Article created"),
		).toBe(true);

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
		expect(
			services.queue.__jobs.some((j: any) => j.name === "article:published"),
		).toBe(true);
		const publishJob = services.queue.__jobs.find(
			(j: any) => j.name === "article:published",
		);
		expect(publishJob?.payload.articleId).toBe(article.id);

		// Verify publication was logged
		expect(
			services.logger.__logs.some(
				(l: any) => l.message === "Article published",
			),
		).toBe(true);

		// 5. Retrieve article with author relation
		const publishedArticle = await articlesCrud.findOne(
			{
				where: { id: article.id },
				with: { author: true },
			},
			ctx,
		);

		expect(publishedArticle?.status).toBe("published");
		expect(publishedArticle?.author?.name).toBe("Jane Doe");
		expect(publishedArticle?.featuredImage?.url).toBe(
			"https://cdn.example.com/images/typescript-hero.jpg",
		);

		// 6. Check version history
		const versions = await articlesCrud.findVersions({ id: article.id }, ctx);
		expect(versions.length).toBe(3); // create + 2 updates
		expect(versions[0].operation).toBe("create");
		expect(versions[versions.length - 1].operation).toBe("update");

		// 7. Soft delete the article
		await articlesCrud.deleteById({ id: article.id }, ctx);

		// Verify deletion job was queued
		expect(
			services.queue.__jobs.some((j: any) => j.name === "article:deleted"),
		).toBe(true);

		// Verify article is hidden from queries
		const deletedArticle = await articlesCrud.findOne(
			{ where: { id: article.id } },
			ctx,
		);
		expect(deletedArticle).toBeNull();
	});

	it("handles many-to-many relationships with tags", async () => {
		const ctx = createTestContext(services);

		// Create author
		const authorsCrud = cms.api.collections.authors;
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "John Smith",
				email: "john@example.com",
			},
			ctx,
		);

		// Create article with nested tag creation
		const articlesCrud = cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				authorId: author.id,
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
			},
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
		const tagsCrud = cms.api.collections.tags;
		const reactTag = await tagsCrud.findOne({ where: { name: "React" } }, ctx);

		expect(reactTag).not.toBeNull();
		if (!reactTag) return;

		const article2 = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				authorId: author.id,
				title: "React Hooks Deep Dive",
				slug: "react-hooks-deep-dive",
				tags: {
					connect: [{ id: reactTag.id }],
					create: [{ name: "Hooks" }],
				},
			},
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
		const ctx = createTestContext(services);

		// Create multiple authors
		const authorsCrud = cms.api.collections.authors;
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
		const articlesCrud = cms.api.collections.articles;
		await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				authorId: author1.id,
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
				authorId: author1.id,
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
				authorId: author2.id,
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
					authorId: author1.id,
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
		const _ctx = createTestContext(services);
		_ctx;
		const authorsCrud = cms.api.collections.authors;

		// Create author in system mode
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "System Author",
				email: "system@example.com",
			},
			createTestContext({ ...services, accessMode: "system" }),
		);

		expect(author.name).toBe("System Author");

		// Query in user mode should work for reads (default access)
		const found = await authorsCrud.findOne(
			{ where: { id: author.id } },
			createTestContext({ ...services, accessMode: "user" }),
		);

		expect(found?.name).toBe("System Author");
	});

	it("tracks complete audit trail with versioning", async () => {
		const ctx = createTestContext(services);

		// Create author and article
		const authorsCrud = cms.api.collections.authors;
		const author = await authorsCrud.create(
			{
				id: crypto.randomUUID(),
				name: "Versioned Author",
				email: "version@example.com",
			},
			ctx,
		);

		const articlesCrud = cms.api.collections.articles;
		const article = await articlesCrud.create(
			{
				id: crypto.randomUUID(),
				authorId: author.id,
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
		expect(versions[0].operation).toBe("create");
		expect(versions[0].data).toMatchObject({
			title: "Version 1",
			status: "draft",
		});
		expect(versions[1].operation).toBe("update");
		expect(versions[2].operation).toBe("update");
		expect(versions[3].operation).toBe("update");

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
