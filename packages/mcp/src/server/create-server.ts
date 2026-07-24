import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { registerCrudTools } from "./crud-tools.js";
import { registerCustomTools } from "./custom-tools.js";
import { resolveMcpConfig } from "./policy.js";
import { registerSchemaResources } from "./resources.js";
import { registerRouteTools } from "./route-tools.js";
import { createRuntimeScope, type QuestpieApp } from "./runtime.js";
import type { McpExecutionOptions, WorkloadMcpServerOptions } from "./types.js";
import {
	createWorkloadMcpBoundary,
	listWorkloadTools,
	type WorkloadMcpBoundary,
} from "./workload-boundary.js";

async function createServer(
	app: QuestpieApp,
	options: McpExecutionOptions,
	workload?: WorkloadMcpBoundary,
): Promise<McpServer> {
	const config = resolveMcpConfig(app, options.config);
	const transport = options.transport ?? "http";
	const accessMode =
		transport === "stdio"
			? resolveStdioAccessMode(options, config.stdio?.trustedMaintenance)
			: "user";
	const scope = createRuntimeScope(
		app,
		{
			...options,
			transport,
			accessMode,
			config,
		},
		workload,
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
	if (workload) {
		server.server.setRequestHandler(ListToolsRequestSchema, () =>
			listWorkloadTools(workload),
		);
	}

	return server;
}

function resolveStdioAccessMode(
	options: McpExecutionOptions,
	trustedMaintenance: boolean | undefined,
): "user" | "system" {
	if (trustedMaintenance === true) {
		if (
			options.ctx !== undefined ||
			options.request !== undefined ||
			options.accessMode === "user"
		) {
			throw new Error(
				"Trusted-maintenance stdio cannot be combined with request authority",
			);
		}
		return "system";
	}

	if (options.ctx?.accessMode === "user" && options.accessMode !== "system") {
		return "user";
	}

	throw new Error(
		"Stdio MCP requires explicit authority: provide a user-mode ctx or configure stdio.trustedMaintenance",
	);
}

export async function createMcpServer(
	app: QuestpieApp,
	options: McpExecutionOptions = {},
): Promise<McpServer> {
	return createServer(app, options);
}

export async function createWorkloadMcpServer(
	app: QuestpieApp,
	options: WorkloadMcpServerOptions,
): Promise<McpServer> {
	const boundary = createWorkloadMcpBoundary(options);
	return createServer(
		app,
		{
			transport: "workload",
			accessMode: "user",
			config: {
				...options.config,
				resources: { schemas: false, routes: false },
			},
		},
		boundary,
	);
}
