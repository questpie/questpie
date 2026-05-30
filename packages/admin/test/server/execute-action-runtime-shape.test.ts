import { describe, expect, it } from "bun:test";

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
			data: { email: "admin@example.com" },
		});

		expect(result.success).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.collections).toBe(collectionCruds);
		expect(calls[0]?.globals).toBe(globalCruds);
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
		expect(result.result?.effects?.redirect).toBe(
			"/admin/collections/posts/post-1",
		);
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
});
