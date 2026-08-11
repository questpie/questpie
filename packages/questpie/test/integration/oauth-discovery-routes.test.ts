/**
 * MO4 — root OAuth / MCP discovery endpoints.
 *
 * The OAuth provider + jwt plugins register discovery on `app.auth.handler`, but
 * that handler is mounted under the auth basePath (`/api/auth/*`). MCP clients
 * expect discovery at the server root. These tests assert the three thin
 * framework routes are dispatched at the ROOT (basePath `/`) — i.e. the codegen
 * key round-trip `.wellKnown/oauthAuthorizationServer` → `/.well-known/oauth-
 * authorization-server` holds — and that each proxies the real Better Auth
 * metadata surface to the expected shape.
 *
 * Only the Better Auth transport is stubbed (mirroring `makeMockAuth` in
 * oauth-principal.test.ts): `app.auth` is replaced with a fake exposing exactly
 * what the proxies read — `handler` (for `/jwks`), `api.getOAuthServerConfig`
 * (AS metadata), and `options` + `$context.getPlugin` (which the REAL
 * `oauthProviderResourceClient` reads to build protected-resource metadata). No
 * OAuth DB tables are required, so this is independent of MO3's migrations.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const BASE_URL = "http://localhost:3000";
const MCP_AUDIENCE = `${BASE_URL}/api/mcp`;

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

/** JWKS the stubbed auth handler serves at its basePath `/api/auth/jwks`. */
const STUB_JWKS = {
	keys: [
		{
			kty: "RSA",
			kid: "mo4-test",
			alg: "RS256",
			use: "sig",
			n: "x",
			e: "AQAB",
		},
	],
};

/** AS metadata `api.getOAuthServerConfig` returns (asResponse: false → data). */
const STUB_AS_METADATA = {
	issuer: `${BASE_URL}/api/auth`,
	authorization_endpoint: `${BASE_URL}/api/auth/oauth2/authorize`,
	token_endpoint: `${BASE_URL}/api/auth/oauth2/token`,
	jwks_uri: `${BASE_URL}/api/auth/jwks`,
	scopes_supported: ["openid", "profile", "email", "collections:read"],
};

/**
 * Fake Better Auth instance exposing exactly what the MO4 proxies touch. Shape
 * matches what the real `oauthProviderResourceClient` reads from `$context`.
 */
function makeStubAuth() {
	return {
		options: { baseURL: BASE_URL, basePath: "/api/auth" },
		// `/jwks` proxy forwards to auth.handler with the path rewritten to the
		// auth basePath's jwks path; assert it targets exactly that.
		handler: async (request: Request): Promise<Response> => {
			const url = new URL(request.url);
			if (url.pathname === "/api/auth/jwks") {
				return Response.json(STUB_JWKS);
			}
			return new Response("not found", { status: 404 });
		},
		api: {
			getOAuthServerConfig: async (_args: {
				request: Request;
				asResponse: false;
			}) => STUB_AS_METADATA,
		},
		$context: Promise.resolve({
			getPlugin: (name: string) => {
				if (name === "oauth-provider")
					return { options: { disableJwtPlugin: false } };
				if (name === "jwt")
					return {
						options: {
							jwt: { issuer: STUB_AS_METADATA.issuer },
							jwks: { jwksPath: "/jwks" },
						},
					};
				return undefined;
			},
		}),
	};
}

describe("root OAuth / MCP discovery routes", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup.cleanup();
	});

	async function handlerWithStubbedAuth() {
		setup = await buildMockApp({ collections: { posts } });
		(setup.app as { auth: unknown }).auth = makeStubAuth();
		return createFetchHandler(setup.app);
	}

	test("GET /.well-known/oauth-authorization-server returns AS metadata", async () => {
		const handler = await handlerWithStubbedAuth();
		const response = await handler(
			new Request(`${BASE_URL}/.well-known/oauth-authorization-server`),
		);
		// Dispatched (not 404) → the `.wellKnown/...` key → `/.well-known/...`
		// path round-trip works.
		expect(response!.status).toBe(200);
		const body = await response!.json();
		expect(body.issuer).toBe(STUB_AS_METADATA.issuer);
		expect(body.authorization_endpoint).toBe(
			STUB_AS_METADATA.authorization_endpoint,
		);
		expect(body.jwks_uri).toBe(STUB_AS_METADATA.jwks_uri);
	});

	test("GET /.well-known/oauth-protected-resource points at the AS with the MCP audience as resource", async () => {
		const handler = await handlerWithStubbedAuth();
		const response = await handler(
			new Request(`${BASE_URL}/.well-known/oauth-protected-resource`),
		);
		expect(response!.status).toBe(200);
		const body = await response!.json();
		// resource = the RFC 8707 aud MO2 binds tokens to / MO6 verifies.
		expect(body.resource).toBe(MCP_AUDIENCE);
		// The resource client loses mounted auth paths when it derives this value.
		// The proxy must publish the exact provider issuer instead.
		expect(body.authorization_servers).toEqual([STUB_AS_METADATA.issuer]);
	});

	test("GET /jwks returns the key set (proxied from the auth basePath)", async () => {
		const handler = await handlerWithStubbedAuth();
		const response = await handler(new Request(`${BASE_URL}/jwks`));
		expect(response!.status).toBe(200);
		const body = await response!.json();
		expect(Array.isArray(body.keys)).toBe(true);
		expect(body.keys[0].kid).toBe("mo4-test");
	});

	test("discovery endpoints report 501 (not 404) when auth is not configured", async () => {
		// Without stubbing app.auth (undefined), the routes must still be
		// DISPATCHED — a 404 would mean the root path round-trip broke. The
		// handlers return notImplemented (501) instead.
		setup = await buildMockApp({ collections: { posts } });
		(setup.app as { auth: unknown }).auth = undefined;
		const handler = createFetchHandler(setup.app);

		for (const path of [
			"/.well-known/oauth-authorization-server",
			"/.well-known/oauth-protected-resource",
			"/jwks",
		]) {
			const response = await handler(new Request(`${BASE_URL}${path}`));
			expect(response!.status).toBe(501);
		}
	});
});
