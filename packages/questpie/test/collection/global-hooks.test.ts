import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-global-hooks" }).fields(defaultFields);

describe("global hooks injection", () => {
	describe("collection global hooks via .hooks()", () => {
		let hookCalls: Array<{
			hookName: string;
			collection: string;
			operation: string;
		}>;

		const createModule = (calls: typeof hookCalls) =>
			q
				.collections({
					articles: q.collection("articles").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
					pages: q.collection("pages").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
				})
				.hooks({
					collections: {
						afterChange: async (ctx) => {
							calls.push({
								hookName: "afterChange",
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
						afterDelete: async (ctx) => {
							calls.push({
								hookName: "afterDelete",
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
					},
				});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			const module = createModule(hookCalls);
			setup = await buildMockApp(module);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires afterChange hook on create for articles", async () => {
			await (setup.app as any).api.collections.articles.create({
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
			await (setup.app as any).api.collections.pages.create({
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
			const created = await (
				setup.app as any
			).api.collections.articles.create({
				title: "Original",
			});

			hookCalls.length = 0;

			await (setup.app as any).api.collections.articles.update({
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
			const created = await (
				setup.app as any
			).api.collections.articles.create({
				title: "To Delete",
			});

			hookCalls.length = 0;

			await (setup.app as any).api.collections.articles.delete({
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

		const createModule = (calls: typeof hookCalls) =>
			q
				.collections({
					articles: q.collection("articles").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
					pages: q.collection("pages").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
					logs: q.collection("logs").fields((f) => ({
						message: f.textarea({ required: true }),
					})),
				})
				.hooks({
					collections: {
						exclude: ["logs"],
						afterChange: async (ctx) => {
							calls.push({
								collection: ctx.collection,
								operation: ctx.operation,
							});
						},
					},
				});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			const module = createModule(hookCalls);
			setup = await buildMockApp(module);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires hook for non-excluded collections", async () => {
			await (setup.app as any).api.collections.articles.create({
				title: "Test",
			});

			expect(hookCalls).toHaveLength(1);
			expect(hookCalls[0].collection).toBe("articles");
		});

		it("does NOT fire hook for excluded collections", async () => {
			await (setup.app as any).api.collections.logs.create({
				message: "Log entry",
			});

			expect(hookCalls).toHaveLength(0);
		});
	});

	describe("global hooks from .use() composition", () => {
		let hookCalls: Array<{ collection: string; source: string }>;

		const createModuleA = (calls: typeof hookCalls) =>
			q.hooks({
				collections: {
					afterChange: async (ctx) => {
						calls.push({
							collection: ctx.collection,
							source: "moduleA",
						});
					},
				},
			});

		const createModuleB = (calls: typeof hookCalls) =>
			q.hooks({
				collections: {
					afterChange: async (ctx) => {
						calls.push({
							collection: ctx.collection,
							source: "moduleB",
						});
					},
				},
			});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			hookCalls = [];
			const moduleA = createModuleA(hookCalls);
			const moduleB = createModuleB(hookCalls);
			const module = q
				.collections({
					articles: q.collection("articles").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
				})
				.use(moduleA)
				.use(moduleB);

			setup = await buildMockApp(module);
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("fires hooks from both modules", async () => {
			await (setup.app as any).api.collections.articles.create({
				title: "Test",
			});

			expect(hookCalls).toHaveLength(2);
			expect(hookCalls.map((c) => c.source)).toEqual([
				"moduleA",
				"moduleB",
			]);
		});
	});

	describe("global hooks creating records in other collections (audit-like)", () => {
		const createModule = () =>
			q
				.collections({
					articles: q.collection("articles").fields((f) => ({
						title: f.textarea({ required: true }),
					})),
					auditLog: q.collection("audit_log").fields((f) => ({
						action: f.text({ required: true }),
						resource: f.text({ required: true }),
						resourceId: f.text(),
					})),
				})
				.hooks({
					collections: {
						exclude: ["auditLog"],
						afterChange: async (ctx) => {
							const app = ctx.app as any;
							await app.api.collections.auditLog.create({
								action: ctx.operation,
								resource: ctx.collection,
								resourceId: ctx.data?.id
									? String(ctx.data.id)
									: null,
							});
						},
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
			await (setup.app as any).api.collections.articles.create({
				title: "Test Article",
			});

			const logs = await (
				setup.app as any
			).api.collections.auditLog.find();
			expect(logs.docs).toHaveLength(1);
			expect(logs.docs[0].action).toBe("create");
			expect(logs.docs[0].resource).toBe("articles");
		});

		it("does NOT create audit log for auditLog collection itself (exclude)", async () => {
			await (setup.app as any).api.collections.auditLog.create({
				action: "manual",
				resource: "test",
			});

			const logs = await (
				setup.app as any
			).api.collections.auditLog.find();
			// Should only have the one we just created, no recursive audit entry
			expect(logs.docs).toHaveLength(1);
			expect(logs.docs[0].action).toBe("manual");
		});
	});

	describe("beforeChange global hooks can modify data", () => {
		const createModule = () =>
			q
				.collections({
					articles: q.collection("articles").fields((f) => ({
						title: f.textarea({ required: true }),
						slug: f.text(),
					})),
				})
				.hooks({
					collections: {
						beforeChange: async (ctx) => {
							if (ctx.data.title && !ctx.data.slug) {
								ctx.data.slug = ctx.data.title
									.toLowerCase()
									.replace(/\s+/g, "-");
							}
						},
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
			const result = await (
				setup.app as any
			).api.collections.articles.create({
				title: "Hello World",
			});

			expect(result.slug).toBe("hello-world");
		});
	});
});
