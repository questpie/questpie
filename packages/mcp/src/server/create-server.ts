import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { registerCrudTools } from "./crud-tools.js";
import { registerCustomTools } from "./custom-tools.js";
import {
	createIsolatedMcpRelease,
	createWorkloadMcpRelease,
	getAppMcpRelease,
} from "./release.js";
import { registerSchemaResources } from "./resources.js";
import { registerRouteTools } from "./route-tools.js";
import { createRuntimeScope, type QuestpieApp } from "./runtime.js";
import type {
	McpConfig,
	McpExecutionOptions,
	WorkloadMcpServerOptions,
} from "./types.js";
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
	const release = workload
		? createWorkloadMcpRelease(app, options.config)
		: options.config
			? createIsolatedMcpRelease(app, options.config)
			: getAppMcpRelease(app);
	const { config, catalog } = release;
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
		release.execution,
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
				...(catalog.resources.collections.size > 0 ||
				catalog.resources.globals.size > 0 ||
				catalog.resources.routes.size > 0
					? { resources: {} }
					: {}),
			},
		},
	);
	await registerCrudTools(server, scope, config as McpConfig, catalog);
	await registerRouteTools(server, scope, catalog);
	registerSchemaResources(server, scope, catalog);
	await registerCustomTools(server, scope, catalog);
	if (workload) {
		server.server.setRequestHandler(ListToolsRequestSchema, (_request, extra) =>
			listWorkloadTools(workload, release.execution, extra),
		);
	} else if (
		[...catalog.collections.values()].every(
			(entry) => entry.operations.length === 0,
		) &&
		[...catalog.globals.values()].every(
			(entry) => entry.operations.length === 0,
		) &&
		catalog.routes.size === 0 &&
		catalog.customTools.size === 0
	) {
		server.server.setRequestHandler(ListToolsRequestSchema, () => ({
			tools: [],
		}));
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
			config: options.config,
		},
		boundary,
	);
}
