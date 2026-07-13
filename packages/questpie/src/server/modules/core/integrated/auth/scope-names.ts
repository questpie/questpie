// ============================================================================
// Declarative OAuth scope naming (MO7 / MO11)
//
// The scope naming convention lives HERE, in core, as the single source both
// consumers derive from:
//   - `@questpie/mcp`'s scope gate derives the REQUIRED scope for a tool call.
//   - the OAuth scope catalog (`scope-catalog.ts`) derives the AVAILABLE scopes
//     seeded into the `oauthProvider({ scopes })` catalog.
// Because both sides call the SAME functions, the catalog a client can request
// and the gate that checks it can never drift (QUESTPIE "consistent naming"
// invariant). `questpie` cannot depend on `@questpie/mcp`, so the shared
// primitive is owned by core and re-exported from `@questpie/mcp` for
// back-compat.
//
// The mapping is expressed as DATA, parameterized by (entity kind, entity name,
// operation kind), NOT as a switch over entity names. Adding a
// collection/global/route contributes its scopes for free — the mapping scales
// without touching framework code.
// ============================================================================

/** The three resource kinds a scope can address. */
export type ScopeEntityKind = "collection" | "global" | "route";

export type ScopeOperationKind = "read" | "write" | "delete" | "invoke";

/**
 * The `<resource>` segment of a scope, keyed by entity kind. Data, not a
 * `switch (kind)`. e.g. a collection named `posts` maps under `collections:…`.
 */
export const SCOPE_RESOURCE_BY_KIND: Record<ScopeEntityKind, string> = {
	collection: "collections",
	global: "globals",
	route: "routes",
};

/**
 * Operation kind → the scope verb it requires. CRUD reads/writes/deletes map to
 * `read`/`write`/`delete`; a route invocation maps to `invoke`. Keyed by kind
 * (not operation name), so `list`/`get`/`count` all resolve to `read` etc.
 */
export const SCOPE_VERB_BY_OPERATION_KIND: Record<ScopeOperationKind, string> =
	{
		read: "read",
		write: "write",
		delete: "delete",
		invoke: "invoke",
	};

/**
 * Build the default required scope for an entity operation from the declarative
 * mapping: `<resource>:<name>:<verb>` — e.g. `collections:posts:read`,
 * `globals:siteSettings:write`, `routes:reports/generate:invoke`.
 */
export function defaultOperationScope(
	kind: ScopeEntityKind,
	name: string,
	operationKind: ScopeOperationKind,
): string {
	return `${SCOPE_RESOURCE_BY_KIND[kind]}:${name}:${SCOPE_VERB_BY_OPERATION_KIND[operationKind]}`;
}

/**
 * Verbs that have a coarse umbrella scope (LOCKED #2 lists read/write only). A
 * granular `<resource>:<name>:<verb>` requirement is ALSO satisfied by the
 * held coarse `<resource>:<verb>` umbrella — but ONLY for these verbs. Data,
 * not a `switch (verb)`: `delete` and `invoke` are absent, so they have NO
 * umbrella (least-privilege — a `:delete` requirement always needs the exact
 * granular scope, never a coarse grant).
 */
export const UMBRELLA_ELIGIBLE_VERBS = new Set(["read", "write"]);

/**
 * The coarse umbrella scope that satisfies a granular `required` scope, or
 * `undefined` when none applies. Parses the scope string generically (no
 * per-name / per-resource hardcoding): a granular scope is exactly
 * `<resource>:<name>:<verb>` (three segments). Its umbrella is
 * `<resource>:<verb>` — preserving the SAME `<resource>` segment, so
 * `collections:posts:read` maps to `collections:read` and never to
 * `globals:read` (cross-resource-kind isolation falls out of the parse). The
 * verb must be umbrella-eligible ({@link UMBRELLA_ELIGIBLE_VERBS}); otherwise
 * there is no umbrella. Non-three-segment inputs (an umbrella itself, or a
 * custom scope like `custom:scoped:use`) yield `undefined` — a custom scope
 * happens to have three segments but its verb is not read/write, so it never
 * gains an umbrella.
 */
export function umbrellaScopeFor(required: string): string | undefined {
	const segments = required.split(":");
	if (segments.length !== 3) return undefined;
	const [resource, , verb] = segments;
	if (!UMBRELLA_ELIGIBLE_VERBS.has(verb)) return undefined;
	return `${resource}:${verb}`;
}
