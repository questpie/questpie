import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { module, route } from "questpie";

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
		"Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID",
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

const mcpRoute = route()
	.post()
	.get()
	.delete()
	.options()
	.raw()
	.meta({
		title: "MCP endpoint",
		description: "Model Context Protocol endpoint for QUESTPIE.",
	})
	.handler(async ({ app, request, ...ctx }) => {
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
	});

export const mcpModule = module({
	name: "questpie-mcp",
	plugin: mcpPlugin(),
	routes: {
		mcp: mcpRoute,
	},
});

export default mcpModule;
