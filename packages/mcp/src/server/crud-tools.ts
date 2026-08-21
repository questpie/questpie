import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	introspectCollection,
	introspectGlobal,
	type CollectionSchema,
	type GlobalSchema,
} from "questpie";
import { z } from "zod";

import type { ResolvedMcpCatalog } from "./catalog.js";
import { McpAccessDeniedError } from "./execution-boundary.js";
import {
	allowedEntityFieldNames,
	allowedEntityRelationNames,
	createCollectionDataSchema,
	createGlobalDataSchema,
	filterCrudResultFields,
} from "./field-policy.js";
import {
	evaluateMcpRule,
	operationRule,
	requiredScopesForOperation,
	scopeGateAllows,
	scopesFromContext,
	type EntityKind,
	type ResolvedMcpPolicy,
	type ScopeOperationKind,
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
import { toToolInputJsonSchema } from "./zod-json-schema.js";

const idSchema = z.union([z.string(), z.number()]);

function optimisticConcurrencyEnabled(collection: unknown): boolean {
	return (
		(
			collection as {
				state?: { options?: { optimisticConcurrency?: boolean } };
			}
		).state?.options?.optimisticConcurrency === true
	);
}

function expectedRevisionShape(collection: unknown) {
	return optimisticConcurrencyEnabled(collection)
		? { expectedRevision: z.number().int().min(1) }
		: {};
}

const MAX_QUERY_FIELDS = 64;
const MAX_WHERE_DEPTH = 3;
const MAX_LOGICAL_CLAUSES = 16;
const MAX_OPERATOR_VALUES = 100;
const MAX_OFFSET = 10_000;

const scalarQueryValue = z.union([
	z.string().max(4096),
	z.number().finite(),
	z.boolean(),
	z.null(),
]);
const queryValue = z.union([
	scalarQueryValue,
	z.array(scalarQueryValue).max(MAX_OPERATOR_VALUES),
]);
const operatorSchema = z
	.object(
		Object.fromEntries(
			[
				"eq",
				"ne",
				"not",
				"gt",
				"gte",
				"lt",
				"lte",
				"in",
				"notIn",
				"like",
				"ilike",
				"notLike",
				"notIlike",
				"contains",
				"startsWith",
				"endsWith",
				"isNull",
				"isNotNull",
				"arrayOverlaps",
				"arrayContained",
				"arrayContains",
			].map((operator) => [operator, queryValue.optional()]),
		),
	)
	.strict();
const fieldCondition = z
	.union([queryValue, operatorSchema])
	.meta({ id: "QuestpieMcpFieldCondition" });

function boundedFields(fields: string[]): string[] {
	return fields.slice(0, MAX_QUERY_FIELDS);
}

function whereSchema(fields: string[], depth = 0): z.ZodTypeAny {
	const shape: Record<string, z.ZodTypeAny> = Object.fromEntries(
		boundedFields(fields).map((field) => [field, fieldCondition.optional()]),
	);
	if (depth < MAX_WHERE_DEPTH) {
		const nested = whereSchema(fields, depth + 1);
		shape.AND = z.array(nested).max(MAX_LOGICAL_CLAUSES).optional();
		shape.OR = z.array(nested).max(MAX_LOGICAL_CLAUSES).optional();
		shape.NOT = nested.optional();
	}
	return z.object(shape).strict();
}

function columnsSchema(fields: string[]) {
	return z
		.object(
			Object.fromEntries(
				boundedFields(fields).map((field) => [field, z.boolean().optional()]),
			),
		)
		.strict();
}

function sortSchema(fields: string[]) {
	return z
		.object(
			Object.fromEntries(
				boundedFields(fields).map((field) => [
					field,
					z.enum(["asc", "desc"]).optional(),
				]),
			),
		)
		.strict();
}

function relationLoadSchema(relations: string[]) {
	return z
		.object(
			Object.fromEntries(
				boundedFields(relations).map((field) => [
					field,
					z.literal(true).optional(),
				]),
			),
		)
		.strict();
}

function collectionReadSchemas(collection: unknown, policy: ResolvedMcpPolicy) {
	const fields = allowedEntityFieldNames(collection, policy);
	const relations =
		policy.relationLoading === false
			? []
			: allowedEntityRelationNames(collection, policy);
	const common = {
		with: relationLoadSchema(relations).optional(),
		columns: columnsSchema(fields).optional(),
		locale: z.string().max(64).optional(),
		includeDeleted: z.boolean().optional(),
		stage: z.string().max(64).optional(),
	};
	return {
		list: z
			.object({
				where: whereSchema(fields).optional(),
				sort: sortSchema(fields).optional(),
				limit: z.number().int().positive().max(10_000).optional(),
				page: z.number().int().positive().max(1000).optional(),
				offset: z.number().int().nonnegative().max(MAX_OFFSET).optional(),
				...common,
			})
			.strict(),
		count: z
			.object({
				where: whereSchema(fields).optional(),
				includeDeleted: z.boolean().optional(),
			})
			.strict(),
		get: z
			.object({
				id: idSchema,
				...common,
			})
			.strict(),
	};
}

function globalOperationBaseSchema(global: unknown, policy: ResolvedMcpPolicy) {
	const fields = allowedEntityFieldNames(global, policy);
	const relations =
		policy.relationLoading === false
			? []
			: allowedEntityRelationNames(global, policy);
	return {
		with: relationLoadSchema(relations).optional(),
		columns: columnsSchema(fields).optional(),
		locale: z.string().max(64).optional(),
		stage: z.string().max(64).optional(),
	};
}

type OperationKind = "read" | "write" | "delete";

const COLLECTION_OPERATIONS: Array<{
	name: string;
	kind: OperationKind;
	description: (name: string) => string;
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
		execute: (crud, input, ctx, maxLimit) => {
			const { sort, ...options } = input;
			return crud.find(
				{
					...options,
					...(sort === undefined ? {} : { orderBy: sort }),
					limit: Math.min(input.limit ?? maxLimit, maxLimit),
				},
				ctx,
			);
		},
	},
	{
		name: "count",
		kind: "read",
		description: (name) => `Count ${name} records.`,
		execute: (crud, input, ctx) => crud.count(input, ctx),
	},
	{
		name: "get",
		kind: "read",
		description: (name) => `Get one ${name} record by id.`,
		execute: (crud, input, ctx) => {
			const { id, ...options } = input;
			return crud.findOne({ ...options, where: { id } }, ctx);
		},
	},
	{
		name: "create",
		kind: "write",
		description: (name) => `Create a ${name} record.`,
		execute: (crud, input, ctx) => crud.create(input.data, ctx),
	},
	{
		name: "update",
		kind: "write",
		description: (name) => `Update a ${name} record by id.`,
		execute: (crud, input, ctx) =>
			crud.updateById(
				{
					id: input.id,
					data: input.data,
					...(input.expectedRevision === undefined
						? {}
						: { expectedRevision: input.expectedRevision }),
				},
				ctx,
			),
	},
	{
		name: "delete",
		kind: "delete",
		description: (name) => `Delete a ${name} record by id.`,
		execute: (crud, input, ctx) =>
			crud.deleteById(
				{
					id: input.id,
					...(input.expectedRevision === undefined
						? {}
						: { expectedRevision: input.expectedRevision }),
				},
				ctx,
			),
	},
];

const GLOBAL_OPERATIONS: Array<{
	name: string;
	kind: Exclude<OperationKind, "delete">;
	description: (name: string) => string;
	execute: (crud: any, input: any, ctx: any) => Promise<unknown>;
}> = [
	{
		name: "get",
		kind: "read",
		description: (name) => `Get the ${name} global.`,
		execute: (crud, input, ctx) => crud.get(input, ctx),
	},
	{
		name: "update",
		kind: "write",
		description: (name) => `Update the ${name} global.`,
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
		return z
			.object({
				data: createCollectionDataSchema(collection, "create", policy),
			})
			.strict();
	}
	if (operationName === "update") {
		return z
			.object({
				id: idSchema,
				data: createCollectionDataSchema(collection, "update", policy),
				...expectedRevisionShape(collection),
			})
			.strict();
	}
	if (operationName === "delete") {
		return z
			.object({ id: idSchema, ...expectedRevisionShape(collection) })
			.strict();
	}
	const readSchemas = collectionReadSchemas(collection, policy);
	return readSchemas[operationName as keyof typeof readSchemas];
}

function globalOperationSchema(
	operationName: string,
	global: unknown,
	policy: ResolvedMcpPolicy,
) {
	if (operationName === "update") {
		return z
			.object({
				data: createGlobalDataSchema(global, policy),
				...globalOperationBaseSchema(global, policy),
			})
			.strict();
	}
	return z.object(globalOperationBaseSchema(global, policy)).strict();
}

async function questpieAllows(
	scope: RuntimeScope,
	ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>,
	kind: Exclude<EntityKind, "route">,
	name: string,
	operationName: string,
): Promise<boolean> {
	if (scope.accessMode === "system") return true;

	const crudContext = toRequestContext(
		{ ...ctx, db: ctx.db ?? scope.app.db },
		scope.accessMode,
	);

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
		const mappedOperation =
			operationName === "create" ||
			operationName === "update" ||
			operationName === "delete"
				? operationName
				: "read";
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
	const mappedOperation = operationName === "update" ? "update" : "read";
	const result = schema.access.operations[mappedOperation];
	return !!result && result.allowed !== false;
}

async function allowsOperation(
	scope: RuntimeScope,
	ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>,
	policy: ResolvedMcpPolicy,
	kind: Exclude<EntityKind, "route">,
	entityName: string,
	operationName: string,
	operationKind: OperationKind,
): Promise<boolean> {
	const mcpAllowed = await evaluateMcpRule(
		operationRule(policy, operationName),
		{ transport: scope.transport, accessMode: scope.accessMode, ctx },
	);
	if (!mcpAllowed) return false;
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
	return questpieAllows(scope, ctx, kind, entityName, operationName);
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
	if (
		scope.workload &&
		!workloadRequirementForOperation(policy, operationName)
	) {
		return false;
	}
	if (scope.workload) return true;
	const ctx = await scope.getContext();
	return allowsOperation(
		scope,
		ctx,
		policy,
		kind,
		entityName,
		operationName,
		operationKind,
	);
}

export async function registerCrudTools(
	server: McpServer,
	scope: RuntimeScope,
	config: McpConfig,
	catalog: ResolvedMcpCatalog,
) {
	const maxLimit = config.crud?.maxLimit ?? 100;
	const collections = scope.app.getCollections() as Record<string, any>;
	const globals = scope.app.getGlobals() as Record<string, any>;

	for (const [name, catalogEntry] of catalog.collections) {
		const collection = collections[name];
		const policy = catalogEntry.policy;
		const crud = (scope.app.collections as Record<string, any>)[name];

		for (const operation of COLLECTION_OPERATIONS) {
			if (!catalogEntry.operations.includes(operation.name)) continue;
			const toolName = `collections.${name}.${operation.name}`;
			const inputSchema = collectionOperationSchema(
				operation.name,
				collection,
				policy,
			);
			const annotations = {
				readOnlyHint: operation.kind === "read",
				destructiveHint: operation.kind === "delete",
				idempotentHint:
					operation.name === "update" || operation.name === "delete",
			};
			const workloadRequirement = workloadRequirementForOperation(
				policy,
				operation.name,
			);
			const workloadIdentity = {
				kind: "collection" as const,
				name: toolName,
				operation: operation.name,
				intent:
					operation.kind === "read" && !workloadRequirement?.handoff
						? ("read" as const)
						: ("effect" as const),
			};
			const allows = (ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>) =>
				allowsOperation(
					scope,
					ctx,
					policy,
					"collection",
					name,
					operation.name,
					operation.kind,
				);
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
				toolName,
				{
					description: policy.description ?? operation.description(name),
					inputSchema,
					annotations,
				},
				async (input: any, extra: any) => {
					try {
						let workloadAuthorization:
							| Awaited<ReturnType<typeof authorizeWorkload>>
							| undefined;
						return await scope.execution.execute({
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
											workloadRequirement,
											control,
										)
									: undefined;
								if (scope.workload && !workloadAuthorization) {
									throw new McpAccessDeniedError();
								}
								const ctx =
									workloadAuthorization?.context ?? (await scope.getContext());
								if (!(await allows(ctx))) {
									throw new McpAccessDeniedError();
								}
								return ctx;
							},
							concurrencyKey: () => workloadAuthorization?.concurrencyKey,
							invoke: async ({ ctx, signal, requestId, correlationId }) => {
								const invoke = async () => {
									const value = await operation.execute(
										crud,
										input,
										ctx,
										maxLimit,
									);
									return toToolResult(filterCrudResultFields(value, policy));
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
				registerWorkloadDiscoveryTool(
					scope.workload,
					{
						name: toolName,
						description: policy.description ?? operation.description(name),
						inputSchema: toToolInputJsonSchema(inputSchema),
						annotations,
					},
					workloadIdentity,
					workloadRequirement,
					allows,
				);
			}
		}
	}

	for (const [name, catalogEntry] of catalog.globals) {
		const global = globals[name];
		const policy = catalogEntry.policy;
		const crud = (scope.app.globals as Record<string, any>)[name];

		for (const operation of GLOBAL_OPERATIONS) {
			if (!catalogEntry.operations.includes(operation.name)) continue;
			const toolName = `globals.${name}.${operation.name}`;
			const inputSchema = globalOperationSchema(operation.name, global, policy);
			const annotations = {
				readOnlyHint: operation.kind === "read",
				idempotentHint: operation.name === "update",
			};
			const workloadRequirement = workloadRequirementForOperation(
				policy,
				operation.name,
			);
			const workloadIdentity = {
				kind: "global" as const,
				name: toolName,
				operation: operation.name,
				intent:
					operation.kind === "read" && !workloadRequirement?.handoff
						? ("read" as const)
						: ("effect" as const),
			};
			const allows = (ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>) =>
				allowsOperation(
					scope,
					ctx,
					policy,
					"global",
					name,
					operation.name,
					operation.kind,
				);
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
				toolName,
				{
					description: policy.description ?? operation.description(name),
					inputSchema,
					annotations,
				},
				async (input: any, extra: any) => {
					try {
						let workloadAuthorization:
							| Awaited<ReturnType<typeof authorizeWorkload>>
							| undefined;
						return await scope.execution.execute({
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
											workloadRequirement,
											control,
										)
									: undefined;
								if (scope.workload && !workloadAuthorization) {
									throw new McpAccessDeniedError();
								}
								const ctx =
									workloadAuthorization?.context ?? (await scope.getContext());
								if (!(await allows(ctx))) {
									throw new McpAccessDeniedError();
								}
								return ctx;
							},
							concurrencyKey: () => workloadAuthorization?.concurrencyKey,
							invoke: async ({ ctx, signal, requestId, correlationId }) => {
								const invoke = async () => {
									const value = await operation.execute(crud, input, ctx);
									return toToolResult(filterCrudResultFields(value, policy));
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
				registerWorkloadDiscoveryTool(
					scope.workload,
					{
						name: toolName,
						description: policy.description ?? operation.description(name),
						inputSchema: toToolInputJsonSchema(inputSchema),
						annotations,
					},
					workloadIdentity,
					workloadRequirement,
					allows,
				);
			}
		}
	}
}
