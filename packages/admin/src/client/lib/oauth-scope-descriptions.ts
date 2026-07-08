/**
 * OAuth scope → human-readable description.
 *
 * Renders the scopes an OAuth client requests on the consent screen as plain
 * English the granting user can reason about. Declarative by design: standard
 * OIDC scopes have fixed copy, and the per-resource QUESTPIE scopes
 * (`collections:<name>:read|write|delete`, `globals:<name>:read|write`,
 * `routes:<key>:invoke`, plus the coarse `collections:read|write` umbrellas from
 * the MO1 scope model) are described by pattern so new resources need no code
 * change here. Anything unrecognised falls back to a readable rendering of the
 * raw scope string — never a blank row.
 */

/** A resolved, display-ready scope. */
export interface ScopeDescription {
	/** The raw scope string (e.g. `collections:posts:read`). */
	scope: string;
	/** Short human-readable summary (e.g. "Read the Posts collection"). */
	label: string;
}

/** Standard OIDC / auth scopes with fixed copy. */
const STANDARD_SCOPES: Record<string, string> = {
	openid: "Verify your identity",
	profile: "View your basic profile information",
	email: "View your email address",
	offline_access: "Stay connected while you are away (refresh access)",
};

/** Coarse umbrella scopes from the MO1 scope model. */
const UMBRELLA_SCOPES: Record<string, string> = {
	"collections:read": "Read all your collections",
	"collections:write": "Create and update all your collections",
	"collections:delete": "Delete records in all your collections",
	"globals:read": "Read all your globals",
	"globals:write": "Update all your globals",
};

/** Verb → clause for per-resource scopes. */
const OPERATION_CLAUSE: Record<string, string> = {
	read: "Read",
	write: "Create and update",
	delete: "Delete records in",
	invoke: "Run",
};

/** Turn a resource key like `blog_posts` into `Blog posts` for display. */
function humanizeResource(name: string): string {
	const spaced = name.replace(/[_-]+/g, " ").trim();
	if (!spaced) return name;
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Resolve a single scope string to a human-readable label.
 *
 * Resolution order: standard OIDC → coarse umbrella → per-resource pattern →
 * raw-string fallback.
 */
export function describeScope(scope: string): string {
	const trimmed = scope.trim();
	if (!trimmed) return scope;

	const standard = STANDARD_SCOPES[trimmed];
	if (standard) return standard;

	const umbrella = UMBRELLA_SCOPES[trimmed];
	if (umbrella) return umbrella;

	const parts = trimmed.split(":");

	// collections:<name>:<op> | globals:<name>:<op>
	if (
		(parts[0] === "collections" || parts[0] === "globals") &&
		parts.length === 3
	) {
		const clause = OPERATION_CLAUSE[parts[2]];
		if (clause) {
			return `${clause} the ${humanizeResource(parts[1])} ${
				parts[0] === "collections" ? "collection" : "global"
			}`;
		}
	}

	// routes:<key>:invoke
	if (parts[0] === "routes" && parts.length === 3 && parts[2] === "invoke") {
		return `Run the ${humanizeResource(parts[1])} action`;
	}

	// Unknown scope — render the raw string readably rather than a blank row.
	return humanizeResource(trimmed.replace(/:/g, " "));
}

/**
 * Parse a space-separated scope string into display-ready descriptions,
 * dropping empties and de-duplicating while preserving order.
 */
export function describeScopes(
	rawScope: string | null | undefined,
): ScopeDescription[] {
	if (!rawScope) return [];
	const seen = new Set<string>();
	const result: ScopeDescription[] = [];
	for (const scope of rawScope.split(/\s+/)) {
		const trimmed = scope.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push({ scope: trimmed, label: describeScope(trimmed) });
	}
	return result;
}
