import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./create-server.js";
import type { QuestpieApp } from "./runtime.js";
import type { McpExecutionOptions } from "./types.js";

export async function startStdioServer(
	app: QuestpieApp,
	options: Omit<McpExecutionOptions, "transport"> = {},
) {
	const server = await createMcpServer(app, {
		...options,
		transport: "stdio",
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
	return server;
}
