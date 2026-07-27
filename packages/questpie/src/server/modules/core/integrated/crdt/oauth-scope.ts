import type { Principal } from "#questpie/server/config/context.js";
import {
	defaultOperationScope,
	umbrellaScopeFor,
} from "#questpie/server/modules/core/integrated/auth/scope-names.js";

type CrdtOAuthOwner = Readonly<{
	kind: "collection" | "global";
	key: string;
}>;

type CrdtOAuthRegistry = Readonly<{
	collections?: Readonly<Record<string, unknown>>;
	globals?: Readonly<Record<string, unknown>>;
}>;

export function oauthCrdtScopesAllow(
	principal: Extract<Principal, { kind: "oauth" }>,
	owner: CrdtOAuthOwner,
	mode: "view" | "edit",
): boolean {
	const required = [
		defaultOperationScope(owner.kind, owner.key, "read"),
		...(mode === "edit"
			? [defaultOperationScope(owner.kind, owner.key, "write")]
			: []),
	];
	const held = new Set(principal.scopes);
	return required.every((scope) => {
		if (held.has(scope)) return true;
		const umbrella = umbrellaScopeFor(scope);
		return umbrella !== undefined && held.has(umbrella);
	});
}

export function buildCrdtOAuthScopeCatalog(registry?: CrdtOAuthRegistry): {
	scopes: string[];
	scopesSupported: string[];
} {
	const scopes: string[] = [];
	const scopesSupported: string[] = [];
	for (const [kind, owners] of [
		["collection", registry?.collections],
		["global", registry?.globals],
	] as const) {
		for (const key of Object.keys(owners ?? {}).sort()) {
			for (const operation of ["read", "write"] as const) {
				const scope = defaultOperationScope(kind, key, operation);
				scopes.push(scope);
				const umbrella = umbrellaScopeFor(scope);
				if (umbrella && !scopesSupported.includes(umbrella)) {
					scopesSupported.push(umbrella);
				}
				if (umbrella && !scopes.includes(umbrella)) {
					scopes.push(umbrella);
				}
			}
		}
	}
	return { scopes, scopesSupported };
}

export function hasCrdtOAuthOwners(registry?: CrdtOAuthRegistry): boolean {
	return (
		Object.keys(registry?.collections ?? {}).length > 0 ||
		Object.keys(registry?.globals ?? {}).length > 0
	);
}
