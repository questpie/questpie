/**
 * Declarative OAuth scope catalog (MO11).
 *
 * The `@better-auth/oauth-provider` DCR (`/oauth2/register`) and `/oauth2/authorize`
 * endpoints validate every requested scope against the provider's `scopes`
 * catalog. For a real DCR-registered MCP client to obtain the GRANULAR scopes the
 * MCP scope gate requires (`collections:<name>:read|write|delete`,
 * `globals:<name>:read|write`, `routes:<key>:invoke`), those scopes must be in
 * the catalog. Core does not infer package-specific scopes from app entities.
 * Packages contribute an exact released catalog through the generic
 * `oauthScopeCatalogs` module registry, so omission cannot advertise authority.
 *
 * {@link applyOAuthScopeCatalog} merges the derived catalog into the app's
 * `oauthProvider()` at auth-instance build time (see `core/services/auth.ts`) —
 * the one place with both the resolved auth config and the fully-built `app`. The
 * static `config/auth.ts` cannot see the app's resources, so the framework wires
 * them in here, exactly as it mounts the OAuth discovery routes from core.
 */
import { oauthProvider, type OAuthOptions } from "@better-auth/oauth-provider";
import type { BetterAuthOptions } from "better-auth";

import {
	buildCrdtOAuthScopeCatalog,
	hasCrdtOAuthOwners,
} from "../crdt/oauth-scope.js";
import { questpieApiAudienceForApp } from "./api-audience.js";

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

export interface OAuthScopeCatalogContributorApp {
	config?: { app?: { url?: string } };
	crdtRegistry?: {
		collections?: Record<string, unknown>;
		globals?: Record<string, unknown>;
	};
	state?: {
		oauthScopeCatalogs?: Record<string, OAuthScopeCatalogContributor>;
	} & Record<string, unknown>;
}

export type OAuthScopeCatalogContributor = (
	app: OAuthScopeCatalogContributorApp,
) => OAuthScopeCatalog;

/** The better-auth plugin id the OAuth provider registers under. */
const OAUTH_PROVIDER_PLUGIN_ID = "oauth-provider";

type ScopeCatalogApp = OAuthScopeCatalogContributorApp;

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

/**
 * Aggregate exact package-owned OAuth scope catalogs.
 *
 * OIDC scopes (`openid`/`profile`/`email`/`offline_access`) are NOT included —
 * they are an OIDC concern owned by the provider config; the catalog only owns
 * the QUESTPIE resource scopes. {@link applyOAuthScopeCatalog} unions this with
 * whatever the provider already declares.
 */
export function buildScopeCatalog(app: ScopeCatalogApp): OAuthScopeCatalog {
	const crdt = buildCrdtOAuthScopeCatalog(app.crdtRegistry);
	const scopes: string[] = [...crdt.scopes];
	const scopesSupported: string[] = [...crdt.scopesSupported];
	for (const contributor of Object.values(
		app.state?.oauthScopeCatalogs ?? {},
	)) {
		const contribution = contributor(app);
		for (const scope of contribution.scopes) {
			if (!scopes.includes(scope)) scopes.push(scope);
		}
		for (const scope of contribution.scopesSupported) {
			if (!scopesSupported.includes(scope)) scopesSupported.push(scope);
		}
	}
	return { scopes, scopesSupported };
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
	const crdtAudience =
		hasCrdtOAuthOwners(app.crdtRegistry) &&
		typeof app.config?.app?.url === "string"
			? questpieApiAudienceForApp(app as { config: { app: { url: string } } })
			: undefined;

	const nextPlugins = plugins.map((plugin) => {
		if (plugin?.id !== OAUTH_PROVIDER_PLUGIN_ID) return plugin;
		const options = (plugin as { options?: OAuthOptions<string[]> }).options;
		if (!options) return plugin;
		return oauthProvider({
			...options,
			scopes: unique([...(options.scopes ?? []), ...catalog.scopes]),
			validAudiences: unique([
				...(options.validAudiences ?? []),
				...(crdtAudience ? [crdtAudience] : []),
			]),
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
