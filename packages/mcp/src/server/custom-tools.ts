import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
	authorizeAgentWorkloadCall,
	executeAgentWorkloadTool,
	permitsAgentWorkloadDiscovery,
	registerAgentWorkloadDiscoveryTool,
} from "./agent-workload-boundary.js";
import { isMcpTool } from "./mcp-tool.js";
import {
	evaluateMcpRule,
	normalizeRequiredScopes,
	scopeGateAllows,
	scopesFromContext,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toToolError } from "./runtime.js";
import {
	jsonSchemaCompatibleSchema,
	toToolInputJsonSchema,
	toToolOutputJsonSchema,
} from "./zod-json-schema.js";

export async function registerCustomTools(
	server: McpServer,
	scope: RuntimeScope,
) {
	const tools = (scope.app.state?.mcpTools ?? {}) as Record<string, unknown>;

	for (const [key, tool] of Object.entries(tools)) {
		if (!isMcpTool(tool)) continue;
		const toolName = tool.name || key;
		if (
			scope.agentWorkload &&
			!(await permitsAgentWorkloadDiscovery(
				scope.agentWorkload,
				toolName,
				tool.config.workload,
			))
		) {
			continue;
		}

		const ctx = await scope.getContext();
		const allowed = await evaluateMcpRule(tool.config.access, {
			transport: scope.transport,
			accessMode: scope.accessMode,
			ctx,
		});
		if (!allowed) continue;
		// Scope gate (MO8): a custom tool has no default scope mapping — its
		// requirement is only what `config.scopes` declares (omitted → none).
		// `undefined` scopes (user/system) bypass; ANDed with the access rule above.
		const requiredScopes = normalizeRequiredScopes(tool.config.scopes);
		if (!scopeGateAllows(scopesFromContext(ctx), requiredScopes)) continue;

		const inputSchema = jsonSchemaCompatibleSchema(tool.config.inputSchema);
		const outputSchema = jsonSchemaCompatibleSchema(tool.config.outputSchema);
		server.registerTool(
			toolName,
			{
				title: tool.config.title,
				description: tool.config.description,
				inputSchema,
				outputSchema,
				annotations: tool.config.annotations,
				_meta: tool.config["_meta"],
			},
			async (input, extra) => {
				try {
					const workloadPrincipal = scope.agentWorkload
						? await authorizeAgentWorkloadCall(
								scope.agentWorkload,
								toolName,
								tool.config.workload,
							)
						: undefined;
					if (scope.agentWorkload && !workloadPrincipal) {
						throw new Error("MCP access denied");
					}
					const callCtx = await scope.getContext();
					const stillAllowed = await evaluateMcpRule(tool.config.access, {
						transport: scope.transport,
						accessMode: scope.accessMode,
						ctx: callCtx,
					});
					if (!stillAllowed) throw new Error("MCP access denied");
					// Scope gate at call time (defense in depth).
					if (!scopeGateAllows(scopesFromContext(callCtx), requiredScopes)) {
						throw new Error("MCP access denied");
					}
					const parsedInput = tool.config.inputSchema
						? await tool.config.inputSchema.parseAsync(input)
						: input;
					const invoke = () =>
						tool.handler({
							input: parsedInput,
							ctx: callCtx,
							transport: scope.transport,
							accessMode: scope.accessMode,
							request: scope.request,
						});
					if (
						scope.agentWorkload &&
						workloadPrincipal &&
						tool.config.workload
					) {
						return executeAgentWorkloadTool(
							scope.agentWorkload,
							workloadPrincipal,
							toolName,
							tool.config.workload,
							extra["_meta"],
							invoke,
						);
					}
					return invoke();
				} catch (error) {
					return toToolError(error);
				}
			},
		);
		if (scope.agentWorkload) {
			const discoveryOutputSchema = toToolOutputJsonSchema(outputSchema);
			registerAgentWorkloadDiscoveryTool(scope.agentWorkload, {
				name: toolName,
				title: tool.config.title,
				description: tool.config.description,
				inputSchema: toToolInputJsonSchema(inputSchema),
				...(discoveryOutputSchema
					? { outputSchema: discoveryOutputSchema }
					: {}),
				annotations: tool.config.annotations,
				_meta: tool.config["_meta"],
			});
		}
	}
}
