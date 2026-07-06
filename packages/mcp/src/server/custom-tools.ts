import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isMcpTool } from "./mcp-tool.js";
import {
	evaluateMcpRule,
	normalizeRequiredScopes,
	scopeGateAllows,
	scopesFromContext,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toToolError } from "./runtime.js";
import { jsonSchemaCompatibleSchema } from "./zod-json-schema.js";

export async function registerCustomTools(
	server: McpServer,
	scope: RuntimeScope,
) {
	const tools = (scope.app.state?.mcpTools ?? {}) as Record<string, unknown>;

	for (const [key, tool] of Object.entries(tools)) {
		if (!isMcpTool(tool)) continue;

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

		server.registerTool(
			tool.name || key,
			{
				title: tool.config.title,
				description: tool.config.description,
				inputSchema: jsonSchemaCompatibleSchema(tool.config.inputSchema),
				outputSchema: jsonSchemaCompatibleSchema(tool.config.outputSchema),
				annotations: tool.config.annotations,
				_meta: tool.config._meta,
			},
			async (input) => {
				try {
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
					return tool.handler({
						input: parsedInput,
						ctx: callCtx,
						transport: scope.transport,
						accessMode: scope.accessMode,
						request: scope.request,
					});
				} catch (error) {
					return toToolError(error);
				}
			},
		);
	}
}
