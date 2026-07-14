/**
 * MO9 — the HTTP MCP route requires a verified principal.
 *
 * Unlike `mcp-server.test.ts` (which drives `createMcpServer` directly over an
 * in-memory transport and never touches the route handler), these tests dispatch
 * REAL HTTP requests through the framework's fetch handler so the full pipeline
 * runs: URL match → `resolveContext` (session/OAuth → `ctx.principal`) →
 * `executeRawRoute` → the MO9 `mcpHandler`. That is the only path where the
 * principal gate actually fires.
 *
 * Security invariants asserted:
 *  - a truly unauthenticated `POST /mcp` → 401 + a well-formed `WWW-Authenticate`
 *    challenge pointing at this app's protected-resource metadata (RFC 9728),
 *    with the origin derived from `app.config.app.url`;
 *  - a garbage bearer token → still 401 (no bypass; an invalid token resolves no
 *    principal);
 *  - the 401 body leaks nothing;
 *  - a valid Better Auth cookie session → proceeds to real MCP dispatch (lists a
 *    session-gated tool), i.e. the cookie path is not regressed;
 *  - a CORS `OPTIONS` preflight → 204 with CORS headers (never blocked by the
 *    gate, never reaches tool execution).
 */

import { afterEach, describe, expect, it } from "bun:test";

import { starterModule } from "questpie";
import { z } from "zod";

import { createFetchHandler } from "../../questpie/src/server/adapters/http.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { mcpModule, mcpTool } from "../src/exports/index.js";

const BASE_URL = "http://localhost:3000";

/**
 * A session-gated custom tool. It only lists (and only executes) when the
 * resolved context carries an authenticated user — so its presence in a
 * `tools/list` response proves the authenticated request reached real dispatch
 * with the cookie principal intact.
 */
const whoamiTool = mcpTool("custom.whoami", {
	description: "Return the authenticated user id.",
	inputSchema: z.object({}),
	access: ({ ctx }) => typeof ctx.session?.user?.id === "string",
}).handler(async ({ ctx }) => ({
	structuredContent: { userId: ctx.session?.user.id },
	content: [{ type: "text", text: ctx.session?.user.id ?? "" }],
}));

/** JSON-RPC `tools/list` request bodies for a Streamable-HTTP MCP POST. */
function toolsListRequest(
	url: string,
	headers: Record<string, string> = {},
): Request {
	return new Request(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			// The Streamable HTTP transport requires the client to accept both.
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
			params: {},
		}),
	});
}

async function readJsonRpc(response: Response): Promise<any> {
	const text = await response.text();
	// `enableJsonResponse` is on by default, so a single JSON object comes back.
	// If the transport ever streams SSE, parse the `data:` line instead.
	try {
		return JSON.parse(text);
	} catch {
		const line = text.split("\n").find((l) => l.startsWith("data:"));
		return line ? JSON.parse(line.slice("data:".length).trim()) : undefined;
	}
}

describe("MO9 HTTP MCP route auth gate", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("rejects an unauthenticated POST /mcp with 401 + WWW-Authenticate at the protected-resource metadata URL", async () => {
		const appUrl = "https://cms.example.com";
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: appUrl } },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const response = await handler(toolsListRequest(`${appUrl}/mcp`));

		expect(response).not.toBeNull();
		expect(response!.status).toBe(401);
		// Well-formed RFC 9728 challenge, origin from app.config.app.url.
		expect(response!.headers.get("WWW-Authenticate")).toBe(
			`Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource"`,
		);
		// No internal error details leaked in the body.
		expect(await response!.text()).toBe("");
	});

	it("advertises reachable protected-resource metadata when mounted under /api", async () => {
		const appUrl = "https://cms.example.com";
		const setup = await buildMockApp(
			{
				modules: [starterModule, mcpModule],
				auth: {
					emailAndPassword: {
						enabled: true,
						requireEmailVerification: false,
					},
				},
			},
			{
				app: { url: appUrl },
				secret: "test-auth-secret-with-more-than-32-chars",
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, { basePath: "/api" });

		const response = await handler(toolsListRequest(`${appUrl}/api/mcp`));
		const challenge = response!.headers.get("WWW-Authenticate");
		const metadataUrl = challenge?.match(/resource_metadata="([^"]+)"/)?.[1];

		expect(response!.status).toBe(401);
		expect(metadataUrl).toBe(
			`${appUrl}/api/.well-known/oauth-protected-resource`,
		);

		const metadataResponse = await handler(new Request(metadataUrl!));
		expect(metadataResponse!.status).toBe(200);
		expect(await metadataResponse!.json()).toMatchObject({
			resource: `${appUrl}/api/mcp`,
		});
	});

	it("derives the challenge origin from app.config.app.url even when it carries a path/port", async () => {
		// A base URL with a non-root path + explicit port. `new URL(...).origin`
		// must strip the path and keep scheme://host:port, so the advertised
		// metadata URL stays root-mounted.
		const appUrl = "https://cms.example.com:8443/base/path";
		const setup = await buildMockApp(
			{ modules: [mcpModule] },
			{ app: { url: appUrl } },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const response = await handler(toolsListRequest(`${BASE_URL}/mcp`));

		expect(response!.status).toBe(401);
		expect(response!.headers.get("WWW-Authenticate")).toBe(
			`Bearer resource_metadata="https://cms.example.com:8443/.well-known/oauth-protected-resource"`,
		);
	});

	it("rejects a garbage bearer token with 401 (no bypass, no tool execution)", async () => {
		const setup = await buildMockApp({ modules: [mcpModule] });
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			toolsListRequest(`${BASE_URL}/mcp`, {
				authorization: "Bearer not-a-real-token",
			}),
		);

		expect(response!.status).toBe(401);
		expect(response!.headers.get("WWW-Authenticate")).toContain(
			"resource_metadata=",
		);
		expect(await response!.text()).toBe("");
	});

	it("answers a CORS OPTIONS preflight with 204 and CORS headers (not 401)", async () => {
		const setup = await buildMockApp({ modules: [mcpModule] });
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request(`${BASE_URL}/mcp`, {
				method: "OPTIONS",
				headers: { origin: "https://client.example.com" },
			}),
		);

		expect(response!.status).toBe(204);
		expect(response!.headers.get("WWW-Authenticate")).toBeNull();
		expect(response!.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://client.example.com",
		);
		expect(response!.headers.get("Access-Control-Allow-Methods")).toContain(
			"POST",
		);
	});

	it("lets a valid Better Auth cookie session through to real MCP dispatch", async () => {
		const setup = await buildMockApp(
			{
				modules: [starterModule, mcpModule],
				auth: {
					emailAndPassword: {
						enabled: true,
						requireEmailVerification: false,
					},
				},
				mcpTools: { whoami: whoamiTool },
			},
			{ secret: "test-auth-secret-with-more-than-32-chars" },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);

		const signUpResponse = await setup.app.auth.api.signUpEmail({
			body: {
				email: "mo9-route@example.test",
				password: "password123",
				name: "MO9 Route",
			},
			asResponse: true,
		});
		const signUpBody = await signUpResponse.json();
		const sessionCookie = signUpResponse.headers
			.get("set-cookie")
			?.split(";")[0];
		expect(sessionCookie).toBeTruthy();

		const handler = createFetchHandler(setup.app);

		// Sanity: without the cookie the same request is rejected.
		const unauth = await handler(toolsListRequest(`${BASE_URL}/mcp`));
		expect(unauth!.status).toBe(401);

		// With the cookie the request proceeds to JSON-RPC dispatch (200, no
		// WWW-Authenticate) and the session-gated tool is visible.
		const response = await handler(
			toolsListRequest(`${BASE_URL}/mcp`, { cookie: sessionCookie! }),
		);
		expect(response!.status).toBe(200);
		expect(response!.headers.get("WWW-Authenticate")).toBeNull();

		const body = await readJsonRpc(response!);
		const toolNames: string[] = (body?.result?.tools ?? []).map(
			(t: { name: string }) => t.name,
		);
		expect(toolNames).toContain("custom.whoami");

		// And it actually executes as that user.
		const callResponse = await handler(
			new Request(`${BASE_URL}/mcp`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					cookie: sessionCookie!,
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "custom.whoami", arguments: {} },
				}),
			}),
		);
		expect(callResponse!.status).toBe(200);
		const callBody = await readJsonRpc(callResponse!);
		expect(callBody?.result?.structuredContent).toEqual({
			userId: signUpBody.user.id,
		});
	});
});
