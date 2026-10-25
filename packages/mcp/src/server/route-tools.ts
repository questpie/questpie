import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
	prepareJsonRoute,
	isJsonRoute,
	type IntrospectedRoute,
} from "questpie";
import { ApiError } from "questpie/errors";
import { z } from "zod";

import type { ResolvedMcpCatalog } from "./catalog.js";
import { McpAccessDeniedError, McpProductError } from "./execution-boundary.js";
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
import { applyMcpSchemaDiet } from "./zod-json-schema.js";

/** The shared executor owns parsing. The SDK must preserve original wire values.
 * SDK 1.32.1 normalizes object schemas before parsing and listing; keep an object
 * facade with canonical JSON metadata and a passthrough Zod runner. In particular,
 * don't let SDK object parsing strip unknown keys or execute input accessors.
 */
function advertisedSchema(json: Record<string, unknown>) {
	const schema = z.object({}).meta(json);
	// eslint-disable-next-line no-underscore-dangle -- SDK 1.32.1/Zod compatibility boundary, covered by wire tests.
	schema._zod.run = (payload) => payload;
	return schema;
}

export function routeSchemas(route: IntrospectedRoute) {
	if (!isJsonRoute(route.definition)) throw new Error("MCP route must be JSON");
	const definition = route.definition;
	const project = (schema: z.ZodType, io: "input" | "output") => {
		let encodedDate = false;
		const json = z.toJSONSchema(schema, {
			io,
			reused: "ref",
			target: "draft-7",
			unrepresentable:
				io === "output"
					? ({ zodSchema }) => {
							if (zodSchema._zod.def.type !== "date") return "throw";
							encodedDate = true;
							return { type: "string", format: "date-time" };
						}
					: "throw",
		});
		// Older converters can ignore the Date encoding callback and emit {}.
		if (io === "output" && !encodedDate)
			z.toJSONSchema(schema, { io, target: "draft-7" });
		return json;
	};
	let input: Record<string, unknown>;
	let output: Record<string, unknown> | undefined;
	let routeInput: Record<string, unknown>;
	let routeOutput: Record<string, unknown> | undefined;
	let wrapped: boolean;
	let wrappedOutput: boolean;
	try {
		input = definition.schema
			? project(definition.schema, "input")
			: { type: "object", properties: {} };
		routeInput = input;
		wrapped = route.params.length > 0 || input.type !== "object";
		if (wrapped) {
			// Convert the envelope as a whole, so root-recursive refs retain their
			// meaning beneath input rather than accidentally referring to the envelope.
			input = project(
				z
					.object({
						...(route.params.length
							? {
									params: z
										.object(
											Object.fromEntries(
												route.params.map((param) => [param, z.string()]),
											),
										)
										.strict(),
								}
							: {}),
						input: definition.schema ?? z.unknown(),
					})
					.strict(),
				"input",
			);
		}
		output = definition.outputSchema
			? project(definition.outputSchema, "output")
			: undefined;
		routeOutput = output;
		wrappedOutput = !!output && output.type !== "object";
		if (definition.outputSchema && wrappedOutput) {
			output = project(
				z.object({ value: definition.outputSchema }).strict(),
				"output",
			);
		}
	} catch {
		throw new Error(
			`MCP route ${route.path} has a schema that cannot be represented as JSON Schema`,
		);
	}
	return {
		inputSchema: advertisedSchema(input),
		outputSchema: output ? advertisedSchema(output) : undefined,
		input,
		output,
		routeInput,
		routeOutput,
		wrapped,
		wrappedOutput,
	};
}

function routeInvocation(
	route: IntrospectedRoute,
	input: unknown,
	wrapped: boolean,
): { input: unknown; params: Record<string, string> } {
	if (!wrapped) return { input, params: {} };
	const parsed = z
		.object({
			input: z.unknown(),
			...(route.params.length
				? {
						params: z
							.object(
								Object.fromEntries(
									route.params.map((param) => [param, z.string()]),
								),
							)
							.strict(),
					}
				: {}),
		})
		.strict()
		.safeParse(input);
	if (!parsed.success) throw ApiError.fromZodError(parsed.error);
	return {
		input: parsed.data.input,
		params: (parsed.data.params ?? {}) as Record<string, string>,
	};
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
		const access = definition.access;
		if (
			access === false ||
			(typeof access === "object" && access?.execute === false)
		)
			continue;
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
		const {
			inputSchema,
			outputSchema,
			input: inputJson,
			output: outputJson,
			wrapped,
			wrappedOutput,
		} = routeSchemas(route);
		const annotations = definition.query
			? { ...mcpMeta.annotations, readOnlyHint: true }
			: mcpMeta.annotations;
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
			return mcpAllowed;
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
							const requestContext = toRequestContext(ctx, scope.accessMode);
							const executionRequest = new Request(
								scope.request?.url ?? "http://questpie.local/mcp",
								{
									method: scope.request?.method ?? "POST",
									headers: scope.request?.headers,
									signal,
								},
							);
							let prepared: ReturnType<typeof prepareJsonRoute>;
							try {
								const invocation = routeInvocation(route, input, wrapped);
								prepared = prepareJsonRoute(
									scope.app,
									definition,
									invocation.input,
									executionRequest,
									invocation.params,
								);
							} catch (error) {
								throw new McpProductError(
									error,
									{ t: scope.app.t, locale: ctx.locale },
									correlationId,
								);
							}
							const invoke = async () => {
								let result: unknown;
								try {
									result = await prepared.execute(requestContext);
								} catch (error) {
									throw new McpProductError(
										error,
										{ t: scope.app.t, locale: ctx.locale },
										correlationId,
									);
								}
								return toToolResult(wrappedOutput ? { value: result } : result);
							};
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
			const discoveryOutputSchema = outputJson
				? applyMcpSchemaDiet(outputJson)
				: undefined;
			registerWorkloadDiscoveryTool(
				scope.workload,
				{
					name,
					title: mcpMeta.title ?? route.meta?.title,
					description: mcpMeta.description ?? route.meta?.description,
					inputSchema: applyMcpSchemaDiet(inputJson) as Tool["inputSchema"],
					...(discoveryOutputSchema
						? { outputSchema: discoveryOutputSchema as Tool["outputSchema"] }
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
