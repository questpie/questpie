import { afterEach, describe, expect, it } from "bun:test";

import { Hono } from "hono";

import { route } from "../../questpie/src/exports/index.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	questpieHono,
	questpieMiddleware,
	type QuestpieVariables,
} from "../src/server.js";

describe("hono adapter composition", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("shares one immutable authority context with questpieMiddleware", async () => {
		const inspect = route()
			.get()
			.raw()
			.handler(({ session, permissions }) =>
				Response.json({
					userId: (session?.user as { id?: string } | undefined)?.id ?? null,
					permissionCount: (permissions as Set<string>).size,
				}),
			);
		const setup = await buildMockApp({
			routes: { inspect },
			config: {
				app: {
					context: () => ({ permissions: new Set(["read"]) }),
				},
			},
		});
		cleanup = setup.cleanup;
		const app = setup.app;
		const createContext = app.createContext.bind(app);
		let contextCreations = 0;
		app.createContext = ((...args: Parameters<typeof app.createContext>) => {
			contextCreations++;
			return createContext(...args);
		}) as typeof app.createContext;

		const native = new Hono<{
			Variables: QuestpieVariables<typeof app>;
		}>()
			.use("*", questpieMiddleware(app))
			.use("*", async (context, next) => {
				context.set("user", { id: "mutable-user-must-not-be-authority" });
				context.get("appContext").session = {
					user: { id: "mutable-context-must-not-be-authority" },
					session: { id: "forged-session" },
				} as never;
				(context.get("appContext").permissions as Set<string>).clear();
				await next();
			})
			.route("/", questpieHono(app, { basePath: "/api" }));

		const response = await native.request("http://localhost/api/inspect");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			userId: null,
			permissionCount: 1,
		});
		expect(contextCreations).toBe(1);
	});
});
