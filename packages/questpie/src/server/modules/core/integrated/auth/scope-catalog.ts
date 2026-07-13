/**
 * Declarative OAuth scope catalog (MO11).
 *
 * The `@better-auth/oauth-provider` DCR (`/oauth2/register`) and `/oauth2/authorize`
 * endpoints validate every requested scope against the provider's `scopes`
 * catalog. For a real DCR-registered MCP client to obtain the GRANULAR scopes the
 * MCP scope gate requires (`collections:<name>:read|write|delete`,
 * `globals:<name>:read|write`, `routes:<key>:invoke`), those scopes must be in
 * the catalog. This module derives that catalog from the app's discovered
 * collections / globals / routes — the SAME declarative source the gate derives
 * its required scopes from (both call {@link defaultOperationScope}) — so the two
 * halves can never drift, and adding a collection/global/route contributes its
 * scopes for free (QUESTPIE invariant: scales without touching framework code).
 *
 * {@link applyOAuthScopeCatalog} merges the derived catalog into the app's
 * `oauthProvider()` at auth-instance build time (see `core/services/auth.ts`) —
 * the one place with both the resolved auth config and the fully-built `app`. The
 * static `config/auth.ts` cannot see the app's resources, so the framework wires
 * them in here, exactly as it mounts the OAuth discovery routes from core.
 */
import { oauthProvider, type OAuthOptions } from "@better-auth/oauth-provider";
import type { BetterAuthOptions } from "better-auth";

import { introspectRoutes } from "#questpie/server/routes/introspection.js";
import { isJsonRoute, type RoutesTree } from "#questpie/server/routes/types.js";

import {
	defaultOperationScope,
	SCOPE_RESOURCE_BY_KIND,
	UMBRELLA_ELIGIBLE_VERBS,
} from "./scope-names.js";

export interface OAuthScopeCatalog {
	/**
	 * Every grantable QUESTPIE resource scope: the coarse collection umbrellas
	 * (LOCKED #2) plus the granular per-resource scopes. Merged into
	 * `oauthProvider.scopes` — the set a client may request at DCR / authorize.
	 */
	scopes: string[];
	/**
	 * The public subset advertised at the discovery endpoint
	 * (`advertisedMetadata.scopes_supported`): the coarse umbrellas only. The
	 * granular per-resource scopes stay grantable but are NOT publicly
	 * enumerated, so discovery does not leak the app's full resource inventory.
	 */
	scopesSupported: string[];
}

/** The better-auth plugin id the OAuth provider registers under. */
const OAUTH_PROVIDER_PLUGIN_ID = "oauth-provider";

type ScopeCatalogApp = {
	getCollections(): object;
	getGlobals(): object;
	config?: {
		routes?: RoutesTree;
	};
};

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

/**
 * Derive the OAuth scope catalog from the app's discovered resources.
 *
 * - collections → `collections:<name>:read|write|delete`
 * - globals     → `globals:<name>:read|write`
 * - routes      → `routes:<key>:invoke`, only for MCP-exposed JSON routes
 *   (`meta.mcp.expose === true`) — exactly the routes the MCP gate scopes.
 * - plus the coarse collection umbrellas `collections:read` / `collections:write`.
 *
 * OIDC scopes (`openid`/`profile`/`email`/`offline_access`) are NOT included —
 * they are an OIDC concern owned by the provider config; the catalog only owns
 * the QUESTPIE resource scopes. {@link applyOAuthScopeCatalog} unions this with
 * whatever the provider already declares.
 */
export function buildScopeCatalog(app: ScopeCatalogApp): OAuthScopeCatalog {
	const scopes = new Set<string>();

	// Coarse collection umbrellas (LOCKED #2): only collections get umbrellas,
	// only for the umbrella-eligible verbs (read/write). Derived from the shared
	// UMBRELLA_ELIGIBLE_VERBS so the catalog and the gate agree on which verbs
	// have an umbrella.
	const umbrellas: string[] = [];
	for (const verb of UMBRELLA_ELIGIBLE_VERBS) {
		umbrellas.push(`${SCOPE_RESOURCE_BY_KIND.collection}:${verb}`);
	}
	for (const umbrella of umbrellas) scopes.add(umbrella);

	for (const name of Object.keys(app.getCollections())) {
		scopes.add(defaultOperationScope("collection", name, "read"));
		scopes.add(defaultOperationScope("collection", name, "write"));
		scopes.add(defaultOperationScope("collection", name, "delete"));
	}

	for (const name of Object.keys(app.getGlobals())) {
		scopes.add(defaultOperationScope("global", name, "read"));
		scopes.add(defaultOperationScope("global", name, "write"));
	}

	for (const route of introspectRoutes(app)) {
		if (!isJsonRoute(route.definition)) continue;
		if (route.meta?.mcp?.expose !== true) continue;
		scopes.add(defaultOperationScope("route", route.key, "invoke"));
	}

	return { scopes: [...scopes], scopesSupported: umbrellas };
}

/**
 * Merge the derived scope catalog into the app's `oauthProvider()` plugin.
 *
 * A no-op unless an `oauth-provider` plugin is present. When it is, the plugin is
 * rebuilt through its public factory (`oauthProvider({ ...plugin.options, … })`)
 * with the catalog UNIONED into `scopes` and the public subset unioned into
 * `advertisedMetadata.scopes_supported`. Reconstruction (rather than mutating the
 * plugin's captured options) keeps this on the provider's public API and re-runs
 * its construction-time validation. The union preserves the provider's own
 * scopes (OIDC + any user additions) — the catalog only ever ADDS resource
 * scopes, never removes.
 */
export function applyOAuthScopeCatalog(
	app: ScopeCatalogApp,
	authOptions: BetterAuthOptions,
): BetterAuthOptions {
	const plugins = authOptions.plugins;
	if (!plugins?.some((plugin) => plugin?.id === OAUTH_PROVIDER_PLUGIN_ID)) {
		return authOptions;
	}

	const catalog = buildScopeCatalog(app);

	const nextPlugins = plugins.map((plugin) => {
		if (plugin?.id !== OAUTH_PROVIDER_PLUGIN_ID) return plugin;
		const options = (plugin as { options?: OAuthOptions<string[]> }).options;
		if (!options) return plugin;
		return oauthProvider({
			...options,
			scopes: unique([...(options.scopes ?? []), ...catalog.scopes]),
			advertisedMetadata: {
				...options.advertisedMetadata,
				scopes_supported: unique([
					...(options.advertisedMetadata?.scopes_supported ?? []),
					...catalog.scopesSupported,
				]),
			},
		});
	});

	return { ...authOptions, plugins: nextPlugins };
}
