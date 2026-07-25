import {
	introspectRoutes,
	isJsonRoute,
	type Questpie,
	type ScopeOperationKind,
} from "questpie";

import { isMcpTool } from "./mcp-tool.js";
import {
	operationRule,
	requiredScopesForOperation,
	resolveEntityPolicy,
	umbrellaScopeFor,
	type ResolvedMcpPolicy,
} from "./policy.js";
import type {
	McpConfig,
	McpRequiredScopes,
	McpToolDefinition,
	McpWorkloadRequirement,
} from "./types.js";

export const COLLECTION_OPERATION_KINDS = {
	list: "read",
	count: "read",
	get: "read",
	create: "write",
	update: "write",
	delete: "delete",
} as const satisfies Record<string, ScopeOperationKind>;

export const GLOBAL_OPERATION_KINDS = {
	get: "read",
	update: "write",
} as const satisfies Record<string, ScopeOperationKind>;

export interface ResolvedMcpEntityCatalogEntry {
	policy: ResolvedMcpPolicy;
	operations: readonly string[];
}

export interface ResolvedMcpRouteCatalogEntry extends ResolvedMcpEntityCatalogEntry {
	route: ReturnType<typeof introspectRoutes>[number];
	toolName: string;
}

export interface ResolvedMcpCustomToolCatalogEntry {
	tool: McpToolDefinition;
}

export interface ResolvedMcpCatalog {
	collections: ReadonlyMap<string, ResolvedMcpEntityCatalogEntry>;
	globals: ReadonlyMap<string, ResolvedMcpEntityCatalogEntry>;
	routes: ReadonlyMap<string, ResolvedMcpRouteCatalogEntry>;
	customTools: ReadonlyMap<string, ResolvedMcpCustomToolCatalogEntry>;
	resources: {
		collections: ReadonlySet<string>;
		globals: ReadonlySet<string>;
		routes: ReadonlySet<string>;
	};
	oauth: {
		scopes: readonly string[];
		scopesSupported: readonly string[];
	};
}

type CatalogApp = Pick<Questpie<any>, "getCollections" | "getGlobals"> & {
	state?: { mcpTools?: Record<string, unknown> } & Record<string, unknown>;
	config?: Questpie<any>["config"];
};

const sanitizeRouteKey = (key: string) =>
	key
		.replace(/[:/[\].]+/g, ".")
		.replace(/\.+/g, ".")
		.replace(/^\./, "")
		.replace(/\.$/, "");

const operationIsExplicitlyEnabled = (
	policy: ResolvedMcpPolicy,
	operation: string,
) => {
	const rule = operationRule(policy, operation);
	return rule !== undefined && rule !== false;
};

const addRequiredScopes = (
	target: string[],
	required: McpRequiredScopes | readonly string[] | undefined,
) => {
	if (required === undefined || required === false) return;
	const scopes = typeof required === "string" ? [required] : required;
	for (const scope of scopes) {
		if (!target.includes(scope)) target.push(scope);
	}
};

const hasOwn = (record: object | undefined, key: string) =>
	!!record && Object.prototype.hasOwnProperty.call(record, key);

function ownSection<T>(record: object | undefined, key: string): T | undefined {
	return hasOwn(record, key)
		? ((record as Record<string, unknown>)[key] as T)
		: undefined;
}

function snapshotWorkload(
	requirement: McpWorkloadRequirement | undefined,
): McpWorkloadRequirement | undefined {
	if (!requirement) return undefined;
	return Object.freeze({
		capabilities: Object.freeze([...requirement.capabilities]),
		...(requirement.handoff ? { handoff: requirement.handoff } : {}),
	});
}

function snapshotPolicy(policy: ResolvedMcpPolicy): ResolvedMcpPolicy {
	const operations = Object.create(null) as ResolvedMcpPolicy["operations"];
	for (const [name, rule] of Object.entries(policy.operations)) {
		operations[name] = rule;
	}
	const operationScopes = Object.create(
		null,
	) as ResolvedMcpPolicy["operationScopes"];
	for (const [name, scopes] of Object.entries(policy.operationScopes)) {
		operationScopes[name] = Array.isArray(scopes)
			? (Object.freeze([...scopes]) as unknown as string[])
			: scopes;
	}
	const operationWorkloads = Object.create(
		null,
	) as ResolvedMcpPolicy["operationWorkloads"];
	for (const [name, workload] of Object.entries(policy.operationWorkloads)) {
		const snapshot = snapshotWorkload(workload);
		if (snapshot) operationWorkloads[name] = snapshot;
	}
	return Object.freeze({
		...policy,
		operations: Object.freeze(operations),
		requiredScopes: Array.isArray(policy.requiredScopes)
			? (Object.freeze([...policy.requiredScopes]) as unknown as string[])
			: policy.requiredScopes,
		operationScopes: Object.freeze(operationScopes),
		workload: snapshotWorkload(policy.workload),
		operationWorkloads: Object.freeze(operationWorkloads),
		fields: policy.fields
			? Object.freeze({
					include: policy.fields.include
						? (Object.freeze([...policy.fields.include]) as unknown as string[])
						: undefined,
					exclude: policy.fields.exclude
						? (Object.freeze([...policy.fields.exclude]) as unknown as string[])
						: undefined,
				})
			: undefined,
	});
}

function snapshotTool(candidate: McpToolDefinition): McpToolDefinition {
	const config = Object.freeze({
		...candidate.config,
		scopes: Array.isArray(candidate.config.scopes)
			? (Object.freeze([...candidate.config.scopes]) as unknown as string[])
			: candidate.config.scopes,
		workload: snapshotWorkload(candidate.config.workload),
		annotations: candidate.config.annotations
			? Object.freeze({ ...candidate.config.annotations })
			: undefined,
		_meta: candidate.config["_meta"]
			? Object.freeze({ ...candidate.config["_meta"] })
			: undefined,
	});
	return Object.freeze({
		__brand: "mcpTool" as const,
		name: candidate.name,
		config,
		handler: candidate.handler,
	});
}

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
	return Object.freeze({
		get size() {
			return source.size;
		},
		get: (key: K) => source.get(key),
		has: (key: K) => source.has(key),
		entries: () => source.entries(),
		keys: () => source.keys(),
		values: () => source.values(),
		forEach: (
			callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
			thisArg?: unknown,
		) => {
			const view = readonlyMap(source);
			source.forEach((value, key) => callback.call(thisArg, value, key, view));
		},
		[Symbol.iterator]: () => source[Symbol.iterator](),
		[Symbol.toStringTag]: "Map",
	});
}

function readonlySet<T>(source: Set<T>): ReadonlySet<T> {
	return Object.freeze({
		get size() {
			return source.size;
		},
		has: (value: T) => source.has(value),
		entries: () => source.entries(),
		keys: () => source.keys(),
		values: () => source.values(),
		forEach: (
			callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
			thisArg?: unknown,
		) => {
			const view = readonlySet(source);
			source.forEach((value) => callback.call(thisArg, value, value, view));
		},
		[Symbol.iterator]: () => source[Symbol.iterator](),
		[Symbol.toStringTag]: "Set",
	});
}

export function resolveMcpCatalog(
	app: CatalogApp,
	config: McpConfig,
): ResolvedMcpCatalog {
	const collections = new Map<string, ResolvedMcpEntityCatalogEntry>();
	const globals = new Map<string, ResolvedMcpEntityCatalogEntry>();
	const routes = new Map<string, ResolvedMcpRouteCatalogEntry>();
	const customTools = new Map<string, ResolvedMcpCustomToolCatalogEntry>();
	const oauthScopes: string[] = [];
	const umbrellaScopes: string[] = [];
	const releasedToolNames = new Set<string>();
	const claimToolName = (name: string) => {
		if (releasedToolNames.has(name)) {
			throw new Error(`Duplicate MCP tool name: ${name}`);
		}
		releasedToolNames.add(name);
	};

	for (const name of Object.keys(app.getCollections())) {
		const policy = snapshotPolicy(
			resolveEntityPolicy(config, "collection", name),
		);
		if (!policy.expose) continue;
		const operations = Object.entries(COLLECTION_OPERATION_KINDS)
			.filter(([operation]) => operationIsExplicitlyEnabled(policy, operation))
			.map(([operation, operationKind]) => {
				const required = requiredScopesForOperation(
					policy,
					"collection",
					name,
					operation,
					operationKind,
				);
				addRequiredScopes(oauthScopes, required);
				for (const scope of required) {
					const umbrella = umbrellaScopeFor(scope);
					if (umbrella && !umbrellaScopes.includes(umbrella)) {
						umbrellaScopes.push(umbrella);
					}
				}
				return operation;
			});
		if (operations.length > 0) {
			for (const operation of operations) {
				claimToolName(`collections.${name}.${operation}`);
			}
			collections.set(
				name,
				Object.freeze({
					policy,
					operations: Object.freeze([...operations]),
				}),
			);
		}
	}

	for (const name of Object.keys(app.getGlobals())) {
		const policy = snapshotPolicy(resolveEntityPolicy(config, "global", name));
		if (!policy.expose) continue;
		const operations = Object.entries(GLOBAL_OPERATION_KINDS)
			.filter(([operation]) => operationIsExplicitlyEnabled(policy, operation))
			.map(([operation, operationKind]) => {
				const required = requiredScopesForOperation(
					policy,
					"global",
					name,
					operation,
					operationKind,
				);
				addRequiredScopes(oauthScopes, required);
				for (const scope of required) {
					const umbrella = umbrellaScopeFor(scope);
					if (umbrella && !umbrellaScopes.includes(umbrella)) {
						umbrellaScopes.push(umbrella);
					}
				}
				return operation;
			});
		if (operations.length > 0) {
			for (const operation of operations) {
				claimToolName(`globals.${name}.${operation}`);
			}
			globals.set(
				name,
				Object.freeze({
					policy,
					operations: Object.freeze([...operations]),
				}),
			);
		}
	}

	for (const route of introspectRoutes(app as Questpie<any>)) {
		if (!isJsonRoute(route.definition) || route.meta?.mcp?.expose !== true) {
			continue;
		}
		const policy = snapshotPolicy(
			resolveEntityPolicy(config, "route", route.key),
		);
		if (!policy.expose || !operationIsExplicitlyEnabled(policy, "execute")) {
			continue;
		}
		const required = requiredScopesForOperation(
			policy,
			"route",
			route.key,
			"execute",
			"invoke",
		);
		addRequiredScopes(oauthScopes, required);
		const toolName =
			route.meta.mcp.name ?? `routes.${sanitizeRouteKey(route.key)}`;
		claimToolName(toolName);
		routes.set(
			route.key,
			Object.freeze({
				policy,
				operations: Object.freeze(["execute"]),
				route,
				toolName,
			}),
		);
	}

	const configuredTools = (app.state?.mcpTools ?? {}) as Record<
		string,
		unknown
	>;
	for (const [key, candidate] of Object.entries(configuredTools)) {
		if (
			!isMcpTool(candidate) ||
			candidate.config.access === undefined ||
			candidate.config.scopes === undefined
		) {
			continue;
		}
		if (candidate.config.access === false) continue;
		const tool = snapshotTool(candidate);
		const name = tool.name || key;
		claimToolName(name);
		customTools.set(name, Object.freeze({ tool }));
		addRequiredScopes(oauthScopes, tool.config.scopes);
	}

	const resourceConfig = ownSection<McpConfig["resources"]>(
		config,
		"resources",
	);
	const configuredResourceCollections = ownSection<Record<string, boolean>>(
		resourceConfig,
		"collections",
	);
	const configuredResourceGlobals = ownSection<Record<string, boolean>>(
		resourceConfig,
		"globals",
	);
	const configuredResourceRoutes = ownSection<Record<string, boolean>>(
		resourceConfig,
		"routes",
	);
	const resourceCollections = new Set(
		[...collections.entries()]
			.filter(
				([name, entry]) =>
					hasOwn(configuredResourceCollections, name) &&
					configuredResourceCollections?.[name] === true &&
					entry.operations.some((operation) =>
						["list", "count", "get"].includes(operation),
					),
			)
			.map(([name]) => name),
	);
	const resourceGlobals = new Set(
		[...globals.entries()]
			.filter(
				([name, entry]) =>
					hasOwn(configuredResourceGlobals, name) &&
					configuredResourceGlobals?.[name] === true &&
					entry.operations.includes("get"),
			)
			.map(([name]) => name),
	);
	const resourceRoutes = new Set(
		[...routes.keys()].filter(
			(name) =>
				hasOwn(configuredResourceRoutes, name) &&
				configuredResourceRoutes?.[name] === true,
		),
	);

	return Object.freeze({
		collections: readonlyMap(collections),
		globals: readonlyMap(globals),
		routes: readonlyMap(routes),
		customTools: readonlyMap(customTools),
		resources: Object.freeze({
			collections: readonlySet(resourceCollections),
			globals: readonlySet(resourceGlobals),
			routes: readonlySet(resourceRoutes),
		}),
		oauth: Object.freeze({
			scopes: Object.freeze([...oauthScopes, ...umbrellaScopes]),
			scopesSupported: Object.freeze([...umbrellaScopes]),
		}),
	});
}
