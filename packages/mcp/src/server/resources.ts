import {
	ResourceTemplate,
	type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	evaluateRouteAccess,
	extractAppServices,
	introspectCollection,
	introspectGlobal,
	introspectRoutes,
	isJsonRoute,
	type CollectionSchema,
	type GlobalSchema,
} from "questpie";
import { z } from "zod";

import { filterEntitySchemaFields } from "./field-policy.js";
import {
	evaluateMcpRule,
	operationRule,
	resolveEntityPolicy,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { jsonResource } from "./runtime.js";
import type { McpConfig } from "./types.js";
import { toJsonSchema } from "./zod-json-schema.js";

async function collectionSchema(
	scope: RuntimeScope,
	name: string,
): Promise<CollectionSchema> {
	const ctx = await scope.getContext();
	const collection = (scope.app.getCollections() as Record<string, any>)[name];
	return introspectCollection(
		collection,
		{
			db: ctx.db ?? scope.app.db,
			session: ctx.session,
			locale: ctx.locale,
			accessMode: scope.accessMode,
			stage: ctx.stage,
		},
		scope.app,
	);
}

async function globalSchema(
	scope: RuntimeScope,
	name: string,
): Promise<GlobalSchema> {
	const ctx = await scope.getContext();
	const global = (scope.app.getGlobals() as Record<string, any>)[name];
	return introspectGlobal(
		global,
		{
			db: ctx.db ?? scope.app.db,
			session: ctx.session,
			locale: ctx.locale,
			accessMode: scope.accessMode,
			stage: ctx.stage,
		},
		scope.app,
	);
}

async function visibleCollections(scope: RuntimeScope, config: McpConfig) {
	const entries = [];
	for (const name of Object.keys(
		scope.app.getCollections() as Record<string, any>,
	)) {
		const policy = resolveEntityPolicy(
			config,
			"collection",
			name,
			scope.transport,
		);
		if (!policy.expose) continue;
		const ctx = await scope.getContext();
		const mcpAllowed = await evaluateMcpRule(
			operationRule(policy, "read") ?? operationRule(policy, "list"),
			{ transport: scope.transport, accessMode: scope.accessMode, ctx },
		);
		if (!mcpAllowed) continue;
		const schema = await collectionSchema(scope, name);
		if (
			scope.accessMode === "system" ||
			(schema.access.visible && schema.access.operations.read.allowed !== false)
		) {
			entries.push(filterEntitySchemaFields(schema, policy));
		}
	}
	return entries;
}

async function visibleGlobals(scope: RuntimeScope, config: McpConfig) {
	const entries = [];
	for (const name of Object.keys(
		scope.app.getGlobals() as Record<string, any>,
	)) {
		const policy = resolveEntityPolicy(config, "global", name, scope.transport);
		if (!policy.expose) continue;
		const ctx = await scope.getContext();
		const mcpAllowed = await evaluateMcpRule(
			operationRule(policy, "read") ?? operationRule(policy, "get"),
			{ transport: scope.transport, accessMode: scope.accessMode, ctx },
		);
		if (!mcpAllowed) continue;
		const schema = await globalSchema(scope, name);
		if (
			scope.accessMode === "system" ||
			(schema.access.visible && schema.access.operations.read.allowed !== false)
		) {
			entries.push(filterEntitySchemaFields(schema, policy));
		}
	}
	return entries;
}

function routeToolInputSchema(
	route: ReturnType<typeof introspectRoutes>[number],
) {
	if (!isJsonRoute(route.definition)) return undefined;
	const params = route.params ?? [];
	if (params.length === 0) return route.definition.schema;
	const shape: Record<string, z.ZodString> = {};
	for (const param of params) shape[param] = z.string();
	return z.object({
		params: z.object(shape),
		input: route.definition.schema,
	});
}

async function routeCatalog(scope: RuntimeScope, config: McpConfig) {
	if (config.resources?.routes === false) return [];
	if (config.routes?.exposeAnnotated === false) return [];

	const ctx = await scope.getContext();
	const services = extractAppServices(scope.app, {
		db: ctx.db ?? scope.app.db,
		session: ctx.session,
		locale: ctx.locale,
	});

	const routes = [];
	for (const route of introspectRoutes(scope.app)) {
		if (!isJsonRoute(route.definition)) continue;
		if (route.meta?.mcp?.expose !== true) continue;

		const policy = resolveEntityPolicy(
			config,
			"route",
			route.key,
			scope.transport,
		);
		if (!policy.expose) continue;

		const mcpAllowed = await evaluateMcpRule(
			operationRule(policy, "execute") ?? operationRule(policy, "read"),
			{ transport: scope.transport, accessMode: scope.accessMode, ctx },
		);
		if (!mcpAllowed) continue;

		const params = Object.fromEntries(
			(route.params ?? []).map((param) => [param, ""]),
		);
		const routeAllowed = await evaluateRouteAccess(route.definition.access, {
			...services,
			locale: ctx.locale,
			request: scope.request,
			params,
		});
		if (!routeAllowed) continue;

		routes.push({
			key: route.key,
			path: route.path,
			methods: route.methods,
			mode: route.mode,
			params: route.params,
			meta: route.meta,
			hasInputSchema: isJsonRoute(route.definition),
			hasOutputSchema:
				isJsonRoute(route.definition) && !!route.definition.outputSchema,
			inputSchema: toJsonSchema(route.definition.schema),
			outputSchema: toJsonSchema(route.definition.outputSchema),
			toolInputSchema: toJsonSchema(routeToolInputSchema(route)),
		});
	}
	return routes;
}

function resourceEntry(uri: string, name: string, description?: string) {
	return {
		uri,
		name,
		mimeType: "application/json",
		description,
	};
}

export function registerSchemaResources(
	server: McpServer,
	scope: RuntimeScope,
	config: McpConfig,
) {
	if (config.resources?.schemas === false) return;

	server.registerResource(
		"questpie-schema-collections",
		"questpie://schema/collections",
		{
			title: "QUESTPIE collections schema",
			mimeType: "application/json",
		},
		async (uri) =>
			jsonResource(uri.toString(), await visibleCollections(scope, config)),
	);

	server.registerResource(
		"questpie-schema-collection",
		new ResourceTemplate("questpie://schema/collections/{name}", {
			list: async () => ({
				resources: (await visibleCollections(scope, config)).map((schema) =>
					resourceEntry(
						`questpie://schema/collections/${schema.name}`,
						`Collection ${schema.name}`,
						schema.description ? String(schema.description) : undefined,
					),
				),
			}),
			complete: {
				name: async (value) =>
					(await visibleCollections(scope, config))
						.map((schema) => schema.name)
						.filter((name) => name.startsWith(value)),
			},
		}),
		{
			title: "QUESTPIE collection schema",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const name = String(variables.name);
			const schema = (await visibleCollections(scope, config)).find(
				(item) => item.name === name,
			);
			if (!schema) throw new Error(`Collection ${name} is not exposed to MCP`);
			return jsonResource(uri.toString(), schema);
		},
	);

	server.registerResource(
		"questpie-schema-globals",
		"questpie://schema/globals",
		{
			title: "QUESTPIE globals schema",
			mimeType: "application/json",
		},
		async (uri) =>
			jsonResource(uri.toString(), await visibleGlobals(scope, config)),
	);

	server.registerResource(
		"questpie-schema-global",
		new ResourceTemplate("questpie://schema/globals/{name}", {
			list: async () => ({
				resources: (await visibleGlobals(scope, config)).map((schema) =>
					resourceEntry(
						`questpie://schema/globals/${schema.name}`,
						`Global ${schema.name}`,
						schema.description ? String(schema.description) : undefined,
					),
				),
			}),
			complete: {
				name: async (value) =>
					(await visibleGlobals(scope, config))
						.map((schema) => schema.name)
						.filter((name) => name.startsWith(value)),
			},
		}),
		{
			title: "QUESTPIE global schema",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const name = String(variables.name);
			const schema = (await visibleGlobals(scope, config)).find(
				(item) => item.name === name,
			);
			if (!schema) throw new Error(`Global ${name} is not exposed to MCP`);
			return jsonResource(uri.toString(), schema);
		},
	);

	server.registerResource(
		"questpie-schema-routes",
		"questpie://schema/routes",
		{
			title: "QUESTPIE route schema",
			mimeType: "application/json",
		},
		async (uri) =>
			jsonResource(uri.toString(), await routeCatalog(scope, config)),
	);

	server.registerResource(
		"questpie-schema-route",
		new ResourceTemplate("questpie://schema/routes/{key}", {
			list: async () => ({
				resources: (await routeCatalog(scope, config)).map((route) =>
					resourceEntry(
						`questpie://schema/routes/${encodeURIComponent(route.key)}`,
						`Route ${route.key}`,
						route.meta?.description,
					),
				),
			}),
			complete: {
				key: async (value) =>
					(await routeCatalog(scope, config))
						.map((route) => route.key)
						.filter((key) => key.startsWith(value)),
			},
		}),
		{
			title: "QUESTPIE route schema",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const key = decodeURIComponent(String(variables.key));
			const route = (await routeCatalog(scope, config)).find(
				(item) => item.key === key,
			);
			if (!route) throw new Error(`Route ${key} is not exposed to MCP`);
			return jsonResource(uri.toString(), route);
		},
	);
}
