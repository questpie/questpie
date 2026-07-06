import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { module, route, routeApp } from "questpie";
import type { RawRouteHandlerArgs } from "questpie";

import { createMcpServer } from "./create-server.js";
import { mcpPlugin } from "./plugin.js";

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
 * document (RFC 9728), served at the server root by the core `oauth-protected-
 * resource` route (MO4). An MCP client reads it to discover the authorization
 * server and start the OAuth 2.1 flow.
 *
 * The origin is derived from `app.config.app.url` — the same base MO2/MO6 use to
 * bind and verify token audience — so the advertised metadata URL always matches
 * where discovery actually lives. `new URL(...).origin` strips any path/query and
 * yields a bare `scheme://host[:port]`, so an app URL with a subpath still
 * produces a root-mounted metadata URL.
 */
function protectedResourceChallenge(appUrl: string): string {
	const origin = new URL(appUrl).origin;
	return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
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

/**
 * One MCP Streamable-HTTP transport handler that dispatches internally on
 * `request.method` (GET = SSE stream, POST = JSON-RPC messages, DELETE =
 * session end, OPTIONS = CORS preflight).
 *
 * `route()` accepts one HTTP method, so this single handler is registered once
 * per method on the SAME path via the `mcp:<METHOD>` route keys below — the
 * framework's convention for multiple methods on one path (the core module does
 * the same with `auth/[...path]:GET` / `:POST`). All four keys share this
 * handler, so the transport stays a single object.
 */
const mcpHandler = async (ctx: RawRouteHandlerArgs): Promise<Response> => {
	const { request } = ctx;
	if (request.method === "OPTIONS") {
		return withCors(new Response(null, { status: 204 }), request);
	}

	const app = routeApp(ctx);

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
					"WWW-Authenticate": protectedResourceChallenge(app.config.app.url),
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
		ctx: ctx as any,
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
};

const mcpMeta = {
	title: "MCP endpoint",
	description: "Model Context Protocol endpoint for QUESTPIE.",
};

export const mcpModule = module({
	name: "questpie-mcp",
	plugin: mcpPlugin(),
	routes: {
		"mcp:POST": route().post().raw().meta(mcpMeta).handler(mcpHandler),
		"mcp:GET": route().get().raw().meta(mcpMeta).handler(mcpHandler),
		"mcp:DELETE": route().delete().raw().meta(mcpMeta).handler(mcpHandler),
		"mcp:OPTIONS": route().options().raw().meta(mcpMeta).handler(mcpHandler),
	},
});

export default mcpModule;
