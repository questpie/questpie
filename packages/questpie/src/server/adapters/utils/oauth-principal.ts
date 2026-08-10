/**
 * OAuth access-token → `oauth` principal resolution (MCP over OAuth 2.1).
 *
 * This is the security boundary for OAuth-authenticated requests. Given an
 * incoming request, it decides whether the `Authorization: Bearer <token>` is a
 * *signed OAuth 2.1 access token* (a JWT minted by this app's Better Auth
 * OAuth provider) as opposed to an opaque Better Auth session bearer, and — if
 * so and it verifies — resolves it to an `oauth` {@link Principal} carrying the
 * real user plus the consented scopes.
 *
 * Design (per the locked MO1 decisions + spec §3/§4 Phase 1):
 * - **Stateless verification.** The token is verified locally against the auth
 *   server's JWKS via `verifyAccessToken` (no DB round-trip on the hot path).
 *   `oauthProviderResourceClient(app.auth)` derives the `issuer` and `jwksUrl`
 *   straight from the running auth instance (its `baseURL` / `jwt()` plugin
 *   options), so they always match however tokens were issued — no re-derivation
 *   drift. We only supply the `audience`.
 * - **Audience binding (RFC 8707).** `audience` is the MCP endpoint URL
 *   (`<app.url>/api/mcp`), the same value MO2 sets as
 *   `oauthProvider.validAudiences`. `verifyAccessToken` rejects a token whose
 *   `aud` does not match, so a token minted for another resource cannot be
 *   replayed here.
 * - **RBAC still applies.** The returned principal is `kind: "oauth"`, from
 *   which `accessMode` derives to `"user"` (never `"system"`) — the user's
 *   `.access()` rules run unchanged as that user. Scopes are carried but *not*
 *   enforced here; the `@questpie/mcp` scope gate (`scopeGateAllows`) applies
 *   them as an additional narrowing gate layered on top of RBAC, so the
 *   effective `oauth` permission is `scopes ∩ RBAC`.
 *
 * Security invariants (must hold — see the negative unit tests):
 * - An invalid / expired / wrong-`aud` / wrong-`iss` / malformed / unsigned
 *   token resolves to **no principal** here. It never yields a privileged
 *   context: the caller falls through to the normal session path, where a bad
 *   token produces `null` (unauthenticated), and `system` mode is only ever set
 *   explicitly by trusted transports (stdio), never derived from a token.
 * - `alg: none` / unsigned tokens are impossible to pass: local verification
 *   goes through `jose`'s `jwtVerify` against a JWKS, which requires a signature
 *   matching a published key. (The library's unsigned-token path is only reached
 *   under remote introspection, which we do not use.)
 */

import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { User } from "better-auth/types";

import type { Principal } from "../../config/context.js";
import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { questpieApiAudienceForApp } from "../../modules/core/integrated/auth/api-audience.js";
import type { AdapterConfig } from "../types.js";

export { questpieApiAudienceForApp };

/**
 * The resolved OAuth identity for a request. `session` mirrors Better Auth's
 * `{ user, session }` shape so the existing `ctx.session.user` plumbing (and
 * therefore every `.access()` rule) keeps working unchanged for the OAuth case.
 */
export type ResolvedOAuthPrincipal = {
	principal: Extract<Principal, { kind: "oauth" }>;
	session: { user: User; session: unknown };
};

/**
 * Extract the raw bearer credential from the `Authorization` header, or
 * `undefined` when the request carries no bearer.
 */
function getBearerToken(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1]?.trim() || undefined;
}

/**
 * Cheap structural gate: does the credential *look like* a signed JWT (JWS
 * compact serialization)? This lets us skip OAuth verification entirely for
 * opaque Better Auth session bearers, which are not JWTs.
 *
 * A JWS compact token is three non-empty base64url segments separated by dots,
 * whose first segment decodes to a JSON object with an `alg`. We deliberately do
 * NOT trust anything in the header for authorization — this is only a routing
 * hint to decide whether to attempt cryptographic verification. The actual
 * security decision is made by `verifyAccessToken` (signature + `aud`/`iss`/
 * `exp`). An `alg: "none"` header would still pass this shape check, but such a
 * token can never pass verification (see the module docblock).
 */
function looksLikeJwt(token: string): boolean {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	if (!parts[0] || !parts[1] || !parts[2]) return false;
	try {
		const headerJson = Buffer.from(parts[0], "base64url").toString("utf8");
		const header = JSON.parse(headerJson) as unknown;
		return (
			typeof header === "object" &&
			header !== null &&
			"alg" in header &&
			typeof (header as { alg: unknown }).alg === "string"
		);
	} catch {
		return false;
	}
}

/**
 * The MCP endpoint URL an OAuth access token must be bound to (`aud`). Derived
 * from the app URL + the `/api/mcp` route path — identical to the derivation MO2
 * uses for `oauthProvider.validAudiences` in the starter auth config, so an
 * issued token's `aud` matches by construction.
 */
export function mcpAudienceForApp(app: {
	config: { app: { url: string } };
}): string {
	return `${app.config.app.url.replace(/\/$/, "")}/api/mcp`;
}

/**
 * The `iss` an OAuth 2.1 access token issued by this app's Better Auth provider
 * carries, derived from the running auth instance so it matches the token by
 * construction, and passed to `verifyAccessToken` explicitly.
 *
 * The provider mints the token `iss` as `jwt().options.jwt.issuer ?? ctx.baseURL`,
 * where `ctx.baseURL` is `options.baseURL` **with the auth basePath appended**
 * (default `/api/auth`). The `@better-auth/oauth-provider` resource client,
 * however, defaults the *expected* issuer to `jwt issuer ?? options.baseURL`
 * (the BARE baseURL, no basePath). So when no explicit `jwt().issuer` is set —
 * the common case, including the QUESTPIE starter — every real token is rejected
 * on an issuer mismatch (`baseURL` vs `baseURL + basePath`). We mirror the
 * provider's own derivation here:
 *   1. an explicit `jwt().options.jwt.issuer`, if set (already matches on both
 *      sides — pass-through), else
 *   2. `baseURL + basePath` (the real token `iss` when there is no explicit
 *      issuer — the case the resource client gets wrong).
 *
 * Returns `undefined` only when `baseURL` is not a plain string (dynamic
 * multi-host config) and no explicit issuer is set, letting the resource client
 * fall back to its own derivation.
 */
export async function oauthIssuerForAuth(auth: {
	options?: { baseURL?: unknown; basePath?: unknown };
	$context?: Promise<unknown>;
}): Promise<string | undefined> {
	// Prefer an explicit jwt() issuer (the provider does the same for the token).
	try {
		const ctx = (await auth.$context) as
			| { getPlugin?: (name: string) => { options?: unknown } | undefined }
			| undefined;
		const jwtOptions = ctx?.getPlugin?.("jwt")?.options as
			| { jwt?: { issuer?: unknown } }
			| undefined;
		const explicit = jwtOptions?.jwt?.issuer;
		if (typeof explicit === "string" && explicit.length > 0) return explicit;
	} catch {
		// Fall through to the baseURL + basePath derivation.
	}

	const baseURL = auth.options?.baseURL;
	if (typeof baseURL !== "string" || baseURL.length === 0) return undefined;
	const basePath =
		typeof auth.options?.basePath === "string"
			? auth.options.basePath
			: "/api/auth";
	return `${baseURL.replace(/\/$/, "")}${basePath}`;
}

/**
 * The JWKS endpoint used by the running Better Auth instance.
 *
 * The resource client treats an absent `auth.options.basePath` as an empty
 * string. Better Auth itself treats it as `/api/auth`, so its default JWKS
 * route is `/api/auth/jwks`. Derive the URL with Better Auth's real default and
 * preserve explicit JWT remote URLs and paths.
 */
async function oauthJwksUrlForAuth(auth: {
	options?: { baseURL?: unknown; basePath?: unknown };
	$context?: Promise<unknown>;
}): Promise<string | undefined> {
	let jwksOptions: { remoteUrl?: unknown; jwksPath?: unknown } | undefined;
	try {
		const ctx = (await auth.$context) as
			| { getPlugin?: (name: string) => { options?: unknown } | undefined }
			| undefined;
		jwksOptions = (
			ctx?.getPlugin?.("jwt")?.options as
				| { jwks?: { remoteUrl?: unknown; jwksPath?: unknown } }
				| undefined
		)?.jwks;
	} catch {
		// Fall through to the Better Auth route defaults.
	}

	if (
		typeof jwksOptions?.remoteUrl === "string" &&
		jwksOptions.remoteUrl.length > 0
	) {
		return jwksOptions.remoteUrl;
	}

	const baseURL = auth.options?.baseURL;
	if (typeof baseURL !== "string" || baseURL.length === 0) return undefined;
	const basePath =
		typeof auth.options?.basePath === "string"
			? auth.options.basePath
			: "/api/auth";
	const jwksPath =
		typeof jwksOptions?.jwksPath === "string" ? jwksOptions.jwksPath : "/jwks";
	const path = [basePath, jwksPath]
		.map((part) => part.replace(/^\/+|\/+$/g, ""))
		.filter(Boolean)
		.join("/");
	return `${baseURL.replace(/\/+$/, "")}/${path}`;
}

/**
 * The JWS algorithm(s) an OAuth access token may be signed with. Better Auth's
 * `jwt()` plugin — which backs the OAuth provider — signs with EdDSA (Ed25519)
 * by default, and that is what the QUESTPIE starter issues. Pinning verification
 * to this exact set is defense-in-depth against algorithm substitution: a token
 * presenting any other `alg` (a symmetric `HS*`, `none`, or a different
 * asymmetric family) is rejected by `verifyAccessToken` before its signature is
 * even checked — independent of what keys the JWKS happens to expose.
 */
const EXPECTED_TOKEN_ALGORITHMS = ["EdDSA"];

/**
 * Parse the space-delimited OAuth `scope` claim into a deduped, order-preserving
 * list. Returns `[]` for a missing/empty claim.
 */
function parseScopes(scopeClaim: unknown): string[] {
	if (typeof scopeClaim !== "string") return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of scopeClaim.split(/\s+/)) {
		const scope = raw.trim();
		if (!scope || seen.has(scope)) continue;
		seen.add(scope);
		out.push(scope);
	}
	return out;
}

/**
 * Attempt to resolve an `oauth` principal from the request's bearer token.
 *
 * Returns the resolved principal + session on success, or `null` when the
 * request is not OAuth-authenticated — either because there is no bearer, the
 * bearer is not JWT-shaped (an opaque session token), verification fails, or the
 * `sub` no longer maps to a user. In every `null` case the caller MUST fall
 * through to the normal session resolution; a `null` here never grants access.
 *
 * A custom `config.getSession` opts the app out of the framework's Better Auth
 * integration entirely, so OAuth resolution is skipped in that case too.
 */
export async function resolveOAuthPrincipal<
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	expectedAudience?: string,
): Promise<ResolvedOAuthPrincipal | null> {
	// A custom session resolver replaces the whole Better Auth path — don't
	// second-guess it with token verification.
	if (config.getSession) return null;
	if (!app.auth) return null;

	const token = getBearerToken(request);
	if (!token || !looksLikeJwt(token)) return null;
	const audience = expectedAudience ?? mcpAudienceForApp(app);

	let payload: Record<string, unknown>;
	try {
		const resourceClient = oauthProviderResourceClient(app.auth);
		// `jwksUrl` is auto-derived from the auth instance (baseURL + basePath +
		// jwksPath). The `issuer`, however, must be supplied: the resource client
		// defaults it to the bare `baseURL`, but Better Auth mints the token `iss`
		// as `baseURL + basePath` — so without this, a valid token fails on an
		// issuer mismatch (see `oauthIssuerForAuth`). We bind the audience to the
		// MCP endpoint (RFC 8707). Verification enforces signature + aud + iss +
		// exp and throws on any failure.
		const issuer = await oauthIssuerForAuth(app.auth);
		const jwksUrl = await oauthJwksUrlForAuth(app.auth);
		payload = (await resourceClient.getActions().verifyAccessToken(token, {
			...(jwksUrl ? { jwksUrl } : {}),
			verifyOptions: {
				audience,
				algorithms: EXPECTED_TOKEN_ALGORITHMS,
				...(issuer ? { issuer } : {}),
			},
		})) as Record<string, unknown>;
	} catch {
		// Not a valid OAuth token for this resource (bad signature, wrong
		// aud/iss, expired, unsigned, malformed, or JWKS unreachable). Fall
		// through to the session path — which yields `null` for a bad token, i.e.
		// unauthenticated, never elevated.
		return null;
	}

	const sub = typeof payload.sub === "string" ? payload.sub : undefined;
	if (!sub) return null;

	const user = await loadUserById(app, sub);
	if (!user) return null;

	const scopes = parseScopes(payload.scope);
	// `verifyAccessToken` copies `azp` → `client_id`; prefer the normalized field.
	const clientId =
		typeof payload.client_id === "string"
			? payload.client_id
			: typeof payload.azp === "string"
				? payload.azp
				: "";
	const tokenId = typeof payload.jti === "string" ? payload.jti : "";

	return {
		principal: { kind: "oauth", user, clientId, scopes, tokenId },
		// Mirror Better Auth's `{ user, session }` shape. There is no first-party
		// session row behind an access token, so we expose the verified token
		// claims as the `session` metadata (`ctx.session.user` is what RBAC reads).
		session: { user, session: payload },
	};
}

/**
 * Load the full user record for a token `sub` using Better Auth's internal
 * adapter — the same call the OAuth provider itself uses to resolve the user for
 * `/oauth2/userinfo`. Returns `null` if the user no longer exists.
 */
async function loadUserById(
	app: { auth: unknown },
	sub: string,
): Promise<User | null> {
	const auth = app.auth as {
		$context: Promise<{
			internalAdapter: { findUserById(userId: string): Promise<User | null> };
		}>;
	};
	const ctx = await auth.$context;
	return (await ctx.internalAdapter.findUserById(sub)) ?? null;
}
