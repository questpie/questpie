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
import {
	authorizeWorkload,
	executeWorkloadTool,
	registerWorkloadDiscoveryTool,
} from "./workload-boundary.js";
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
		const workloadIdentity = {
			kind: "custom" as const,
			name: toolName,
			operation: "execute",
			intent:
				tool.config.workload?.handoff ||
				tool.config.annotations?.readOnlyHint !== true
					? ("effect" as const)
					: ("read" as const),
		};
		if (scope.workload && !tool.config.workload) {
			continue;
		}

		// Scope gate (MO8): a custom tool has no default scope mapping — its
		// requirement is only what `config.scopes` declares (omitted → none).
		// `undefined` scopes (user/system) bypass; ANDed with the access rule above.
		const requiredScopes = normalizeRequiredScopes(tool.config.scopes);
		const allows = async (
			ctx: RuntimeScope["getContext"] extends () => Promise<infer T>
				? T
				: never,
		) =>
			(await evaluateMcpRule(tool.config.access, {
				transport: scope.transport,
				accessMode: scope.accessMode,
				ctx,
			})) && scopeGateAllows(scopesFromContext(ctx), requiredScopes);
		if (!scope.workload) {
			const ctx = await scope.getContext();
			if (!(await allows(ctx))) continue;
		}

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
					const workloadAuthorization = scope.workload
						? await authorizeWorkload(
								scope.workload,
								"call",
								workloadIdentity,
								tool.config.workload,
							)
						: undefined;
					if (scope.workload && !workloadAuthorization) {
						throw new Error("MCP access denied");
					}
					const callCtx =
						workloadAuthorization?.context ?? (await scope.getContext());
					if (!(await allows(callCtx))) throw new Error("MCP access denied");
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
					if (scope.workload && workloadAuthorization && tool.config.workload) {
						return executeWorkloadTool(
							scope.workload,
							workloadAuthorization,
							extra?.["_meta"],
							invoke,
						);
					}
					return invoke();
				} catch (error) {
					return toToolError(error);
				}
			},
		);
		if (scope.workload) {
			const discoveryOutputSchema = toToolOutputJsonSchema(outputSchema);
			registerWorkloadDiscoveryTool(
				scope.workload,
				{
					name: toolName,
					title: tool.config.title,
					description: tool.config.description,
					inputSchema: toToolInputJsonSchema(inputSchema),
					...(discoveryOutputSchema
						? { outputSchema: discoveryOutputSchema }
						: {}),
					annotations: tool.config.annotations,
					_meta: tool.config["_meta"],
				},
				workloadIdentity,
				tool.config.workload,
				allows,
			);
		}
	}
}
