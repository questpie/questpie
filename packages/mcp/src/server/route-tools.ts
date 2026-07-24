import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	executeJsonRoute,
	introspectRoutes,
	isJsonRoute,
	type IntrospectedRoute,
} from "questpie";
import { z } from "zod";

import {
	evaluateMcpRule,
	operationRule,
	requiredScopesForOperation,
	resolveEntityPolicy,
	scopeGateAllows,
	scopesFromContext,
	workloadRequirementForOperation,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toRequestContext, toToolError, toToolResult } from "./runtime.js";
import type { McpConfig } from "./types.js";
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

function sanitizeRouteKey(key: string): string {
	return key
		.replace(/[:/[\].]+/g, ".")
		.replace(/\.+/g, ".")
		.replace(/^\./, "")
		.replace(/\.$/, "");
}

function routeInputSchema(route: IntrospectedRoute): z.ZodTypeAny {
	if (!isJsonRoute(route.definition)) return z.object({});
	if (route.params.length === 0)
		return jsonSchemaCompatibleSchema(route.definition.schema) ?? z.object({});

	const paramsShape: Record<string, z.ZodString> = {};
	for (const param of route.params) {
		paramsShape[param] = z.string();
	}

	return z.object({
		params: z.object(paramsShape),
		input: jsonSchemaCompatibleSchema(route.definition.schema) ?? z.object({}),
	});
}

export async function registerRouteTools(
	server: McpServer,
	scope: RuntimeScope,
	config: McpConfig,
) {
	if (config.routes?.exposeAnnotated === false) return;

	for (const route of introspectRoutes(scope.app)) {
		const definition = route.definition;
		if (!isJsonRoute(definition)) continue;
		if (route.meta?.mcp?.expose !== true) continue;

		const policy = resolveEntityPolicy(
			config,
			"route",
			route.key,
			scope.transport,
		);
		if (!policy.expose) continue;

		const name = route.meta.mcp.name ?? `routes.${sanitizeRouteKey(route.key)}`;
		const workloadRequirement = workloadRequirementForOperation(
			policy,
			"execute",
		);
		if (scope.workload && !workloadRequirement) {
			continue;
		}
		const inputSchema = routeInputSchema(route);
		const outputSchema = jsonSchemaCompatibleSchema(definition.outputSchema);
		const annotations = route.meta.mcp.annotations;
		const workloadIdentity = {
			kind: "route" as const,
			name,
			operation: "execute",
			intent:
				workloadRequirement?.handoff || annotations?.readOnlyHint !== true
					? ("effect" as const)
					: ("read" as const),
		};
		const allows = async (
			ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>,
		) =>
			(await evaluateMcpRule(
				operationRule(policy, "execute") ?? operationRule(policy, "read"),
				{ transport: scope.transport, accessMode: scope.accessMode, ctx },
			)) &&
			scopeGateAllows(
				scopesFromContext(ctx),
				requiredScopesForOperation(
					policy,
					"route",
					route.key,
					"execute",
					"invoke",
				),
			);
		if (!scope.workload) {
			const ctx = await scope.getContext();
			if (!(await allows(ctx))) continue;
		}

		server.registerTool(
			name,
			{
				title: route.meta.mcp.title ?? route.meta.title,
				description: route.meta.mcp.description ?? route.meta.description,
				inputSchema,
				outputSchema,
				annotations,
			},
			async (input, extra) => {
				try {
					const workloadAuthorization = scope.workload
						? await authorizeWorkload(
								scope.workload,
								"call",
								workloadIdentity,
								workloadRequirement,
							)
						: undefined;
					if (scope.workload && !workloadAuthorization) {
						throw new Error("MCP access denied");
					}
					const routeCtx =
						workloadAuthorization?.context ?? (await scope.getContext());
					if (!(await allows(routeCtx))) throw new Error("MCP access denied");

					const invocation =
						route.params.length > 0
							? z
									.object({
										input: z.unknown(),
										params: z.record(z.string(), z.string()),
									})
									.parse(input)
							: { input, params: {} };
					const requestContext = toRequestContext(routeCtx, scope.accessMode);
					const invoke = async () =>
						toToolResult(
							await executeJsonRoute(
								scope.app,
								definition,
								invocation.input,
								requestContext,
								scope.request ?? new Request("http://questpie.local/mcp"),
								invocation.params,
							),
						);
					if (scope.workload && workloadAuthorization && workloadRequirement) {
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
					name,
					title: route.meta.mcp.title ?? route.meta.title,
					description: route.meta.mcp.description ?? route.meta.description,
					inputSchema: toToolInputJsonSchema(inputSchema),
					...(discoveryOutputSchema
						? { outputSchema: discoveryOutputSchema }
						: {}),
					annotations,
				},
				workloadIdentity,
				workloadRequirement,
				allows,
			);
		}
	}
}
