import { describe, expect, it, spyOn } from "bun:test";

import { tryGetContext } from "questpie";
import { z } from "zod";

import {
	executeAction,
	getActionsConfig,
} from "#questpie/admin/server/modules/admin/routes/execute-action";

describe("admin execute action runtime shape", () => {
	it("finds actions from app.getCollections when app.state.collections is absent", async () => {
		const collectionCruds = { user: { marker: "collections" } };
		const globalCruds = { settings: { marker: "globals" } };
		const calls: Array<Record<string, unknown>> = [];
		const runtimeContexts: unknown[] = [];
		const app = {
			state: {},
			collections: collectionCruds,
			globals: globalCruds,
			getCollections() {
				return {
					user: {
						state: {
							adminActions: {
								builtin: [],
								custom: [
									{
										id: "createUser",
										label: "Create user",
										handler: (ctx: Record<string, unknown>) => {
											calls.push(ctx);
											runtimeContexts.push(tryGetContext());
											return { type: "success" };
										},
									},
								],
							},
						},
					},
				};
			},
		};

		const config = getActionsConfig(app as any, "user");

		expect(config?.custom).toHaveLength(1);
		expect(config?.custom[0]).not.toHaveProperty("handler");

		const result = await executeAction(app as any, {
			collection: "user",
			actionId: "createUser",
			itemId: "user-1",
			itemIds: ["user-1", "user-2"],
			expectedVersion: 3,
			expectedVersions: [
				{ id: "user-1", expectedVersion: 3 },
				{ id: "user-2", expectedVersion: 7 },
			],
			data: { email: "admin@example.com" },
		});

		expect(result.success).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.collections).toBe(collectionCruds);
		expect(calls[0]?.globals).toBe(globalCruds);
		expect(calls[0]?.expectedVersion).toBe(3);
		expect(calls[0]?.expectedVersions).toEqual([
			{ id: "user-1", expectedVersion: 3 },
			{ id: "user-2", expectedVersion: 7 },
		]);
		expect((runtimeContexts[0] as any)?.accessMode).toBe("user");
	});

	it("runs built-in create through the collection CRUD API", async () => {
		let createCall:
			| { data: Record<string, unknown>; context: Record<string, unknown> }
			| undefined;
		const app = {
			state: {},
			db: { marker: "db" },
			getCollections() {
				return { posts: { state: {} } };
			},
			collections: {
				posts: {
					create: async (
						data: Record<string, unknown>,
						context: Record<string, unknown>,
					) => {
						createCall = { data, context };
						return { id: "post-1" };
					},
				},
			},
		};

		const result = await executeAction(app as any, {
			collection: "posts",
			actionId: "create",
			data: { title: "Hello" },
			locale: "en",
		});

		expect(result.success).toBe(true);
		expect(createCall?.data).toEqual({ title: "Hello" });
		expect(createCall?.context.db).toBe(app.db);
		expect(createCall?.context.accessMode).toBe("user");
		expect(result.result?.effects?.redirect).toBe(
			"/admin/collections/posts/post-1",
		);
	});

	it("lets a custom action preserve the expected version at its generated CRUD mutation", async () => {
		let mutated = false;
		const errorLog = spyOn(console, "error").mockImplementation(() => {});
		const app = {
			state: {},
			collections: {
				posts: {
					updateById: async (params: Record<string, unknown>) => {
						if (params.expectedVersion !== 4) {
							throw Object.assign(new Error("Optimistic lock conflict"), {
								code: "CONFLICT",
							});
						}
						mutated = true;
					},
				},
			},
			globals: {},
			getCollections() {
				return {
					posts: {
						state: {
							adminActions: {
								builtin: [],
								custom: [
									{
										id: "publish",
										label: "Publish",
										handler: async (ctx: Record<string, any>) => {
											await ctx.collections.posts.updateById({
												id: ctx.itemId,
												data: { status: "published" },
												expectedVersion: ctx.expectedVersion,
											});
											return { type: "success" };
										},
									},
								],
							},
						},
					},
				};
			},
		};

		const stale = await executeAction(app as any, {
			collection: "posts",
			actionId: "publish",
			itemId: "post-1",
			expectedVersion: 3,
		});
		expect(stale.success).toBe(false);
		expect(mutated).toBe(false);

		const current = await executeAction(app as any, {
			collection: "posts",
			actionId: "publish",
			itemId: "post-1",
			expectedVersion: 4,
		});
		expect(current.success).toBe(true);
		expect(mutated).toBe(true);
		errorLog.mockRestore();
	});

	it("forwards optimistic-lock inputs through every built-in mutation", async () => {
		const calls: Array<{ operation: string; params: Record<string, unknown> }> =
			[];
		const app = {
			state: {},
			getCollections() {
				return {
					posts: {
						state: {
							options: {
								optimisticLock: { field: "version", required: true },
							},
						},
					},
				};
			},
			collections: {
				posts: {
					updateById: async (params: Record<string, unknown>) => {
						calls.push({ operation: "save", params });
					},
					deleteById: async (params: Record<string, unknown>) => {
						calls.push({ operation: "delete", params });
					},
					deleteMany: async (params: Record<string, unknown>) => {
						calls.push({ operation: "deleteMany", params });
					},
					restoreById: async (params: Record<string, unknown>) => {
						calls.push({ operation: "restore", params });
					},
				},
			},
		};
		const expectedVersions = [
			{ id: "post-1", expectedVersion: 3 },
			{ id: "post-2", expectedVersion: 7 },
		];

		await executeAction(app as any, {
			collection: "posts",
			actionId: "save",
			itemId: "post-1",
			expectedVersion: 3,
			data: { title: "Updated" },
		});
		await executeAction(app as any, {
			collection: "posts",
			actionId: "delete",
			itemId: "post-1",
			expectedVersion: 4,
		});
		await executeAction(app as any, {
			collection: "posts",
			actionId: "deleteMany",
			itemIds: ["post-1", "post-2"],
			expectedVersions,
		});
		await executeAction(app as any, {
			collection: "posts",
			actionId: "restore",
			itemId: "post-1",
			expectedVersion: 5,
		});
		await executeAction(app as any, {
			collection: "posts",
			actionId: "restoreMany",
			itemIds: ["post-1", "post-2"],
			expectedVersions,
		});

		expect(calls).toEqual([
			{
				operation: "save",
				params: {
					id: "post-1",
					data: { title: "Updated" },
					expectedVersion: 3,
				},
			},
			{
				operation: "delete",
				params: { id: "post-1", expectedVersion: 4 },
			},
			{
				operation: "deleteMany",
				params: {
					where: { id: { in: ["post-1", "post-2"] } },
					expectedVersions,
				},
			},
			{
				operation: "restore",
				params: { id: "post-1", expectedVersion: 5 },
			},
			{
				operation: "restore",
				params: { id: "post-1", expectedVersion: 3 },
			},
			{
				operation: "restore",
				params: { id: "post-2", expectedVersion: 7 },
			},
		]);
	});

	it("validates custom action form field definitions with their Zod schemas", async () => {
		let called = false;
		const app = {
			state: {},
			getCollections() {
				return {
					users: {
						state: {
							adminActions: {
								builtin: [],
								custom: [
									{
										id: "invite",
										label: "Invite",
										form: {
											title: "Invite user",
											fields: {
												email: {
													_state: { notNull: true },
													getMetadata: () => ({
														type: "email",
														required: true,
													}),
													toZodSchema: () => z.string().email(),
												},
											},
										},
										handler: () => {
											called = true;
											return { type: "success" };
										},
									},
								],
							},
						},
					},
				};
			},
		};

		const result = await executeAction(app as any, {
			collection: "users",
			actionId: "invite",
			data: { email: "not-an-email" },
		});

		expect(result.success).toBe(false);
		expect(result.result?.type).toBe("error");
		expect(result.result?.errors?.email).toContain("email");
		expect(called).toBe(false);
	});

	it("does not reject valid falsy action form values", async () => {
		const received: Record<string, unknown>[] = [];
		const app = {
			state: {},
			getCollections() {
				return {
					settings: {
						state: {
							adminActions: {
								builtin: [],
								custom: [
									{
										id: "save",
										label: "Save",
										form: {
											title: "Save",
											fields: {
												title: {
													_state: { notNull: true },
													getMetadata: () => ({
														type: "text",
														required: true,
													}),
													toZodSchema: () => z.string(),
												},
												count: {
													_state: { notNull: true },
													getMetadata: () => ({
														type: "number",
														required: true,
													}),
													toZodSchema: () => z.number(),
												},
												enabled: {
													_state: { notNull: true },
													getMetadata: () => ({
														type: "boolean",
														required: true,
													}),
													toZodSchema: () => z.boolean(),
												},
											},
										},
										handler: (ctx: { data: Record<string, unknown> }) => {
											received.push(ctx.data);
											return { type: "success" };
										},
									},
								],
							},
						},
					},
				};
			},
		};

		const result = await executeAction(app as any, {
			collection: "settings",
			actionId: "save",
			data: { title: "", count: 0, enabled: false },
		});

		expect(result.success).toBe(true);
		expect(received).toEqual([{ title: "", count: 0, enabled: false }]);
	});

	it("exposes the full app service surface (queue/email) to custom action handlers (B2)", async () => {
		const sideEffects: string[] = [];
		const fakeQueue = {
			publish: async (name: string) => {
				sideEffects.push(`queue:${name}`);
			},
		};
		const fakeEmail = {
			sendTemplate: async () => {
				sideEffects.push("email");
			},
		};
		const capturedCtx: Record<string, unknown>[] = [];
		const app = {
			state: {},
			queue: fakeQueue,
			email: fakeEmail,
			collections: {},
			globals: {},
			getCollections() {
				return {
					orders: {
						state: {
							adminActions: {
								builtin: [],
								custom: [
									{
										id: "fulfill",
										label: "Fulfill",
										handler: async (ctx: any) => {
											capturedCtx.push(ctx);
											// Side-effects straight from the explicit ctx — `queue`
											// and `email` were undefined before B2 (the action ctx
											// omitted them, forcing a stage→afterChange workaround).
											await ctx.queue.publish("fulfill-order");
											await ctx.email.sendTemplate({});
											return { type: "success" };
										},
									},
								],
							},
						},
					},
				};
			},
		};

		const result = await executeAction(app as any, {
			collection: "orders",
			actionId: "fulfill",
			data: {},
		});

		expect(result.success).toBe(true);
		expect(capturedCtx[0]?.queue).toBe(fakeQueue);
		expect(capturedCtx[0]?.email).toBe(fakeEmail);
		expect(sideEffects).toEqual(["queue:fulfill-order", "email"]);
	});
});
