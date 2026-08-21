import type { AppContext, Questpie, RequestContext } from "questpie";
import {
	defaultOperationScope,
	type ScopeOperationKind,
	umbrellaScopeFor,
} from "questpie";

import { validateMcpPrincipal } from "./principal.js";
import type {
	McpAccessRule,
	McpConfig,
	McpEntityPolicy,
	McpExecutionOptions,
	McpWorkloadRequirement,
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
	Pick<
		McpConfig,
		"crud" | "routes" | "resources" | "http" | "stdio" | "execution"
	>
> = {
	crud: {
		maxLimit: 100,
		collections: {},
		globals: {},
	},
	routes: {
		routes: {},
	},
	resources: {},
	http: {
		accessMode: "user",
		enableJsonResponse: true,
	},
	stdio: {
		trustedMaintenance: false,
	},
	execution: {},
};

export type EntityKind = "collection" | "global" | "route";

export interface ResolvedMcpPolicy {
	expose: boolean;
	operations: Record<string, boolean | McpAccessRule>;
	requiredScopes?: McpRequiredScopes;
	operationScopes: Record<string, McpRequiredScopes>;
	workload?: McpWorkloadRequirement;
	operationWorkloads: Record<string, McpWorkloadRequirement>;
	fields?: { include?: string[]; exclude?: string[] };
	relationLoading?: boolean;
	description?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

const UNSAFE_CONFIG_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function ownDataEntries(value: unknown): Array<[string, unknown]> {
	if (!isPlainObject(value)) return [];
	try {
		return Object.entries(Object.getOwnPropertyDescriptors(value))
			.filter(
				([key, descriptor]) =>
					!UNSAFE_CONFIG_KEYS.has(key) && "value" in descriptor,
			)
			.map(([key, descriptor]) => [
				key,
				(descriptor as PropertyDescriptor & { value: unknown }).value,
			]);
	} catch {
		return [];
	}
}

function safeCloneConfigValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => safeCloneConfigValue(entry));
	}
	if (!isPlainObject(value)) return value;
	const clone: Record<string, unknown> = Object.create(null);
	for (const [key, entry] of ownDataEntries(value)) {
		clone[key] = safeCloneConfigValue(entry);
	}
	return clone;
}

function mergeDeep<T extends Record<string, unknown>>(
	base: T,
	override?: Record<string, unknown>,
): T {
	const out = safeCloneConfigValue(base) as Record<string, unknown>;
	for (const [key, value] of ownDataEntries(override)) {
		if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = mergeDeep(out[key] as Record<string, unknown>, value);
		} else if (value !== undefined) {
			out[key] = safeCloneConfigValue(value);
		}
	}
	return out as T;
}

function ownValue<T>(
	record: Record<string, T> | undefined,
	key: string,
): T | undefined {
	if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
		return undefined;
	}
	return record[key];
}

function replaceOwnEntries<T>(
	base: Record<string, T> | undefined,
	override: Record<string, T>,
): Record<string, T> {
	const next = safeCloneConfigValue(base ?? {}) as Record<string, T>;
	for (const [key, value] of ownDataEntries(override)) {
		next[key] = safeCloneConfigValue(value) as T;
	}
	return next;
}

export function resolveMcpConfig(
	app: Questpie<any>,
	override?: McpConfig,
): McpConfig {
	const appConfig = (app.state?.config?.mcp ?? {}) as McpConfig;
	const safeOverride = safeCloneConfigValue(override) as McpConfig | undefined;
	const resolved = mergeDeep(
		mergeDeep(
			DEFAULT_MCP_CONFIG as unknown as Record<string, unknown>,
			appConfig as Record<string, unknown>,
		),
		safeOverride as Record<string, unknown> | undefined,
	) as McpConfig;
	if (safeOverride?.crud?.collections) {
		resolved.crud = {
			...resolved.crud,
			collections: replaceOwnEntries(
				resolved.crud?.collections,
				safeOverride.crud.collections,
			),
		};
	}
	if (safeOverride?.crud?.globals) {
		resolved.crud = {
			...resolved.crud,
			globals: replaceOwnEntries(
				resolved.crud?.globals,
				safeOverride.crud.globals,
			),
		};
	}
	if (safeOverride?.routes?.routes) {
		resolved.routes = {
			...resolved.routes,
			routes: replaceOwnEntries(
				resolved.routes?.routes,
				safeOverride.routes.routes,
			),
		};
	}
	return resolved;
}

/**
 * Resolve workload authority maps atomically. A caller-provided map replaces
 * the corresponding app map instead of inheriting entries or nested authority.
 */
export function resolveWorkloadMcpConfig(
	app: Questpie<any>,
	override?: McpConfig,
): McpConfig {
	const resolved = resolveMcpConfig(app, override);
	if (!override) return resolved;
	const safeOverride = safeCloneConfigValue(override) as McpConfig;

	if (
		Object.prototype.hasOwnProperty.call(safeOverride.crud ?? {}, "collections")
	) {
		resolved.crud = {
			...resolved.crud,
			collections: safeCloneConfigValue(
				safeOverride.crud?.collections ?? {},
			) as Record<string, McpEntityPolicy>,
		};
	}
	if (
		Object.prototype.hasOwnProperty.call(safeOverride.crud ?? {}, "globals")
	) {
		resolved.crud = {
			...resolved.crud,
			globals: safeCloneConfigValue(safeOverride.crud?.globals ?? {}) as Record<
				string,
				McpEntityPolicy
			>,
		};
	}
	if (
		Object.prototype.hasOwnProperty.call(safeOverride.routes ?? {}, "routes")
	) {
		resolved.routes = {
			...resolved.routes,
			routes: safeCloneConfigValue(safeOverride.routes?.routes ?? {}) as Record<
				string,
				McpEntityPolicy
			>,
		};
	}
	for (const kind of ["collections", "globals", "routes"] as const) {
		if (
			Object.prototype.hasOwnProperty.call(safeOverride.resources ?? {}, kind)
		) {
			resolved.resources = {
				...resolved.resources,
				[kind]: safeCloneConfigValue(
					safeOverride.resources?.[kind] ?? {},
				) as Record<string, boolean>,
			};
		}
	}
	return resolved;
}

export function resolveEntityPolicy(
	config: McpConfig,
	kind: EntityKind,
	name: string,
	_transport: McpTransportKind = "http",
): ResolvedMcpPolicy {
	const crud = ownValue(config as unknown as Record<string, unknown>, "crud") as
		| McpConfig["crud"]
		| undefined;
	const routes = ownValue(
		config as unknown as Record<string, unknown>,
		"routes",
	) as McpConfig["routes"] | undefined;
	if (kind === "route") {
		const routePolicies = ownValue(
			routes as unknown as Record<string, unknown>,
			"routes",
		) as Record<string, McpEntityPolicy> | undefined;
		const override = ownValue(routePolicies, name);
		return normalizePolicy({ expose: false }, override);
	}

	if (kind === "global") {
		const globals = ownValue(
			crud as unknown as Record<string, Record<string, McpEntityPolicy>>,
			"globals",
		);
		const override = ownValue(globals, name);
		return normalizePolicy({ expose: false }, override);
	}

	const collections = ownValue(
		crud as unknown as Record<string, Record<string, McpEntityPolicy>>,
		"collections",
	);
	const override = ownValue(collections, name);
	return normalizePolicy({ expose: false }, override);
}

function normalizePolicy(
	defaults: Partial<ResolvedMcpPolicy>,
	override?: McpEntityPolicy,
): ResolvedMcpPolicy {
	override = safeCloneConfigValue(override) as McpEntityPolicy | undefined;
	if (override === false) {
		return {
			expose: false,
			operations: {},
			operationScopes: {},
			operationWorkloads: {},
		};
	}

	const base: ResolvedMcpPolicy = {
		expose: defaults.expose ?? true,
		operations: { ...(defaults.operations ?? {}) },
		requiredScopes: defaults.requiredScopes,
		operationScopes: { ...(defaults.operationScopes ?? {}) },
		workload: defaults.workload,
		operationWorkloads: { ...(defaults.operationWorkloads ?? {}) },
		fields: defaults.fields,
		relationLoading: defaults.relationLoading,
		description: defaults.description,
	};

	if (override === undefined) return base;
	if (override === true) return { ...base, expose: true };

	return {
		...base,
		...override,
		expose: override.expose ?? true,
		operations: {
			...base.operations,
			...(override.operations ?? {}),
		},
		requiredScopes: override.requiredScopes ?? base.requiredScopes,
		operationScopes: {
			...base.operationScopes,
			...(override.operationScopes ?? {}),
		},
		workload: override.workload ?? base.workload,
		operationWorkloads: {
			...base.operationWorkloads,
			...(override.operationWorkloads ?? {}),
		},
	};
}

export function workloadRequirementForOperation(
	policy: ResolvedMcpPolicy,
	operation: string,
): McpWorkloadRequirement | undefined {
	return policy.operationWorkloads[operation] ?? policy.workload;
}

export function operationRule(
	policy: ResolvedMcpPolicy,
	operation: string,
): boolean | McpAccessRule | undefined {
	return policy.operations[operation];
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
): string[] | undefined | null {
	const principal = ctx.principal;
	if (principal === undefined || principal === null) return undefined;
	const validated = validateMcpPrincipal(principal);
	if (!validated) return null;
	return validated.kind === "oauth" ? validated.scopes : undefined;
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
	heldScopes: string[] | undefined | null,
	required: string[],
): boolean {
	if (heldScopes === null) return false;
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
	const scopes = scopesFromContext(options.ctx);
	if (scopes === null) return false;
	if (rule === undefined) return true;
	if (typeof rule === "boolean") return rule;
	return rule({
		transport: options.transport,
		accessMode: options.accessMode,
		session: options.ctx.session,
		scopes,
		ctx: options.ctx,
	});
}
