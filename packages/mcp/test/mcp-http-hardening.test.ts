import { afterEach, describe, expect, it } from "bun:test";

import { starterModule } from "questpie";

import { createFetchHandler } from "../../questpie/src/server/adapters/http.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { mcpModule, mcpTool } from "../src/exports/index.js";
import { mcpHandler } from "../src/server/mcp-http.js";

const APP_URL = "https://cms.example.test";
const delayedTool = mcpTool("custom.delayed", {
	access: true,
	scopes: false,
}).handler(async () => {
	await new Promise((resolve) => setTimeout(resolve, 25));
	return {
		content: [{ type: "text" as const, text: "delayed-result" }],
	};
});

async function createAuthenticatedHandler(enableJsonResponse = true) {
	const setup = await buildMockApp(
		{
			modules: [starterModule, mcpModule],
			config: { mcp: { http: { enableJsonResponse } } },
			auth: {
				emailAndPassword: {
					enabled: true,
					requireEmailVerification: false,
				},
			},
		},
		{
			app: { url: APP_URL },
			secret: "test-auth-secret-with-more-than-32-chars",
		},
	);
	await runTestDbMigrations(setup.app);
	const signUp = await setup.app.auth.api.signUpEmail({
		body: {
			email: "http-bounds@example.test",
			password: "password123",
			name: "HTTP Bounds",
		},
		asResponse: true,
	});
	const cookie = signUp.headers.get("set-cookie")?.split(";")[0];
	if (!cookie) throw new Error("Expected an authenticated test cookie");
	return {
		...setup,
		cookie,
		handler: createFetchHandler(setup.app),
	};
}

describe("MCP stateless HTTP hardening", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("declares explicit route access for every transport verb", () => {
		for (const route of Object.values(mcpModule.routes)) {
			expect(route.access).toBe(true);
		}
	});

	it("returns 405 for GET and DELETE without creating a session lifecycle", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		for (const method of ["GET", "DELETE"]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method,
					headers: { "mcp-session-id": "cannot-create-a-session" },
				}),
			);

			expect(response?.status).toBe(405);
			expect(response?.headers.get("Allow")).toBe("POST, OPTIONS");
			expect(response?.headers.get("Mcp-Session-Id")).toBeNull();
			expect(await response?.text()).toBe("");
		}
	});

	it("rejects a disallowed Origin without reflecting it", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request(`${APP_URL}/mcp`, {
				method: "OPTIONS",
				headers: {
					origin: "https://attacker.example",
					"access-control-request-method": "POST",
				},
			}),
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(await response?.text()).toBe("");
	});

	it("rejects a spoofed Host before authentication or dispatch", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request(`${APP_URL}/mcp`, {
				method: "OPTIONS",
				headers: {
					host: "attacker.example",
					origin: APP_URL,
					"access-control-request-method": "POST",
				},
			}),
		);

		expect(response?.status).toBe(403);
		expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(await response?.text()).toBe("");
	});

	it("allows only the canonical and explicitly configured origins and hosts", async () => {
		const additionalOrigin = "https://ide.example.test";
		const additionalHost = "internal.example.test:8443";
		const setup = await buildMockApp(
			{
				modules: [mcpModule],
				config: {
					mcp: {
						http: {
							allowedOrigins: [additionalOrigin],
							allowedHosts: [additionalHost],
						},
					},
				},
			},
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		for (const [origin, host] of [
			[APP_URL, new URL(APP_URL).host],
			[additionalOrigin, additionalHost],
		]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method: "OPTIONS",
					headers: {
						host,
						origin,
						"access-control-request-method": "POST",
					},
				}),
			);

			expect(response?.status).toBe(204);
			expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(origin);
			expect(response?.headers.get("Access-Control-Allow-Methods")).toBe(
				"POST, OPTIONS",
			);
		}
	});

	it("never widens origin or host allowlists from non-canonical additions", async () => {
		const setup = await buildMockApp(
			{
				modules: [mcpModule],
				config: {
					mcp: {
						http: {
							allowedOrigins: [
								"https://ide.example.test/path",
								"https://user:pass@credentials.example.test",
								"https://query.example.test?x=1",
							],
							allowedHosts: [
								"https://scheme.example.test",
								"path.example.test/extra",
								"user@credentials.example.test",
								"query.example.test?x=1",
							],
						},
					},
				},
			},
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		for (const [origin, host] of [
			["https://ide.example.test", new URL(APP_URL).host],
			[APP_URL, "scheme.example.test"],
			[APP_URL, "path.example.test"],
		]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method: "OPTIONS",
					headers: {
						host,
						origin,
						"access-control-request-method": "POST",
					},
				}),
			);
			expect(response?.status).toBe(403);
		}
	});

	it("canonicalizes default request Host ports without accepting malformed hosts", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		const canonical = await handler(
			new Request(`${APP_URL}/mcp`, {
				method: "OPTIONS",
				headers: {
					host: "cms.example.test:443",
					origin: APP_URL,
					"access-control-request-method": "POST",
				},
			}),
		);
		expect(canonical?.status).toBe(204);

		for (const host of [
			"cms.example.test/path",
			"user@cms.example.test",
			"cms.example.test?x=1",
		]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method: "OPTIONS",
					headers: {
						host,
						origin: APP_URL,
						"access-control-request-method": "POST",
					},
				}),
			);
			expect(response?.status).toBe(403);
		}
	});

	it("rejects preflights for unsupported methods and headers", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		for (const headers of [
			{ "access-control-request-method": "DELETE" },
			{
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type, x-evil",
			},
		]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method: "OPTIONS",
					headers: { origin: APP_URL, ...headers },
				}),
			);

			expect(response?.status).toBe(403);
			expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
			expect(await response?.text()).toBe("");
		}
	});

	it("rejects stateful session and reconnect headers", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		for (const headers of [
			{ "mcp-session-id": "forged-session" },
			{ "last-event-id": "forged-event" },
		]) {
			const response = await handler(
				new Request(`${APP_URL}/mcp`, {
					method: "POST",
					headers: {
						...headers,
						"content-type": "application/json",
					},
					body: "{}",
				}),
			);

			expect(response?.status).toBe(400);
			expect(response?.headers.get("Mcp-Session-Id")).toBeNull();
			expect(await response?.text()).toBe("");
		}
	});

	it("rejects non-request principals at the HTTP handler seam", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;

		for (const principal of [{ kind: "system" }, { kind: "forged" }, "user"]) {
			const response = await mcpHandler({
				app: setup.app,
				principal,
				request: new Request(`${APP_URL}/mcp`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/list",
						params: {},
					}),
				}),
			} as never);

			expect(response.status).toBe(401);
			expect(response.headers.get("WWW-Authenticate")).toContain(
				"resource_metadata=",
			);
			expect(await response.text()).toBe("");
		}
	});

	it("rejects incomplete user and malformed OAuth principals", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;

		for (const principal of [
			{ kind: "user" },
			{ kind: "user", user: { id: "user-1" } },
			{ kind: "user", user: {}, session: {} },
			{ kind: "oauth", user: { id: "user-1" }, clientId: "client-1" },
			{
				kind: "oauth",
				user: {},
				clientId: "client-1",
				tokenId: "token-1",
				scopes: [],
			},
			{
				kind: "oauth",
				user: { id: "user-1" },
				clientId: "client-1",
				tokenId: "token-1",
				scopes: ["read", 1],
			},
		]) {
			const response = await mcpHandler({
				app: setup.app,
				principal,
				request: new Request(`${APP_URL}/mcp`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/list",
						params: {},
					}),
				}),
			} as never);

			expect(response.status).toBe(401);
		}
	});

	it("returns a blank 500 when release catalog creation fails", async () => {
		const failure = "catalog-secret-must-not-leak";
		const response = await mcpHandler({
			app: {
				config: { app: { url: APP_URL } },
				state: { config: { mcp: {} } },
				getCollections() {
					throw new Error(failure);
				},
				getGlobals: () => ({}),
			},
			principal: {
				kind: "user",
				user: { id: "user-1" },
				session: { id: "session-1" },
			},
			request: new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: {},
				}),
			}),
		} as never);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("");
	});

	it("reuses the release catalog without reusing request principal context", async () => {
		const principalEcho = mcpTool("custom.principal-echo", {
			access: true,
			scopes: false,
		}).handler(async ({ ctx }) => ({
			content: [
				{
					type: "text",
					text: ctx.principal?.kind === "user" ? ctx.principal.user.id : "none",
				},
			],
		}));
		const setup = await buildMockApp(
			{
				modules: [mcpModule],
				mcpTools: { principalEcho },
			},
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;

		for (const userId of ["user-first", "user-second"]) {
			const response = await mcpHandler({
				app: setup.app,
				principal: {
					kind: "user",
					user: { id: userId },
					session: { id: `session-${userId}` },
				},
				request: new Request(`${APP_URL}/mcp`, {
					method: "POST",
					headers: {
						accept: "application/json, text/event-stream",
						"content-type": "application/json",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: {
							name: "custom.principal-echo",
							arguments: {},
						},
					}),
				}),
			} as never);
			expect(response.status).toBe(200);
			expect(await response.text()).toContain(userId);
		}
	});

	it("rejects an oversized declared request before authentication or dispatch", async () => {
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: APP_URL } },
		);
		cleanup = setup.cleanup;
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					"content-length": String(1024 * 1024 + 1),
					"content-type": "application/json",
				},
				body: "{}",
			}),
		);

		expect(response?.status).toBe(413);
		expect(await response?.text()).toBe("");
	});

	it("rejects an oversized body even when Content-Length is absent", async () => {
		const setup = await createAuthenticatedHandler();
		cleanup = setup.cleanup;

		const response = await setup.handler(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					cookie: setup.cookie,
				},
				body: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
			}),
		);

		expect(response?.status).toBe(413);
		expect(await response?.text()).toBe("");
	});

	it("rejects over-deep JSON before SDK dispatch", async () => {
		const setup = await createAuthenticatedHandler();
		cleanup = setup.cleanup;
		let nested: Record<string, unknown> = {};
		for (let depth = 0; depth < 20; depth += 1) {
			nested = { nested };
		}

		const response = await setup.handler(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					cookie: setup.cookie,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: {
						name: "custom.unknown",
						arguments: nested,
					},
				}),
			}),
		);

		expect(response?.status).toBe(400);
		expect(await response?.text()).toBe("");
	});

	it("rejects an oversized JSON-RPC batch before SDK dispatch", async () => {
		const setup = await createAuthenticatedHandler();
		cleanup = setup.cleanup;
		const batch = Array.from({ length: 17 }, (_, index) => ({
			jsonrpc: "2.0",
			id: index + 1,
			method: "tools/list",
			params: {},
		}));

		const response = await setup.handler(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					cookie: setup.cookie,
				},
				body: JSON.stringify(batch),
			}),
		);

		expect(response?.status).toBe(400);
		expect(await response?.text()).toBe("");
	});

	it("keeps a stateless SSE response alive until its POST body completes", async () => {
		const setup = await createAuthenticatedHandler(false);
		cleanup = setup.cleanup;

		const response = await setup.handler(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					cookie: setup.cookie,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: {},
				}),
			}),
		);

		expect(response?.status).toBe(200);
		expect(response?.headers.get("content-type")).toContain(
			"text/event-stream",
		);
		const body = await response?.text();
		expect(body).toContain('"jsonrpc":"2.0"');
		expect(body).toContain('"id":1');
	});

	it("does not close the stateless transport before a delayed tool result is streamed", async () => {
		const setup = await buildMockApp(
			{
				modules: [starterModule, mcpModule],
				mcpTools: { delayed: delayedTool },
				config: { mcp: { http: { enableJsonResponse: false } } },
				auth: {
					emailAndPassword: {
						enabled: true,
						requireEmailVerification: false,
					},
				},
			},
			{
				app: { url: APP_URL },
				secret: "test-auth-secret-with-more-than-32-chars",
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const signUp = await setup.app.auth.api.signUpEmail({
			body: {
				email: "http-delayed@example.test",
				password: "password123",
				name: "HTTP Delayed",
			},
			asResponse: true,
		});
		const cookie = signUp.headers.get("set-cookie")?.split(";")[0];
		expect(cookie).toBeTruthy();

		const response = await createFetchHandler(setup.app)(
			new Request(`${APP_URL}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					cookie: cookie!,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "custom.delayed", arguments: {} },
				}),
			}),
		);

		expect(response?.status).toBe(200);
		expect(await response?.text()).toContain("delayed-result");
	});
});
