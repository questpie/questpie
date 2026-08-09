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
		class NativeToken {
			constructor(readonly value: string) {}
		}
		const extensionCallback = () => "private";
		const extensionPromise = Promise.resolve("private");
		const extensionToken = new NativeToken("private");
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
					context: () => ({
						permissions: new Set(["read"]),
						extensionCallback,
						extensionPromise,
						extensionToken,
					}),
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
				const nativeContext = context.get("appContext");
				expect(nativeContext.extensionCallback).toBeUndefined();
				expect(nativeContext.extensionPromise).toBeUndefined();
				expect(nativeContext.extensionToken).toBeUndefined();
				context.set("user", { id: "mutable-user-must-not-be-authority" });
				nativeContext.session = {
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

	it("runs native middleware registered before and after the mount", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(() => new Response("pong"));
		const setup = await buildMockApp({ routes: { ping } });
		cleanup = setup.cleanup;
		const beforePaths: string[] = [];
		const afterPaths: string[] = [];
		const native = new Hono()
			.use("*", async (context, next) => {
				beforePaths.push(new URL(context.req.url).pathname);
				await next();
			})
			.route("/", questpieHono(setup.app, { basePath: "/api" }))
			.use("*", async (context, next) => {
				afterPaths.push(new URL(context.req.url).pathname);
				await next();
				context.header("x-native-after", "yes");
			})
			.get("/apiary", (context) => context.text("native sibling"));

		for (const path of ["/api", "/api/ping", "/api/x", "/apiary"]) {
			const response = await native.request(`http://localhost${path}`);
			expect(response.headers.get("x-native-after")).toBe("yes");
		}

		expect(beforePaths).toEqual(["/api", "/api/ping", "/api/x", "/apiary"]);
		expect(afterPaths).toEqual(["/api", "/api/ping", "/api/x", "/apiary"]);
	});
});
