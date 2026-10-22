import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	ListToolsRequestSchema,
	type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import { assertMcpCatalogByteBudget } from "./catalog-byte-budget.js";
import { registerCrudTools } from "./crud-tools.js";
import { registerCustomTools } from "./custom-tools.js";
import { registerPromptProviders } from "./mcp-prompts.js";
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
import { applyMcpSchemaDiet } from "./zod-json-schema.js";

/**
 * Fail closed in every environment: an unwrapped SDK response would bypass
 * both the schema diet and the hard catalog byte budget.
 */
function reportSchemaDietInstallFailure(message: string): never {
	const prefixed = `@questpie/mcp: ${message}`;
	// eslint-disable-next-line no-console -- deliberate, unconditional operator-facing diagnostic.
	console.error(prefixed);
	throw new Error(prefixed);
}

/* eslint-disable no-underscore-dangle -- The MCP SDK's `McpServer#registerTool`
 * installs its own `tools/list` handler internally (it converts each tool's
 * raw zod `inputSchema`/`outputSchema` to JSON Schema at list time via a
 * vendored `zod-json-schema-compat.js`), with no public hook to post-process
 * the result. `Protocol#setRequestHandler` freely replaces a handler
 * (`_requestHandlers` is a plain `Map`; only the SDK's own pre-registration
 * `assertCanSetRequestHandler` check would reject a second install, and we
 * never call that), so reaching into the already-installed handler to wrap
 * it is the smallest surface that lets the diet apply without re-deriving
 * every tool's schema ourselves. */
export function installSchemaDietListToolsHandler(
	server: McpServer,
	maxCatalogBytes?: number,
): void {
	const handlers: unknown = Reflect.get(server.server, "_requestHandlers");
	if (!(handlers instanceof Map)) {
		reportSchemaDietInstallFailure(
			"could not install the tools/list schema diet — McpServer#server's " +
				"internal request-handler map is missing or not a Map (the MCP " +
				"SDK's internals likely changed shape). Cannot enforce the catalog byte budget.",
		);
	}
	const defaultHandler = handlers.get("tools/list") as
		| ((request: unknown, extra: unknown) => Promise<ListToolsResult>)
		| undefined;
	if (!defaultHandler) {
		reportSchemaDietInstallFailure(
			"could not install the tools/list schema diet — no default " +
				"tools/list handler was registered even though at least one " +
				"tool exists. Cannot enforce the catalog byte budget.",
		);
	}
	server.server.setRequestHandler(
		ListToolsRequestSchema,
		async (request, extra) => {
			if (request.params?.cursor !== undefined) {
				throw new Error(
					"MCP catalog byte budget requires a complete tools/list result; omit the pagination cursor",
				);
			}
			const result = await defaultHandler(request, extra);
			const projected = {
				...result,
				tools: result.tools.map((tool) => ({
					...tool,
					inputSchema: applyMcpSchemaDiet(tool.inputSchema),
					...(tool.outputSchema
						? { outputSchema: applyMcpSchemaDiet(tool.outputSchema) }
						: {}),
				})),
			};
			assertMcpCatalogByteBudget(projected, maxCatalogBytes);
			return projected;
		},
	);
}
/* eslint-enable no-underscore-dangle */

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
				// Prompts are never served to remote workloads. Lists are computed
				// per request and this transport is stateless, so no listChanged.
				...(!workload && catalog.promptProviders.size > 0
					? { prompts: {} }
					: {}),
			},
		},
	);
	await registerCrudTools(server, scope, config as McpConfig, catalog);
	await registerRouteTools(server, scope, catalog);
	registerSchemaResources(server, scope, catalog);
	await registerCustomTools(server, scope, catalog);
	registerPromptProviders(server, scope, catalog);
	if (workload) {
		server.server.setRequestHandler(ListToolsRequestSchema, (_request, extra) =>
			listWorkloadTools(
				workload,
				release.execution,
				extra,
				release.maxCatalogBytes,
			),
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
	if (!workload) {
		installSchemaDietListToolsHandler(server, release.maxCatalogBytes);
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
