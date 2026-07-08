/**
 * OAuth / MCP discovery metadata proxies (MO4).
 *
 * The `@better-auth/oauth-provider` + `jwt()` plugins register OAuth 2.1
 * discovery on `app.auth.handler`, but that handler is mounted under the auth
 * basePath (`/api/auth/*`). MCP clients (RFC 8414 / RFC 9728) expect discovery
 * at the server root — `/.well-known/oauth-authorization-server`,
 * `/.well-known/oauth-protected-resource`, and `/jwks` — independent of the auth
 * basePath. These thin proxies re-expose that metadata as ordinary framework
 * `route()` definitions so the endpoints land at the root (basePath `/`) rather
 * than buried under `/api/auth`.
 *
 * All three delegate to the provider's own helpers — nothing is hand-derived —
 * so the advertised issuer/JWKS/audience stay consistent with how tokens are
 * actually issued and verified (MO2 wiring + MO6 verification).
 *
 * @internal — imported by the sibling route files; the `_` prefix keeps codegen
 * from treating this as a route entity.
 */

import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

import { mcpAudienceForApp } from "#questpie/server/adapters/utils/oauth-principal.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import { ApiError } from "#questpie/server/errors/index.js";

import { handleError } from "../../../../adapters/utils/response.js";

/** Minimal shape of the Better Auth instance these proxies read. */
type AuthInstance = {
	handler: (request: Request) => Promise<Response>;
	api: {
		getOAuthServerConfig: (args: {
			request: Request;
			asResponse: false;
		}) => Promise<unknown>;
	};
	options: { basePath?: string };
};

function requireAuth(
	app: Questpie<QuestpieConfig>,
	request: Request,
): AuthInstance | Response {
	const auth = app.auth as unknown as AuthInstance | undefined;
	if (!auth) {
		return handleError(ApiError.notImplemented("Authentication"), {
			request,
			app,
		});
	}
	return auth;
}

/**
 * `GET /.well-known/oauth-authorization-server` — OAuth 2.1 Authorization Server
 * metadata (RFC 8414). Proxies the provider's `getOAuthServerConfig` endpoint,
 * mirroring the library's `oauthProviderAuthServerMetadata` helper (which exists
 * precisely "when basePath prevents the endpoint from being located at the
 * root"). The JSON body is identical to what better-auth serves at
 * `/api/auth/.well-known/oauth-authorization-server`.
 */
export async function oauthAuthorizationServerMetadata(
	app: Questpie<QuestpieConfig>,
	request: Request,
): Promise<Response> {
	const auth = requireAuth(app, request);
	if (auth instanceof Response) return auth;
	const body = await auth.api.getOAuthServerConfig({
		request,
		asResponse: false,
	});
	return Response.json(body);
}

/**
 * `GET /.well-known/oauth-protected-resource` — Protected Resource metadata
 * (RFC 9728). The authorization server does not publish this itself, so we build
 * it via the resource client. `resource` is the MCP endpoint URL (the RFC 8707
 * `aud` MO2 binds tokens to and MO6 verifies against), and `authorization_servers`
 * is auto-derived by the provider to point at this app's AS metadata document —
 * so a client that hits this endpoint discovers where to run the OAuth flow.
 */
export async function oauthProtectedResourceMetadata(
	app: Questpie<QuestpieConfig>,
	request: Request,
): Promise<Response> {
	const auth = requireAuth(app, request);
	if (auth instanceof Response) return auth;
	const resourceClient = oauthProviderResourceClient(
		app.auth as unknown as Parameters<typeof oauthProviderResourceClient>[0],
	);
	const metadata = await resourceClient
		.getActions()
		.getProtectedResourceMetadata({ resource: mcpAudienceForApp(app) });
	return Response.json(metadata);
}

/**
 * `GET /jwks` — the JSON Web Key Set the `jwt()` plugin publishes for stateless
 * access-token verification. Better Auth serves it under the auth basePath
 * (default `<basePath>/jwks`); this re-exposes it at the root by forwarding the
 * request through `app.auth.handler` with the pathname rewritten to that path —
 * the same code path, so the key set is byte-for-byte what verifiers fetch.
 */
export async function jwks(
	app: Questpie<QuestpieConfig>,
	request: Request,
): Promise<Response> {
	const auth = requireAuth(app, request);
	if (auth instanceof Response) return auth;
	const authBasePath = auth.options.basePath ?? "/api/auth";
	const url = new URL(request.url);
	url.pathname = `${authBasePath.replace(/\/$/, "")}/jwks`;
	return auth.handler(new Request(url, request));
}
