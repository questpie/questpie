/**
 * Shared MCP Streamable-HTTP handler.
 *
 * `route()` is single-method, so the MCP endpoint's four verbs (POST = JSON-RPC
 * messages, GET = SSE stream, DELETE = session end, OPTIONS = CORS preflight)
 * are registered as separate method-suffixed route files under `routes/`
 * (`mcp.ts` = POST, `mcp.get.ts`, `mcp.delete.ts`, `mcp.options.ts`) per the
 * codegen file convention — NOT method chaining and NOT a hand-written
 * `module.ts`. All four share THIS handler, which dispatches on
 * `request.method` internally because the transport needs one object for every
 * verb on the path.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { RawRouteHandlerArgs } from "questpie";

import { createMcpServer } from "./create-server.js";
import type { QuestpieApp } from "./runtime.js";

export const mcpMeta = {
	title: "MCP endpoint",
	description: "Model Context Protocol endpoint for QUESTPIE.",
};

function appFromRouteContext(ctx: object): QuestpieApp {
	return (ctx as { app: QuestpieApp }).app;
}

function executionContextFromRouteContext(ctx: object) {
	const routeCtx = { ...ctx } as Record<string, unknown>;
	delete routeCtx.app;
	delete routeCtx.request;
	return routeCtx;
}

function withCors(response: Response, request: Request): Response {
	const headers = new Headers(response.headers);
	const origin = request.headers.get("origin");
	if (origin) {
		headers.set("Access-Control-Allow-Origin", origin);
		headers.set("Vary", "Origin");
	}
	headers.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
	headers.set(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, x-api-key, Mcp-Session-Id, Last-Event-ID",
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Build the `WWW-Authenticate` challenge value for an unauthenticated HTTP MCP
 * request. `resource_metadata` points at this app's Protected Resource metadata
 * document (RFC 9728), served beside the MCP route by the core
 * `oauth-protected-resource` route (MO4). An MCP client reads it to discover
 * the authorization server and start the OAuth 2.1 flow.
 *
 * The public origin comes from `app.config.app.url`, while the mount path comes
 * from the actual MCP request. This keeps the canonical external host used for
 * token audience binding, and also preserves adapter base paths such as `/api`.
 */
function protectedResourceChallenge(
	appUrl: string,
	requestUrl: string,
): string {
	const request = new URL(requestUrl);
	request.pathname = request.pathname.replace(/\/+$/, "");
	const metadataPath = new URL(".well-known/oauth-protected-resource", request)
		.pathname;
	const metadataUrl = new URL(appUrl);
	metadataUrl.pathname = metadataPath;
	metadataUrl.search = "";
	metadataUrl.hash = "";
	return `Bearer resource_metadata="${metadataUrl.href}"`;
}

/**
 * A verified principal is required to reach MCP tool execution over HTTP. The
 * request context resolves one for a cookie/bearer session (`kind: "user"`) or a
 * valid OAuth access token (`kind: "oauth"`); an unauthenticated request has
 * none. Read it structurally — the handler-args type does not surface it.
 */
function hasVerifiedPrincipal(ctx: RawRouteHandlerArgs): boolean {
	return Boolean((ctx as { principal?: unknown }).principal);
}

export async function mcpHandler(ctx: RawRouteHandlerArgs): Promise<Response> {
	const { request } = ctx;
	const app = appFromRouteContext(ctx);
	if (request.method === "OPTIONS") {
		return withCors(new Response(null, { status: 204 }), request);
	}

	// Require a verified principal before any MCP dispatch. The framework's
	// adapter has already resolved identity onto `ctx` by the time this handler
	// runs: a cookie/bearer session yields `kind: "user"`, a valid OAuth access
	// token yields `kind: "oauth"`, and an unauthenticated request yields none.
	// Without one, answer 401 + `WWW-Authenticate` so an MCP client auto-discovers
	// the authorization server and starts the OAuth flow — instead of the old
	// silent `session = null` happy path that only failed later on access checks.
	// (OPTIONS already returned above, so CORS preflight is unaffected.)
	if (!hasVerifiedPrincipal(ctx)) {
		return withCors(
			new Response(null, {
				status: 401,
				headers: {
					"WWW-Authenticate": protectedResourceChallenge(
						app.config.app.url,
						request.url,
					),
				},
			}),
			request,
		);
	}

	const config = (app.state?.config?.mcp ?? {}) as {
		http?: {
			allowedOrigins?: string[];
			allowedHosts?: string[];
			enableJsonResponse?: boolean;
		};
	};

	const server = await createMcpServer(app, {
		transport: "http",
		accessMode: "user",
		request,
		ctx: executionContextFromRouteContext(ctx) as any,
	});
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		allowedOrigins: config.http?.allowedOrigins,
		allowedHosts: config.http?.allowedHosts,
		enableJsonResponse: config.http?.enableJsonResponse ?? true,
	});

	await server.connect(transport);
	const response = await transport.handleRequest(request);
	return withCors(response, request);
}
