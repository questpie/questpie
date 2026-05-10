import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCrudTools } from "./crud-tools.js";
import { registerCustomTools } from "./custom-tools.js";
import { defaultAccessModeForTransport, resolveMcpConfig } from "./policy.js";
import { registerSchemaResources } from "./resources.js";
import { registerRouteTools } from "./route-tools.js";
import { createRuntimeScope, type QuestpieApp } from "./runtime.js";
import type { McpExecutionOptions } from "./types.js";

export async function createMcpServer(
	app: QuestpieApp,
	options: McpExecutionOptions = {},
): Promise<McpServer> {
	const config = resolveMcpConfig(app, options.config);
	const transport = options.transport ?? "http";
	const accessMode =
		transport === "http"
			? "user"
			: (options.accessMode ??
				defaultAccessModeForTransport(config, transport));
	const scope = createRuntimeScope(app, {
		...options,
		transport,
		accessMode,
		config,
	});

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

	return server;
}
