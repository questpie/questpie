import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	introspectCollection,
	introspectGlobal,
	type CollectionSchema,
	type GlobalSchema,
} from "questpie";
import { z } from "zod";

import {
	createCollectionDataSchema,
	createGlobalDataSchema,
	filterCrudResultFields,
	filterRecordFields,
	recordSchema,
} from "./field-policy.js";
import {
	evaluateMcpRule,
	operationRule,
	requiredScopesForOperation,
	resolveEntityPolicy,
	scopeGateAllows,
	scopesFromContext,
	type EntityKind,
	type ResolvedMcpPolicy,
	type ScopeOperationKind,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import { toToolError, toToolResult } from "./runtime.js";
import type { McpConfig } from "./types.js";

const whereSchema = z.record(z.string(), z.unknown());
const relationLoadSchema = z.record(z.string(), z.unknown());

const findOptionsSchema = z
	.object({
		where: whereSchema.optional(),
		sort: z
			.record(z.string(), z.union([z.literal("asc"), z.literal("desc")]))
			.optional(),
		limit: z.number().int().positive().optional(),
		page: z.number().int().positive().optional(),
		offset: z.number().int().nonnegative().optional(),
		with: relationLoadSchema.optional(),
		columns: z.record(z.string(), z.boolean()).optional(),
		locale: z.string().optional(),
		includeDeleted: z.boolean().optional(),
		stage: z.string().optional(),
	})
	.passthrough();

const countOptionsSchema = z
	.object({
		where: whereSchema.optional(),
		includeDeleted: z.boolean().optional(),
	})
	.passthrough();

const idSchema = z.union([z.string(), z.number()]);

const getOptionsSchema = z
	.object({
		id: idSchema,
		with: relationLoadSchema.optional(),
		columns: z.record(z.string(), z.boolean()).optional(),
		locale: z.string().optional(),
		includeDeleted: z.boolean().optional(),
		stage: z.string().optional(),
	})
	.passthrough();

const createSchema = z.object({
	data: recordSchema,
});

const updateSchema = z.object({
	id: idSchema,
	data: recordSchema,
});

const deleteSchema = z.object({
	id: idSchema,
});

const globalGetSchema = z
	.object({
		with: relationLoadSchema.optional(),
		columns: z.record(z.string(), z.boolean()).optional(),
		locale: z.string().optional(),
		stage: z.string().optional(),
	})
	.passthrough();

const globalUpdateSchema = z
	.object({
		data: recordSchema,
		with: relationLoadSchema.optional(),
		columns: z.record(z.string(), z.boolean()).optional(),
		locale: z.string().optional(),
		stage: z.string().optional(),
	})
	.passthrough();

type OperationKind = "read" | "write" | "delete";

const COLLECTION_OPERATIONS: Array<{
	name: string;
	kind: OperationKind;
	description: (name: string) => string;
	schema: z.ZodTypeAny;
	execute: (
		crud: any,
		input: any,
		ctx: any,
		maxLimit: number,
	) => Promise<unknown>;
}> = [
	{
		name: "list",
		kind: "read",
		description: (name) => `List ${name} records.`,
		schema: findOptionsSchema,
		execute: (crud, input, ctx, maxLimit) =>
			crud.find(
				{ ...input, limit: Math.min(input.limit ?? maxLimit, maxLimit) },
				ctx,
			),
	},
	{
		name: "count",
		kind: "read",
		description: (name) => `Count ${name} records.`,
		schema: countOptionsSchema,
		execute: (crud, input, ctx) => crud.count(input, ctx),
	},
	{
		name: "get",
		kind: "read",
		description: (name) => `Get one ${name} record by id.`,
		schema: getOptionsSchema,
		execute: (crud, input, ctx) => {
			const { id, ...options } = input;
			return crud.findOne({ ...options, where: { id } }, ctx);
		},
	},
	{
		name: "create",
		kind: "write",
		description: (name) => `Create a ${name} record.`,
		schema: createSchema,
		execute: (crud, input, ctx) => crud.create(input.data, ctx),
	},
	{
		name: "update",
		kind: "write",
		description: (name) => `Update a ${name} record by id.`,
		schema: updateSchema,
		execute: (crud, input, ctx) =>
			crud.updateById({ id: input.id, data: input.data }, ctx),
	},
	{
		name: "delete",
		kind: "delete",
		description: (name) => `Delete a ${name} record by id.`,
		schema: deleteSchema,
		execute: (crud, input, ctx) => crud.deleteById({ id: input.id }, ctx),
	},
];

const GLOBAL_OPERATIONS: Array<{
	name: string;
	kind: Exclude<OperationKind, "delete">;
	description: (name: string) => string;
	schema: z.ZodTypeAny;
	execute: (crud: any, input: any, ctx: any) => Promise<unknown>;
}> = [
	{
		name: "get",
		kind: "read",
		description: (name) => `Get the ${name} global.`,
		schema: globalGetSchema,
		execute: (crud, input, ctx) => crud.get(input, ctx),
	},
	{
		name: "update",
		kind: "write",
		description: (name) => `Update the ${name} global.`,
		schema: globalUpdateSchema,
		execute: (crud, input, ctx) => {
			const { data, ...options } = input;
			return crud.update(data, ctx, options);
		},
	},
];

function collectionOperationSchema(
	operationName: string,
	collection: unknown,
	policy: ResolvedMcpPolicy,
) {
	if (operationName === "create") {
		return z.object({
			data: createCollectionDataSchema(collection, "create", policy),
		});
	}
	if (operationName === "update") {
		return z.object({
			id: idSchema,
			data: createCollectionDataSchema(collection, "update", policy),
		});
	}
	return (
		COLLECTION_OPERATIONS.find((operation) => operation.name === operationName)
			?.schema ?? recordSchema
	);
}

function globalOperationSchema(
	operationName: string,
	global: unknown,
	policy: ResolvedMcpPolicy,
) {
	if (operationName === "update") {
		return globalUpdateSchema.extend({
			data: createGlobalDataSchema(global, policy),
		});
	}
	return (
		GLOBAL_OPERATIONS.find((operation) => operation.name === operationName)
			?.schema ?? recordSchema
	);
}

function filterOperationInput(
	operationName: string,
	input: unknown,
	policy: ResolvedMcpPolicy,
) {
	if (
		(operationName === "create" || operationName === "update") &&
		input &&
		typeof input === "object" &&
		"data" in input
	) {
		return {
			...(input as Record<string, unknown>),
			data: filterRecordFields((input as { data: unknown }).data, policy),
		};
	}

	return input;
}

async function questpieAllows(
	scope: RuntimeScope,
	kind: Exclude<EntityKind, "route">,
	name: string,
	operation: OperationKind,
): Promise<boolean> {
	if (scope.accessMode === "system") return true;

	const ctx = await scope.getContext();
	const crudContext = {
		db: ctx.db ?? scope.app.db,
		session: ctx.session,
		locale: ctx.locale,
		accessMode: scope.accessMode,
		stage: ctx.stage,
	};

	if (kind === "collection") {
		const collection = (scope.app.getCollections() as Record<string, any>)[
			name
		];
		const schema = (await introspectCollection(
			collection,
			crudContext,
			scope.app,
		)) as CollectionSchema;
		if (!schema.access.visible) return false;
		const mappedOperation = operation === "write" ? "update" : operation;
		const result = schema.access.operations[mappedOperation];
		return !!result && result.allowed !== false;
	}

	const global = (scope.app.getGlobals() as Record<string, any>)[name];
	const schema = (await introspectGlobal(
		global,
		crudContext,
		scope.app,
	)) as GlobalSchema;
	if (!schema.access.visible) return false;
	const mappedOperation = operation === "write" ? "update" : "read";
	const result = schema.access.operations[mappedOperation];
	return !!result && result.allowed !== false;
}

async function shouldRegister(
	scope: RuntimeScope,
	policy: ResolvedMcpPolicy,
	kind: Exclude<EntityKind, "route">,
	entityName: string,
	operationName: string,
	operationKind: OperationKind,
): Promise<boolean> {
	if (!policy.expose) return false;
	const ctx = await scope.getContext();
	const mcpAllowed = await evaluateMcpRule(
		operationRule(policy, operationName) ??
			operationRule(
				policy,
				operationKind === "write" ? "update" : operationKind,
			),
		{ transport: scope.transport, accessMode: scope.accessMode, ctx },
	);
	if (!mcpAllowed) return false;
	// Scope gate (MO8): for an `oauth` caller, additionally require the operation's
	// scopes. `scopesFromContext` is `undefined` for `user`/`system`, so the gate
	// passes untouched for them — this only narrows `oauth`. ANDed with the RBAC
	// check below, so the effective `oauth` permission is `scopes ∩ RBAC`.
	if (
		!scopeGateAllows(
			scopesFromContext(ctx),
			requiredScopesForOperation(
				policy,
				kind,
				entityName,
				operationName,
				operationKind as ScopeOperationKind,
			),
		)
	) {
		return false;
	}
	return questpieAllows(scope, kind, entityName, operationKind);
}

export async function registerCrudTools(
	server: McpServer,
	scope: RuntimeScope,
	config: McpConfig,
) {
	const maxLimit = config.crud?.maxLimit ?? 100;
	const collections = scope.app.getCollections() as Record<string, any>;
	const globals = scope.app.getGlobals() as Record<string, any>;

	for (const name of Object.keys(collections)) {
		const collection = collections[name];
		const policy = resolveEntityPolicy(
			config,
			"collection",
			name,
			scope.transport,
		);
		const crud = (scope.app.collections as Record<string, any>)[name];

		for (const operation of COLLECTION_OPERATIONS) {
			if (
				!(await shouldRegister(
					scope,
					policy,
					"collection",
					name,
					operation.name,
					operation.kind,
				))
			) {
				continue;
			}

			server.registerTool(
				`collections.${name}.${operation.name}`,
				{
					description: policy.description ?? operation.description(name),
					inputSchema: collectionOperationSchema(
						operation.name,
						collection,
						policy,
					),
					annotations: {
						readOnlyHint: operation.kind === "read",
						destructiveHint: operation.kind === "delete",
						idempotentHint:
							operation.name === "update" || operation.name === "delete",
					},
				},
				async (input) => {
					try {
						const ctx = await scope.getContext();
						const allowed = await evaluateMcpRule(
							operationRule(policy, operation.name) ??
								operationRule(
									policy,
									operation.kind === "write" ? "update" : operation.kind,
								),
							{ transport: scope.transport, accessMode: scope.accessMode, ctx },
						);
						if (!allowed) throw new Error("MCP access denied");
						// Scope gate at call time (defense in depth): a tool hidden from
						// listing for a missing scope must also be denied if called directly.
						if (
							!scopeGateAllows(
								scopesFromContext(ctx),
								requiredScopesForOperation(
									policy,
									"collection",
									name,
									operation.name,
									operation.kind as ScopeOperationKind,
								),
							)
						) {
							throw new Error("MCP access denied");
						}
						const nextInput = filterOperationInput(
							operation.name,
							input,
							policy,
						);
						const value = await operation.execute(
							crud,
							nextInput,
							ctx,
							maxLimit,
						);
						return toToolResult(filterCrudResultFields(value, policy));
					} catch (error) {
						return toToolError(error);
					}
				},
			);
		}
	}

	for (const name of Object.keys(globals)) {
		const global = globals[name];
		const policy = resolveEntityPolicy(config, "global", name, scope.transport);
		const crud = (scope.app.globals as Record<string, any>)[name];

		for (const operation of GLOBAL_OPERATIONS) {
			if (
				!(await shouldRegister(
					scope,
					policy,
					"global",
					name,
					operation.name,
					operation.kind,
				))
			) {
				continue;
			}

			server.registerTool(
				`globals.${name}.${operation.name}`,
				{
					description: policy.description ?? operation.description(name),
					inputSchema: globalOperationSchema(operation.name, global, policy),
					annotations: {
						readOnlyHint: operation.kind === "read",
						idempotentHint: operation.name === "update",
					},
				},
				async (input) => {
					try {
						const ctx = await scope.getContext();
						const allowed = await evaluateMcpRule(
							operationRule(policy, operation.name) ??
								operationRule(
									policy,
									operation.kind === "write" ? "update" : operation.kind,
								),
							{ transport: scope.transport, accessMode: scope.accessMode, ctx },
						);
						if (!allowed) throw new Error("MCP access denied");
						// Scope gate at call time (defense in depth): a tool hidden from
						// listing for a missing scope must also be denied if called directly.
						if (
							!scopeGateAllows(
								scopesFromContext(ctx),
								requiredScopesForOperation(
									policy,
									"global",
									name,
									operation.name,
									operation.kind as ScopeOperationKind,
								),
							)
						) {
							throw new Error("MCP access denied");
						}
						const nextInput = filterOperationInput(
							operation.name,
							input,
							policy,
						);
						const value = await operation.execute(crud, nextInput, ctx);
						return toToolResult(filterCrudResultFields(value, policy));
					} catch (error) {
						return toToolError(error);
					}
				},
			);
		}
	}
}
