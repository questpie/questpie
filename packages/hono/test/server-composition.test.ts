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

	it("keeps the complete legacy context separate from mount authority", async () => {
		class NativeToken {
			constructor(public value: string) {}
		}
		let extensionContexts = 0;
		const inspect = route()
			.get()
			.raw()
			.handler(
				async ({
					session,
					permissions,
					extensionCallback,
					extensionPromise,
					extensionToken,
					compatibilityService,
				}) =>
					Response.json({
						userId: (session?.user as { id?: string } | undefined)?.id ?? null,
						permissionCount: (permissions as Set<string>).size,
						callback: (extensionCallback as () => string)(),
						promise: await (extensionPromise as Promise<string>),
						token: (extensionToken as NativeToken).value,
						service: (
							compatibilityService as { execute: () => string }
						).execute(),
					}),
			);
		const setup = await buildMockApp({
			routes: { inspect },
			config: {
				app: {
					context: ({ request }) => {
						const id = ++extensionContexts;
						return {
							permissions: new Set([
								request.headers.get("x-authority") ?? "read",
							]),
							extensionCallback: () => `callback-${id}`,
							extensionPromise: Promise.resolve(`promise-${id}`),
							extensionToken: new NativeToken(`token-${id}`),
							compatibilityService: {
								execute: () => `service-${id}`,
							},
						};
					},
				},
			},
		});
		cleanup = setup.cleanup;
		const app = setup.app;
		app.auth = {
			api: {
				getSession: async () => ({
					user: { id: "original-user" },
					session: { id: "original-session" },
				}),
			},
		} as typeof app.auth;
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
				expect(nativeContext.db).toBeDefined();
				expect((nativeContext.extensionCallback as () => string)()).toBe(
					"callback-1",
				);
				expect(await (nativeContext.extensionPromise as Promise<string>)).toBe(
					"promise-1",
				);
				expect(nativeContext.extensionToken).toBeInstanceOf(NativeToken);
				expect(
					(
						nativeContext.compatibilityService as { execute: () => string }
					).execute(),
				).toBe("service-1");
				context.set("user", { id: "mutable-user-must-not-be-authority" });
				if (!nativeContext.session) throw new Error("Expected native session");
				(nativeContext.session.user as { id: string }).id = "forged-user";
				context.req.raw.headers.set("x-authority", "forged-authority");
				(nativeContext.permissions as Set<string>).clear();
				(nativeContext.extensionToken as NativeToken).value = "forged-token";
				await next();
			})
			.route("/", questpieHono(app, { basePath: "/api" }));

		const response = await native.request("http://localhost/api/inspect", {
			headers: { "x-authority": "read" },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			userId: "original-user",
			permissionCount: 1,
			callback: "callback-2",
			promise: "promise-2",
			token: "token-2",
			service: "service-2",
		});
		expect(contextCreations).toBe(2);
	});

	it("runs native middleware registered before and after the mount", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(
				() => new Response("pong", { headers: { "x-owner": "questpie" } }),
			);
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
				const pathname = new URL(context.req.url).pathname;
				afterPaths.push(pathname);
				await next();
				context.header("x-native-after", "yes");
				if (pathname === "/api" || pathname.startsWith("/api/")) {
					context.res = new Response("native replacement", { status: 299 });
				}
			})
			.get("/apiary", (context) => {
				context.header("x-owner", "native");
				return context.text("native sibling");
			});

		const cases = [
			{ path: "/api", status: 404, owner: "questpie", code: "NOT_FOUND" },
			{ path: "/api/ping", status: 200, owner: "questpie", body: "pong" },
			{ path: "/api/x", status: 404, owner: "questpie", code: "NOT_FOUND" },
			{ path: "/apiary", status: 200, owner: "native", body: "native sibling" },
		] as const;
		for (const expected of cases) {
			const { path } = expected;
			const response = await native.request(`http://localhost${path}`);
			expect(response.status).toBe(expected.status);
			expect(response.headers.get("x-native-after")).toBe("yes");
			const actualOwner =
				response.headers.get("x-owner") ??
				(response.headers.has("x-request-id") ? "questpie" : null);
			expect(actualOwner).toBe(expected.owner);
			if (expected.owner === "questpie") {
				expect(response.headers.get("x-request-id")).toBeTruthy();
			} else {
				expect(response.headers.get("x-owner")).toBe("native");
			}
			if ("code" in expected) {
				expect(await response.json()).toMatchObject({
					error: { code: expected.code },
				});
			} else {
				expect(await response.text()).toBe(expected.body);
			}
		}

		expect(beforePaths).toEqual(["/api", "/api/ping", "/api/x", "/apiary"]);
		expect(afterPaths).toEqual(["/api", "/api/ping", "/api/x", "/apiary"]);
	});
});
