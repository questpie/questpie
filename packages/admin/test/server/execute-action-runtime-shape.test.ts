import { describe, expect, it } from "bun:test";

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
});
