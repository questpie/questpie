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

export async function mcpHandler(ctx: RawRouteHandlerArgs): Promise<Response> {
	const { request } = ctx;
	const app = appFromRouteContext(ctx);
	if (request.method === "OPTIONS") {
		return withCors(new Response(null, { status: 204 }), request);
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
