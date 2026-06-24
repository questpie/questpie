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
