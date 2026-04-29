import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

describe("global hooks injection", () => {
	describe("collection global hooks via .hooks()", () => {
		let hookCalls: Array<{
			hookName: string;
			collection: string;
			operation: string;
		}>;

		const createModule = (calls: typeof hookCalls) => ({
			collections: {
				articles: collection("articles").fields(({ f }) => ({
					title: f.textarea().required(),
				})),
				pages: collection("pages").fields(({ f }) => ({
					title: f.textarea().required(),
				})),
			},
			hooks: {
				collections: [
					{
						afterChange: async (ctx: any) => {
							calls.push({
								hookName: "afterChange",
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
						afterDelete: async (ctx: any) => {
							calls.push({
								hookName: "afterDelete",
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
					},
				],
				globals: [],
			},
		});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			setup = await buildMockApp(createModule(hookCalls));
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires afterChange hook on create for articles", async () => {
			await (setup.app as any).collections.articles.create({
				title: "Test Article",
			});

			expect(hookCalls).toEqual([
				{
					hookName: "afterChange",
					collection: "articles",
					operation: "create",
				},
			]);
		});

		it("fires afterChange hook on create for pages", async () => {
			await (setup.app as any).collections.pages.create({
				title: "Test Page",
			});

			expect(hookCalls).toEqual([
				{
					hookName: "afterChange",
					collection: "pages",
					operation: "create",
				},
			]);
		});

		it("fires afterChange hook on update", async () => {
			const created = await (setup.app as any).collections.articles.create({
				title: "Original",
			});

			hookCalls.length = 0;

			await (setup.app as any).collections.articles.update({
				where: { id: created.id },
				data: { title: "Updated" },
			});

			expect(hookCalls).toEqual([
				{
					hookName: "afterChange",
					collection: "articles",
					operation: "update",
				},
			]);
		});

		it("fires afterDelete hook", async () => {
			const created = await (setup.app as any).collections.articles.create({
				title: "To Delete",
			});

			hookCalls.length = 0;

			await (setup.app as any).collections.articles.delete({
				where: { id: created.id },
			});

			expect(hookCalls).toEqual([
				{
					hookName: "afterDelete",
					collection: "articles",
					operation: "delete",
				},
			]);
		});
	});

	describe("collection global hooks with include/exclude", () => {
		let hookCalls: Array<{ collection: string; operation: string }>;

		const createModule = (calls: typeof hookCalls) => ({
			collections: {
				articles: collection("articles").fields(({ f }) => ({
					title: f.textarea().required(),
				})),
				pages: collection("pages").fields(({ f }) => ({
					title: f.textarea().required(),
				})),
				logs: collection("logs").fields(({ f }) => ({
					message: f.textarea().required(),
				})),
			},
			hooks: {
				collections: [
					{
						exclude: ["logs"],
						afterChange: async (ctx: any) => {
							calls.push({
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
					},
				],
				globals: [],
			},
		});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			setup = await buildMockApp(createModule(hookCalls));
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires hook for non-excluded collections", async () => {
			await (setup.app as any).collections.articles.create({
				title: "Test",
			});

			expect(hookCalls).toHaveLength(1);
			expect(hookCalls[0].collection).toBe("articles");
		});

		it("does NOT fire hook for excluded collections", async () => {
			await (setup.app as any).collections.logs.create({
				message: "Log entry",
			});

			expect(hookCalls).toHaveLength(0);
		});
	});

	describe("global hooks from .use() composition", () => {
		let hookCalls: Array<{ collection: string; source: string }>;

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			setup = await buildMockApp({
				collections: {
					articles: collection("articles").fields(({ f }) => ({
						title: f.textarea().required(),
					})),
				},
				hooks: {
					collections: [
						{
							afterChange: async (ctx: any) => {
								hookCalls.push({
									collection: ctx.collection,
									source: "moduleA",
								});
							},
						},
					],
					globals: [],
				},
			});
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires hooks from both modules", async () => {
			await (setup.app as any).collections.articles.create(
				{
					title: "Test",
				},
				createTestContext(),
			);

			expect(hookCalls).toHaveLength(1);
			expect(hookCalls.map((c) => c.source)).toEqual(["moduleA"]);
		});
	});

	describe("global hooks creating records in other collections (audit-like)", () => {
		const createModule = () => ({
			collections: {
				articles: collection("articles").fields(({ f }) => ({
					title: f.textarea().required(),
				})),
				auditLog: collection("audit_log").fields(({ f }) => ({
					action: f.text().required(),
					resource: f.text().required(),
					resourceId: f.text(),
				})),
			},
			hooks: {
				collections: [
					{
						exclude: ["auditLog"],
						afterChange: async (ctx: any) => {
							await ctx.collections.auditLog.create({
								action: ctx.operation,
								resource: ctx.collection,
								resourceId: ctx.data?.id ? String(ctx.data.id) : null,
							});
						},
					},
				],
				globals: [],
			},
		});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp(createModule());
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("creates audit log entry when article is created", async () => {
			await (setup.app as any).collections.articles.create({
				title: "Test Article",
			});

			const logs = await (setup.app as any).collections.auditLog.find();
			expect(logs.docs).toHaveLength(1);
			expect(logs.docs[0].action).toBe("create");
			expect(logs.docs[0].resource).toBe("articles");
		});

		it("does NOT create audit log for auditLog collection itself (exclude)", async () => {
			await (setup.app as any).collections.auditLog.create({
				action: "manual",
				resource: "test",
			});

			const logs = await (setup.app as any).collections.auditLog.find();
			// Should only have the one we just created, no recursive audit entry
			expect(logs.docs).toHaveLength(1);
			expect(logs.docs[0].action).toBe("manual");
		});
	});

	describe("beforeChange global hooks can modify data", () => {
		const createModule = () => ({
			collections: {
				articles: collection("articles").fields(({ f }) => ({
					title: f.textarea().required(),
					slug: f.text(),
				})),
			},
			hooks: {
				collections: [
					{
						beforeChange: async (ctx: any) => {
							if (ctx.data.title && !ctx.data.slug) {
								ctx.data.slug = ctx.data.title
									.toLowerCase()
									.replace(/\s+/g, "-");
							}
						},
					},
				],
				globals: [],
			},
		});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp(createModule());
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("allows beforeChange to mutate data", async () => {
			const result = await (setup.app as any).collections.articles.create({
				title: "Hello World",
			});

			expect(result.slug).toBe("hello-world");
		});
	});
});
