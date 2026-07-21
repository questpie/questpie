import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
	createAgentWorkloadMcpBoundary,
	listAgentWorkloadTools,
	type AgentWorkloadMcpBoundary,
} from "./agent-workload-boundary.js";
import { registerCrudTools } from "./crud-tools.js";
import { registerCustomTools } from "./custom-tools.js";
import { defaultAccessModeForTransport, resolveMcpConfig } from "./policy.js";
import { registerSchemaResources } from "./resources.js";
import { registerRouteTools } from "./route-tools.js";
import { createRuntimeScope, type QuestpieApp } from "./runtime.js";
import type {
	AgentWorkloadMcpServerOptions,
	McpExecutionOptions,
} from "./types.js";

async function createServer(
	app: QuestpieApp,
	options: McpExecutionOptions,
	agentWorkload?: AgentWorkloadMcpBoundary,
): Promise<McpServer> {
	const config = resolveMcpConfig(app, options.config);
	const transport = options.transport ?? "http";
	const accessMode =
		transport === "http"
			? "user"
			: (options.accessMode ??
				defaultAccessModeForTransport(config, transport));
	const scope = createRuntimeScope(
		app,
		{
			...options,
			transport,
			accessMode,
			config,
		},
		agentWorkload,
	);

	const server = new McpServer(
		{
			name: config.name ?? "questpie",
			version: config.version ?? "0.0.0",
		},
		{
			capabilities: {
				tools: {},
				resources: {},
			},
		},
	);
	await registerCrudTools(server, scope, config);
	await registerRouteTools(server, scope, config);
	registerSchemaResources(server, scope, config);
	await registerCustomTools(server, scope);
	if (agentWorkload) {
		server.server.setRequestHandler(ListToolsRequestSchema, () =>
			listAgentWorkloadTools(agentWorkload),
		);
	}

	return server;
}

export async function createMcpServer(
	app: QuestpieApp,
	options: McpExecutionOptions = {},
): Promise<McpServer> {
	return createServer(app, options);
}

export async function createAgentWorkloadMcpServer(
	app: QuestpieApp,
	options: AgentWorkloadMcpServerOptions,
): Promise<McpServer> {
	const boundary = await createAgentWorkloadMcpBoundary(options);
	return createServer(
		app,
		{
			transport: "stdio",
			accessMode: "user",
			config: {
				...options.config,
				resources: { schemas: false, routes: false },
			},
		},
		boundary,
	);
}
