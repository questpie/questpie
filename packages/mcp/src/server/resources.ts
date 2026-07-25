import {
	ResourceTemplate,
	type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	evaluateRouteAccess,
	extractAppServices,
	introspectCollection,
	introspectGlobal,
	isJsonRoute,
	type CollectionSchema,
	type GlobalSchema,
	type IntrospectedRoute,
} from "questpie";
import { z } from "zod";

import type { ResolvedMcpCatalog } from "./catalog.js";
import type { McpHandlerExtra } from "./execution-boundary.js";
import { filterEntitySchemaFields } from "./field-policy.js";
import {
	evaluateMcpRule,
	operationRule,
	requiredScopesForOperation,
	scopeGateAllows,
	scopesFromContext,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { jsonResource } from "./runtime.js";
import { toJsonSchema } from "./zod-json-schema.js";

function fallbackExtra(requestId: string): McpHandlerExtra {
	return {
		signal: new AbortController().signal,
		requestId,
	};
}

function executeResource<T>(
	scope: RuntimeScope,
	operation: string,
	input: unknown,
	extra: McpHandlerExtra,
	invoke: () => T | Promise<T>,
): Promise<T> {
	return scope.execution.execute({
		operation,
		transport: scope.transport,
		accessMode: scope.accessMode,
		input,
		extra,
		// The resource-specific policy is re-evaluated inside `invoke`; this first
		// context resolution admits the same principal into the shared limiter.
		authorize: scope.getContext,
		invoke,
	});
}

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

async function visibleCollections(
	scope: RuntimeScope,
	catalog: ResolvedMcpCatalog,
) {
	const entries = [];
	for (const name of catalog.resources.collections) {
		const catalogEntry = catalog.collections.get(name);
		if (!catalogEntry) continue;
		const policy = catalogEntry.policy;
		const operation =
			catalogEntry.operations.find((candidate) =>
				["list", "count", "get"].includes(candidate),
			) ?? "list";
		const ctx = await scope.getContext();
		const mcpAllowed = await evaluateMcpRule(operationRule(policy, operation), {
			transport: scope.transport,
			accessMode: scope.accessMode,
			ctx,
		});
		if (
			!mcpAllowed ||
			!scopeGateAllows(
				scopesFromContext(ctx),
				requiredScopesForOperation(
					policy,
					"collection",
					name,
					operation,
					"read",
				),
			)
		) {
			continue;
		}
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

async function visibleGlobals(
	scope: RuntimeScope,
	catalog: ResolvedMcpCatalog,
) {
	const entries = [];
	for (const name of catalog.resources.globals) {
		const catalogEntry = catalog.globals.get(name);
		if (!catalogEntry) continue;
		const policy = catalogEntry.policy;
		const ctx = await scope.getContext();
		const mcpAllowed = await evaluateMcpRule(operationRule(policy, "get"), {
			transport: scope.transport,
			accessMode: scope.accessMode,
			ctx,
		});
		if (
			!mcpAllowed ||
			!scopeGateAllows(
				scopesFromContext(ctx),
				requiredScopesForOperation(policy, "global", name, "get", "read"),
			)
		) {
			continue;
		}
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

function routeToolInputSchema(route: IntrospectedRoute) {
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

async function routeCatalog(scope: RuntimeScope, catalog: ResolvedMcpCatalog) {
	const ctx = await scope.getContext();
	const services = extractAppServices(scope.app, {
		db: ctx.db ?? scope.app.db,
		session: ctx.session,
		locale: ctx.locale,
		accessMode: ctx.accessMode,
		principal: ctx.principal,
	});

	const routes = [];
	for (const routeKey of catalog.resources.routes) {
		const catalogEntry = catalog.routes.get(routeKey);
		if (!catalogEntry) continue;
		const route = catalogEntry.route;
		if (!isJsonRoute(route.definition)) continue;
		const policy = catalogEntry.policy;

		const mcpAllowed = await evaluateMcpRule(operationRule(policy, "execute"), {
			transport: scope.transport,
			accessMode: scope.accessMode,
			ctx,
		});
		if (
			!mcpAllowed ||
			!scopeGateAllows(
				scopesFromContext(ctx),
				requiredScopesForOperation(
					policy,
					"route",
					routeKey,
					"execute",
					"invoke",
				),
			)
		) {
			continue;
		}

		const params = Object.fromEntries(
			(route.params ?? []).map((param) => [param, ""]),
		);
		const routeAllowed = await evaluateRouteAccess(route.definition.access, {
			...services,
			...(ctx["~contextExtensions"] ?? {}),
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
	catalog: ResolvedMcpCatalog,
) {
	if (catalog.resources.collections.size > 0)
		server.registerResource(
			"questpie-schema-collections",
			"questpie://schema/collections",
			{
				title: "QUESTPIE collections schema",
				mimeType: "application/json",
			},
			async (uri, extra) =>
				executeResource(
					scope,
					"resources.collections.read",
					{ uri: uri.toString() },
					extra,
					async () =>
						jsonResource(
							uri.toString(),
							await visibleCollections(scope, catalog),
						),
				),
		);

	if (catalog.resources.collections.size > 0)
		server.registerResource(
			"questpie-schema-collection",
			new ResourceTemplate("questpie://schema/collections/{name}", {
				list: async (extra) =>
					executeResource(
						scope,
						"resources.collections.list",
						{},
						extra,
						async () => ({
							resources: (await visibleCollections(scope, catalog)).map(
								(schema) =>
									resourceEntry(
										`questpie://schema/collections/${schema.name}`,
										`Collection ${schema.name}`,
										schema.description ? String(schema.description) : undefined,
									),
							),
						}),
					),
				complete: {
					name: async (value) =>
						executeResource(
							scope,
							"resources.collections.complete",
							{ value },
							fallbackExtra("resources.collections.complete"),
							async () =>
								(await visibleCollections(scope, catalog))
									.map((schema) => schema.name)
									.filter((name) => name.startsWith(value)),
						),
				},
			}),
			{
				title: "QUESTPIE collection schema",
				mimeType: "application/json",
			},
			async (uri, variables, extra) =>
				executeResource(
					scope,
					"resources.collection.read",
					{ uri: uri.toString(), variables },
					extra,
					async () => {
						const name = String(variables.name);
						const schema = (await visibleCollections(scope, catalog)).find(
							(item) => item.name === name,
						);
						if (!schema) throw new Error("MCP resource is not exposed");
						return jsonResource(uri.toString(), schema);
					},
				),
		);

	if (catalog.resources.globals.size > 0)
		server.registerResource(
			"questpie-schema-globals",
			"questpie://schema/globals",
			{
				title: "QUESTPIE globals schema",
				mimeType: "application/json",
			},
			async (uri, extra) =>
				executeResource(
					scope,
					"resources.globals.read",
					{ uri: uri.toString() },
					extra,
					async () =>
						jsonResource(uri.toString(), await visibleGlobals(scope, catalog)),
				),
		);

	if (catalog.resources.globals.size > 0)
		server.registerResource(
			"questpie-schema-global",
			new ResourceTemplate("questpie://schema/globals/{name}", {
				list: async (extra) =>
					executeResource(
						scope,
						"resources.globals.list",
						{},
						extra,
						async () => ({
							resources: (await visibleGlobals(scope, catalog)).map((schema) =>
								resourceEntry(
									`questpie://schema/globals/${schema.name}`,
									`Global ${schema.name}`,
									schema.description ? String(schema.description) : undefined,
								),
							),
						}),
					),
				complete: {
					name: async (value) =>
						executeResource(
							scope,
							"resources.globals.complete",
							{ value },
							fallbackExtra("resources.globals.complete"),
							async () =>
								(await visibleGlobals(scope, catalog))
									.map((schema) => schema.name)
									.filter((name) => name.startsWith(value)),
						),
				},
			}),
			{
				title: "QUESTPIE global schema",
				mimeType: "application/json",
			},
			async (uri, variables, extra) =>
				executeResource(
					scope,
					"resources.global.read",
					{ uri: uri.toString(), variables },
					extra,
					async () => {
						const name = String(variables.name);
						const schema = (await visibleGlobals(scope, catalog)).find(
							(item) => item.name === name,
						);
						if (!schema) throw new Error("MCP resource is not exposed");
						return jsonResource(uri.toString(), schema);
					},
				),
		);

	if (catalog.resources.routes.size > 0)
		server.registerResource(
			"questpie-schema-routes",
			"questpie://schema/routes",
			{
				title: "QUESTPIE route schema",
				mimeType: "application/json",
			},
			async (uri, extra) =>
				executeResource(
					scope,
					"resources.routes.read",
					{ uri: uri.toString() },
					extra,
					async () =>
						jsonResource(uri.toString(), await routeCatalog(scope, catalog)),
				),
		);

	if (catalog.resources.routes.size > 0)
		server.registerResource(
			"questpie-schema-route",
			new ResourceTemplate("questpie://schema/routes/{key}", {
				list: async (extra) =>
					executeResource(
						scope,
						"resources.routes.list",
						{},
						extra,
						async () => ({
							resources: (await routeCatalog(scope, catalog)).map((route) =>
								resourceEntry(
									`questpie://schema/routes/${encodeURIComponent(route.key)}`,
									`Route ${route.key}`,
									route.meta?.description,
								),
							),
						}),
					),
				complete: {
					key: async (value) =>
						executeResource(
							scope,
							"resources.routes.complete",
							{ value },
							fallbackExtra("resources.routes.complete"),
							async () =>
								(await routeCatalog(scope, catalog))
									.map((route) => route.key)
									.filter((key) => key.startsWith(value)),
						),
				},
			}),
			{
				title: "QUESTPIE route schema",
				mimeType: "application/json",
			},
			async (uri, variables, extra) =>
				executeResource(
					scope,
					"resources.route.read",
					{ uri: uri.toString(), variables },
					extra,
					async () => {
						const key = decodeURIComponent(String(variables.key));
						const route = (await routeCatalog(scope, catalog)).find(
							(item) => item.key === key,
						);
						if (!route) throw new Error("MCP resource is not exposed");
						return jsonResource(uri.toString(), route);
					},
				),
		);
}
