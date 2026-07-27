import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	evaluateRouteAccess,
	executeJsonRoute,
	extractAppServices,
	isJsonRoute,
	type IntrospectedRoute,
} from "questpie";
import { z } from "zod";

import type { ResolvedMcpCatalog } from "./catalog.js";
import { McpAccessDeniedError } from "./execution-boundary.js";
import {
	evaluateMcpRule,
	operationRule,
	requiredScopesForOperation,
	scopeGateAllows,
	scopesFromContext,
	workloadRequirementForOperation,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toRequestContext, toToolError, toToolResult } from "./runtime.js";
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

function routeInputSchema(route: IntrospectedRoute): z.ZodTypeAny {
	if (!isJsonRoute(route.definition)) return z.object({});
	if (route.params.length === 0)
		return jsonSchemaCompatibleSchema(route.definition.schema) ?? z.object({});

	const paramsShape: Record<string, z.ZodString> = {};
	for (const param of route.params) {
		paramsShape[param] = z.string();
	}

	return z
		.object({
			params: z.object(paramsShape).strict(),
			input:
				jsonSchemaCompatibleSchema(route.definition.schema) ?? z.object({}),
		})
		.strict();
}

export async function registerRouteTools(
	server: McpServer,
	scope: RuntimeScope,
	catalog: ResolvedMcpCatalog,
) {
	for (const [routeKey, catalogEntry] of catalog.routes) {
		const route = catalogEntry.route;
		const definition = route.definition;
		if (!isJsonRoute(definition)) continue;
		const mcpMeta = route.meta?.mcp;
		if (!mcpMeta) continue;
		const policy = catalogEntry.policy;

		const name = catalogEntry.toolName;
		const workloadRequirement = workloadRequirementForOperation(
			policy,
			"execute",
		);
		if (scope.workload && !workloadRequirement) {
			continue;
		}
		const inputSchema = routeInputSchema(route);
		const outputSchema = jsonSchemaCompatibleSchema(definition.outputSchema);
		const annotations = mcpMeta.annotations;
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
		) => {
			const mcpAllowed =
				(await evaluateMcpRule(operationRule(policy, "execute"), {
					transport: scope.transport,
					accessMode: scope.accessMode,
					ctx,
				})) &&
				scopeGateAllows(
					scopesFromContext(ctx),
					requiredScopesForOperation(
						policy,
						"route",
						routeKey,
						"execute",
						"invoke",
					),
				);
			if (!mcpAllowed) return false;
			const services = extractAppServices(scope.app, {
				db: ctx.db ?? scope.app.db,
				session: ctx.session,
				locale: ctx.locale,
				accessMode: ctx.accessMode,
				principal: ctx.principal,
			});
			const params = Object.fromEntries(
				route.params.map((param) => [param, ""]),
			);
			return evaluateRouteAccess(definition.access, {
				...services,
				...(ctx["~contextExtensions"] ?? {}),
				locale: ctx.locale,
				request: scope.request,
				params,
			});
		};
		if (!scope.workload) {
			const ctx = await scope.getContext();
			if (!(await allows(ctx))) continue;
		}

		server.registerTool(
			name,
			{
				title: mcpMeta.title ?? route.meta?.title,
				description: mcpMeta.description ?? route.meta?.description,
				inputSchema,
				outputSchema,
				annotations,
			},
			async (input, extra) => {
				try {
					let workloadAuthorization:
						| Awaited<ReturnType<typeof authorizeWorkload>>
						| undefined;
					return await scope.execution.execute({
						operation: name,
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
										workloadRequirement,
										control,
									)
								: undefined;
							if (scope.workload && !workloadAuthorization) {
								throw new McpAccessDeniedError();
							}
							const routeCtx =
								workloadAuthorization?.context ?? (await scope.getContext());
							if (!(await allows(routeCtx))) {
								throw new McpAccessDeniedError();
							}
							return routeCtx;
						},
						concurrencyKey: () => workloadAuthorization?.concurrencyKey,
						invoke: async ({ ctx, signal, requestId, correlationId }) => {
							const invocation =
								route.params.length > 0
									? z
											.object({
												input: z.unknown(),
												params: z.record(z.string(), z.string()),
											})
											.parse(input)
									: { input, params: {} };
							const requestContext = toRequestContext(ctx, scope.accessMode);
							const executionRequest = new Request(
								scope.request?.url ?? "http://questpie.local/mcp",
								{
									method: scope.request?.method ?? "POST",
									headers: scope.request?.headers,
									signal,
								},
							);
							const invoke = async () =>
								toToolResult(
									await executeJsonRoute(
										scope.app,
										definition,
										invocation.input,
										requestContext,
										executionRequest,
										invocation.params,
									),
								);
							if (
								scope.workload &&
								workloadAuthorization &&
								workloadRequirement
							) {
								return executeWorkloadTool(
									scope.workload,
									workloadAuthorization,
									undefined,
									{ signal, requestId, correlationId },
									invoke,
								);
							}
							return invoke();
						},
					});
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
					title: mcpMeta.title ?? route.meta?.title,
					description: mcpMeta.description ?? route.meta?.description,
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
