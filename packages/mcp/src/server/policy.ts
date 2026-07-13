import type { AppContext, Questpie, RequestContext } from "questpie";
import {
	defaultOperationScope,
	type ScopeOperationKind,
	umbrellaScopeFor,
} from "questpie";

import type {
	McpAccessMode,
	McpAccessRule,
	McpConfig,
	McpEntityPolicy,
	McpExecutionOptions,
	McpRequiredScopes,
	McpTransportKind,
} from "./types.js";

// The scope naming convention (`<resource>:<name>:<verb>`) and the coarse
// umbrella derivation are owned by questpie core (`scope-names.ts`) so this gate
// and the OAuth scope catalog derive from ONE source and can never drift.
// Re-exported so `@questpie/mcp`'s public API is unchanged for consumers.
export { defaultOperationScope, umbrellaScopeFor };
export type { ScopeOperationKind };

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
	requiredScopes?: McpRequiredScopes;
	operationScopes: Record<string, McpRequiredScopes>;
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
		return { expose: false, operations: {}, operationScopes: {} };
	}

	const base: ResolvedMcpPolicy = {
		expose: defaults.expose ?? true,
		read: defaults.read,
		write: defaults.write,
		delete: defaults.delete,
		operations: { ...(defaults.operations ?? {}) },
		requiredScopes: defaults.requiredScopes,
		operationScopes: { ...(defaults.operationScopes ?? {}) },
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
		requiredScopes: override.requiredScopes ?? base.requiredScopes,
		operationScopes: {
			...base.operationScopes,
			...(override.operationScopes ?? {}),
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

/** Normalize an {@link McpRequiredScopes} declaration to a scope list. */
export function normalizeRequiredScopes(
	required: McpRequiredScopes | undefined,
): string[] {
	if (required === undefined || required === false) return [];
	return typeof required === "string" ? [required] : [...required];
}

/**
 * Resolve the scopes an OAuth caller must hold for a given entity operation.
 *
 * Precedence (most specific wins), each level is declarative data:
 * 1. `policy.operationScopes[operationName]` — per-operation override.
 * 2. `policy.requiredScopes` — entity-level requirement (all operations).
 * 3. the default `<resource>:<name>:<verb>` mapping derived from the kind.
 *
 * A level set to `false` explicitly requires no scope (stops the fallback).
 * Returns a (possibly empty) scope list; empty means "no scope required". This
 * resolves the requirement; the deny/register decision that consumes it is
 * {@link scopeGateAllows}.
 */
export function requiredScopesForOperation(
	policy: ResolvedMcpPolicy,
	kind: EntityKind,
	name: string,
	operationName: string,
	operationKind: ScopeOperationKind,
): string[] {
	const perOperation = policy.operationScopes[operationName];
	if (perOperation !== undefined) return normalizeRequiredScopes(perOperation);
	if (policy.requiredScopes !== undefined) {
		return normalizeRequiredScopes(policy.requiredScopes);
	}
	return [defaultOperationScope(kind, name, operationKind)];
}

/**
 * The consented scopes carried by the request, or `undefined` when the caller
 * is not OAuth-authenticated. Reads `ctx.principal` (populated by MO6): only the
 * `oauth` principal carries `scopes`; `user` and `system` do not.
 */
export function scopesFromContext(
	ctx: AppContext & Partial<RequestContext>,
): string[] | undefined {
	const principal = ctx.principal;
	if (principal && principal.kind === "oauth") return principal.scopes;
	return undefined;
}

/**
 * The OAuth scope gate (MO8, extended by the umbrella model — LOCKED #2).
 *
 * Given the scopes the caller holds (from {@link scopesFromContext}) and the
 * scopes an operation requires (from {@link requiredScopesForOperation} or a
 * custom tool's `config.scopes`), decide whether the scope gate passes.
 *
 * Semantics:
 * - `heldScopes === undefined` → the caller is not OAuth-authenticated (`user`,
 *   `system`, or unauthenticated). The scope gate does not apply and PASSES;
 *   authorization is left entirely to RBAC / MCP rules. This is what keeps the
 *   first-party admin (`user`) and stdio (`system`) paths unchanged.
 * - Otherwise the caller is an `oauth` principal: the gate PASSES iff EVERY
 *   required scope is satisfied — a required scope is satisfied when the caller
 *   holds it directly OR holds its applicable coarse umbrella
 *   ({@link umbrellaScopeFor}). An empty `required` needs nothing, so it passes
 *   for everyone.
 *
 * The umbrella widening is deliberately narrow — it can only satisfy a
 * granular `<resource>:<name>:read|write` with the matching `<resource>:read`
 * or `<resource>:write` umbrella. `read` and `write` are independent (holding
 * `collections:write` never satisfies a `<name>:read` requirement, and vice
 * versa), and there is NO umbrella for `:delete` or `routes:…:invoke`. So the
 * umbrella grants convenience without ever over-granting across verb, resource
 * kind, or into delete/invoke.
 *
 * This gate is **additive** — it can only ever REMOVE access from an `oauth`
 * caller. It never grants access on its own: callers still run the MCP rule and
 * the collection/global `.access()` RBAC independently, and all must pass. The
 * effective `oauth` permission is therefore `scopes ∩ RBAC`.
 */
export function scopeGateAllows(
	heldScopes: string[] | undefined,
	required: string[],
): boolean {
	if (heldScopes === undefined) return true;
	if (required.length === 0) return true;
	const held = new Set(heldScopes);
	return required.every((scope) => {
		if (held.has(scope)) return true;
		const umbrella = umbrellaScopeFor(scope);
		return umbrella !== undefined && held.has(umbrella);
	});
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
		scopes: scopesFromContext(options.ctx),
		ctx: options.ctx,
	});
}
