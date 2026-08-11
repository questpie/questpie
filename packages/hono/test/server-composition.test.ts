import { afterEach, describe, expect, it } from "bun:test";

import { Hono } from "hono";

import { route } from "../../questpie/src/exports/index.js";
import { channel } from "../../questpie/src/server/channels/channel-builder.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import {
	questpieHono,
	questpieMiddleware,
	type QuestpieVariables,
} from "../src/server.js";

async function readSseEvent(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	eventType: string,
	timeoutMs = 2_000,
): Promise<Record<string, unknown>> {
	const decoder = new TextDecoder();
	let buffer = "";
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				for (;;) {
					const blocks = buffer.split("\n\n");
					buffer = blocks.pop() ?? "";
					for (const block of blocks) {
						const type = block
							.split("\n")
							.find((line) => line.startsWith("event: "))
							?.slice(7);
						const data = block
							.split("\n")
							.find((line) => line.startsWith("data: "))
							?.slice(6);
						if (type === eventType && data) return JSON.parse(data);
					}
					const next = await reader.read();
					if (next.done) throw new Error(`SSE ended before ${eventType}`);
					buffer += decoder.decode(next.value, { stream: true });
				}
			})(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`Timed out waiting for SSE ${eventType}`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

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

	it("keeps fresh channel reauthorization bound to the private request", async () => {
		const authorizationUsers: string[] = [];
		const authorizationHeaders: string[] = [];
		const sessionHeaders: string[] = [];
		const setup = await buildMockApp(
			{
				channels: {
					room: channel("room-[roomId]").authorize(
						({ session, authorityHeader }: any) => {
							authorizationUsers.push(session?.user.id ?? "missing");
							authorizationHeaders.push(authorityHeader ?? "missing");
							return (
								session?.user.id === "original-user" &&
								authorityHeader === "original-authority"
							);
						},
					),
				},
				config: {
					app: {
						context: ({ request }) => ({
							authorityHeader: request.headers.get("x-authority"),
						}),
					},
				},
			},
			{
				app: { url: "http://localhost" },
				realtime: { retentionDays: 0, rowLiveQueries: false },
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		setup.app.auth = {
			api: {
				getSession: async ({ headers }: { headers: Headers }) => {
					const userId = headers.get("x-user-id") ?? "missing";
					sessionHeaders.push(userId);
					return { user: { id: userId }, session: { id: `session-${userId}` } };
				},
			},
		} as typeof setup.app.auth;

		const native = new Hono<{
			Variables: QuestpieVariables<typeof setup.app>;
		}>()
			.use("*", questpieMiddleware(setup.app))
			.use("*", async (context, next) => {
				context.req.raw.headers.set("x-user-id", "forged-user");
				context.req.raw.headers.set("x-authority", "forged-authority");
				await next();
			})
			.route("/", questpieHono(setup.app, { basePath: "/api" }));

		const response = await native.request("http://localhost/api/realtime", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-user-id": "original-user",
				"x-authority": "original-authority",
			},
			body: JSON.stringify({
				channels: [
					{
						id: "room-one",
						channel: "room",
						params: { roomId: "one" },
					},
				],
			}),
		});
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		try {
			await readSseEvent(reader, "session");
			for (let attempt = 0; attempt < 100; attempt++) {
				if (authorizationUsers.length > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}

			await setup.app.realtime!.revokeChannelAuthority({
				channel: "private-room-one",
				subject: { kind: "user", id: "original-user" },
				idempotencyKey: "room-one:original-user:refresh",
			});
			for (let attempt = 0; attempt < 100; attempt++) {
				if (authorizationUsers.length >= 2) break;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			expect(authorizationUsers.length).toBeGreaterThanOrEqual(2);
			expect(new Set(authorizationUsers)).toEqual(new Set(["original-user"]));
			expect(new Set(authorizationHeaders)).toEqual(
				new Set(["original-authority"]),
			);
			expect(new Set(sessionHeaders)).toEqual(new Set(["original-user"]));
		} finally {
			await reader.cancel().catch(() => {});
		}
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

	it("supports explicit base-path and root mounts without host-prefix inference", async () => {
		const ping = route()
			.get()
			.raw()
			.handler(() => new Response("pong"));
		const setup = await buildMockApp({ routes: { ping } });
		cleanup = setup.cleanup;

		const explicitBasePath = new Hono().route(
			"/",
			questpieHono(setup.app, { basePath: "/api" }),
		);
		const rootMount = new Hono().route("/", questpieHono(setup.app));

		const explicitResponse = await explicitBasePath.request(
			"http://localhost/api/ping",
		);
		expect(explicitResponse.status).toBe(200);
		expect(await explicitResponse.text()).toBe("pong");
		const outsideResponse = await explicitBasePath.request(
			"http://localhost/.well-known/oauth-authorization-server/api/auth",
		);
		expect(outsideResponse.status).toBe(404);

		const rootResponse = await rootMount.request("http://localhost/ping");
		expect(rootResponse.status).toBe(200);
		expect(await rootResponse.text()).toBe("pong");
	});
});
