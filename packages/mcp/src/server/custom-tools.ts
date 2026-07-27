import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ResolvedMcpCatalog } from "./catalog.js";
import {
	McpAccessDeniedError,
	type McpHandlerExtra,
} from "./execution-boundary.js";
import {
	evaluateMcpRule,
	normalizeRequiredScopes,
	scopeGateAllows,
	scopesFromContext,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toToolError } from "./runtime.js";
import type { McpToolDefinition } from "./types.js";
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

export function customToolWorkloadIdentity(
	toolName: string,
	tool: McpToolDefinition,
) {
	return {
		kind: "custom" as const,
		name: toolName,
		operation: "execute",
		intent:
			tool.config.workload?.handoff ||
			tool.config.annotations?.readOnlyHint !== true
				? ("effect" as const)
				: ("read" as const),
	};
}

export function customToolDescriptor(
	toolName: string,
	tool: McpToolDefinition,
): Tool {
	const inputSchema = customToolInputSchema(tool);
	const outputSchema = jsonSchemaCompatibleSchema(tool.config.outputSchema);
	const discoveryOutputSchema = toToolOutputJsonSchema(outputSchema);
	return {
		name: toolName,
		title: tool.config.title,
		description: tool.config.description,
		inputSchema: toToolInputJsonSchema(inputSchema),
		...(discoveryOutputSchema ? { outputSchema: discoveryOutputSchema } : {}),
		annotations: tool.config.annotations,
		_meta: tool.config["_meta"],
	};
}

function customToolInputSchema(tool: McpToolDefinition) {
	return (
		jsonSchemaCompatibleSchema(tool.config.inputSchema) ?? z.object({}).strict()
	);
}

export function customToolAllows(
	scope: RuntimeScope,
	tool: McpToolDefinition,
	ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>,
) {
	const requiredScopes = normalizeRequiredScopes(tool.config.scopes);
	return Promise.resolve(
		evaluateMcpRule(tool.config.access, {
			transport: scope.transport,
			accessMode: scope.accessMode,
			ctx,
		}),
	).then(
		(allowed) =>
			allowed && scopeGateAllows(scopesFromContext(ctx), requiredScopes),
	);
}

async function validateCustomToolOutput(
	tool: McpToolDefinition,
	result: CallToolResult,
): Promise<CallToolResult> {
	if (!tool.config.outputSchema || result.isError) return result;
	const parsed = await tool.config.outputSchema.safeParseAsync(
		result.structuredContent,
	);
	if (!parsed.success) {
		throw new Error("MCP custom tool output failed validation");
	}
	return {
		...result,
		structuredContent: parsed.data as Record<string, unknown>,
	};
}

export async function executeCustomToolCall(
	scope: RuntimeScope,
	toolName: string,
	tool: McpToolDefinition,
	input: unknown,
	extra: McpHandlerExtra,
): Promise<CallToolResult> {
	const workloadIdentity = customToolWorkloadIdentity(toolName, tool);
	let workloadAuthorization:
		| Awaited<ReturnType<typeof authorizeWorkload>>
		| undefined;

	return scope.execution.execute({
		operation: toolName,
		transport: scope.transport,
		accessMode: scope.accessMode,
		input,
		extra,
		authorize: async (control) => {
			workloadAuthorization = scope.workload
				? await authorizeWorkload(
						scope.workload,
						"call",
						workloadIdentity,
						tool.config.workload,
						control,
					)
				: undefined;
			if (scope.workload && !workloadAuthorization) {
				throw new McpAccessDeniedError();
			}
			const callCtx =
				workloadAuthorization?.context ?? (await scope.getContext());
			if (!(await customToolAllows(scope, tool, callCtx))) {
				throw new McpAccessDeniedError();
			}
			return callCtx;
		},
		concurrencyKey: () => workloadAuthorization?.concurrencyKey,
		invoke: async ({ ctx, signal, requestId, correlationId }) => {
			const parsedInput = tool.config.inputSchema
				? await tool.config.inputSchema.parseAsync(input)
				: await z.object({}).strict().parseAsync(input);
			const invoke = () =>
				tool.handler({
					input: parsedInput,
					ctx,
					transport: scope.transport,
					accessMode: scope.accessMode,
					request: scope.request,
					signal,
					requestId,
					correlationId,
				});
			if (scope.workload && workloadAuthorization && tool.config.workload) {
				return validateCustomToolOutput(
					tool,
					await executeWorkloadTool(
						scope.workload,
						workloadAuthorization,
						undefined,
						{ signal, requestId, correlationId },
						invoke,
					),
				);
			}
			return validateCustomToolOutput(tool, await invoke());
		},
	});
}

export async function registerCustomTools(
	server: McpServer,
	scope: RuntimeScope,
	catalog: ResolvedMcpCatalog,
) {
	for (const [toolName, { tool }] of catalog.customTools) {
		const workloadIdentity = customToolWorkloadIdentity(toolName, tool);
		if (scope.workload && !tool.config.workload) {
			continue;
		}

		// Scope gate (MO8): a custom tool has no default scope mapping — its
		// requirement is only what `config.scopes` declares (omitted → none).
		// `undefined` scopes (user/system) bypass; ANDed with the access rule above.
		const allows = (ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>) =>
			customToolAllows(scope, tool, ctx);
		if (!scope.workload) {
			const ctx = await scope.getContext();
			if (!(await allows(ctx))) continue;
		}

		const inputSchema = customToolInputSchema(tool);
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
					return await executeCustomToolCall(
						scope,
						toolName,
						tool,
						input,
						extra,
					);
				} catch (error) {
					return toToolError(error);
				}
			},
		);
		if (scope.workload) {
			registerWorkloadDiscoveryTool(
				scope.workload,
				customToolDescriptor(toolName, tool),
				workloadIdentity,
				tool.config.workload,
				allows,
			);
		}
	}
}
