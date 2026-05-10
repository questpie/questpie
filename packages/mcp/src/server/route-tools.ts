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
	resolveEntityPolicy,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toToolError, toToolResult } from "./runtime.js";
import type { McpConfig } from "./types.js";
import { jsonSchemaCompatibleSchema } from "./zod-json-schema.js";

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

		const ctx = await scope.getContext();
		const allowed = await evaluateMcpRule(
			operationRule(policy, "execute") ?? operationRule(policy, "read"),
			{ transport: scope.transport, accessMode: scope.accessMode, ctx },
		);
		if (!allowed) continue;

		const name = route.meta.mcp.name ?? `routes.${sanitizeRouteKey(route.key)}`;
		const inputSchema = routeInputSchema(route);

		server.registerTool(
			name,
			{
				title: route.meta.mcp.title ?? route.meta.title,
				description: route.meta.mcp.description ?? route.meta.description,
				inputSchema,
				outputSchema: jsonSchemaCompatibleSchema(definition.outputSchema),
				annotations: route.meta.mcp.annotations,
			},
			async (input) => {
				try {
					const routeCtx = await scope.getContext();
					const stillAllowed = await evaluateMcpRule(
						operationRule(policy, "execute") ?? operationRule(policy, "read"),
						{
							transport: scope.transport,
							accessMode: scope.accessMode,
							ctx: routeCtx,
						},
					);
					if (!stillAllowed) throw new Error("MCP access denied");

					const routeInput =
						route.params.length > 0 ? (input as any).input : input;
					const params = route.params.length > 0 ? (input as any).params : {};
					const result = await executeJsonRoute(
						scope.app,
						definition,
						routeInput,
						routeCtx as any,
						scope.request ?? new Request("http://questpie.local/mcp"),
						params,
					);
					return toToolResult(result);
				} catch (error) {
					return toToolError(error);
				}
			},
		);
	}
}
