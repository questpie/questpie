import type { Questpie } from "questpie";

import type {
	McpAccessMode,
	McpAccessRule,
	McpConfig,
	McpEntityPolicy,
	McpExecutionOptions,
	McpTransportKind,
} from "./types.js";

export const DEFAULT_MCP_CONFIG: Required<
	Pick<McpConfig, "crud" | "routes" | "resources" | "http" | "stdio">
> = {
	crud: {
		maxLimit: 100,
		defaults: {},
		collections: {},
		globals: {},
	},
	routes: {
		exposeAnnotated: true,
		routes: {},
	},
	resources: {
		schemas: true,
		routes: true,
	},
	http: {
		accessMode: "user",
		enableJsonResponse: true,
	},
	stdio: {
		accessMode: "system",
	},
};

export type EntityKind = "collection" | "global" | "route";

export interface ResolvedMcpPolicy {
	expose: boolean;
	read?: boolean | McpAccessRule;
	write?: boolean | McpAccessRule;
	delete?: boolean | McpAccessRule;
	operations: Record<string, boolean | McpAccessRule>;
	fields?: { include?: string[]; exclude?: string[] };
	description?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep<T extends Record<string, unknown>>(
	base: T,
	override?: Record<string, unknown>,
): T {
	if (!override) return { ...base };
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = mergeDeep(out[key] as Record<string, unknown>, value);
		} else if (value !== undefined) {
			out[key] = value;
		}
	}
	return out as T;
}

export function resolveMcpConfig(
	app: Questpie<any>,
	override?: McpConfig,
): McpConfig {
	const appConfig = (app.state?.config?.mcp ?? {}) as McpConfig;
	return mergeDeep(
		mergeDeep(
			DEFAULT_MCP_CONFIG as unknown as Record<string, unknown>,
			appConfig as Record<string, unknown>,
		),
		override as Record<string, unknown> | undefined,
	) as McpConfig;
}

export function defaultAccessModeForTransport(
	config: McpConfig,
	transport: McpTransportKind,
): McpAccessMode {
	if (transport === "http") return "user";
	return config.stdio?.accessMode ?? "system";
}

export function resolveEntityPolicy(
	config: McpConfig,
	kind: EntityKind,
	name: string,
	transport: McpTransportKind = "http",
): ResolvedMcpPolicy {
	if (kind === "route") {
		const override = config.routes?.routes?.[name];
		return normalizePolicy({ expose: true, read: true }, override);
	}

	if (kind === "global") {
		const transportDefaults =
			transport === "stdio"
				? { read: true, write: true }
				: { read: true, write: false };
		const defaults = {
			...transportDefaults,
			...(config.crud?.defaults?.globals ?? {}),
		};
		const override = config.crud?.globals?.[name];
		return normalizePolicy({ expose: true, ...defaults }, override);
	}

	const transportDefaults =
		transport === "stdio"
			? { read: true, write: true, delete: true }
			: { read: true, write: false, delete: false };
	const defaults = {
		...transportDefaults,
		...(config.crud?.defaults?.collections ?? {}),
	};
	const override = config.crud?.collections?.[name];
	return normalizePolicy({ expose: true, ...defaults }, override);
}

function normalizePolicy(
	defaults: Partial<ResolvedMcpPolicy>,
	override?: McpEntityPolicy,
): ResolvedMcpPolicy {
	if (override === false) {
		return { expose: false, operations: {} };
	}

	const base: ResolvedMcpPolicy = {
		expose: defaults.expose ?? true,
		read: defaults.read,
		write: defaults.write,
		delete: defaults.delete,
		operations: { ...(defaults.operations ?? {}) },
		fields: defaults.fields,
		description: defaults.description,
	};

	if (override === true || override === undefined) return base;

	return {
		...base,
		...override,
		expose: override.expose ?? base.expose,
		operations: {
			...base.operations,
			...(override.operations ?? {}),
		},
	};
}

export function operationRule(
	policy: ResolvedMcpPolicy,
	operation: string,
): boolean | McpAccessRule | undefined {
	if (policy.operations[operation] !== undefined) {
		return policy.operations[operation];
	}
	if (operation === "delete") return policy.delete;
	if (operation === "create" || operation === "update") return policy.write;
	return policy.read;
}

export async function evaluateMcpRule(
	rule: boolean | McpAccessRule | undefined,
	options: Required<
		Pick<McpExecutionOptions, "transport" | "accessMode" | "ctx">
	>,
): Promise<boolean> {
	if (rule === undefined) return true;
	if (typeof rule === "boolean") return rule;
	return rule({
		transport: options.transport,
		accessMode: options.accessMode,
		session: options.ctx.session,
		ctx: options.ctx,
	});
}
