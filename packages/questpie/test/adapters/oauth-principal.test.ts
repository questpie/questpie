/**
 * MO6 — OAuth access token → `oauth` principal resolution (security-critical).
 *
 * These tests exercise the REAL verification path: an EdDSA (Ed25519) access
 * token — the algorithm Better Auth's `jwt()` plugin issues, and the one the
 * verifier pins (`EXPECTED_TOKEN_ALGORITHMS`) — is minted with `node:crypto` and
 * verified by `verifyAccessToken` (via `oauthProviderResourceClient`) against a
 * matching public JWKS. The ONLY thing stubbed is the JWKS HTTP transport
 * (`globalThis.fetch`) — the signature check, `aud`/`iss`/`exp` enforcement, and
 * claim parsing are all real. Ed25519 raw signatures are exactly the JWS
 * signature, with no DER→JOSE conversion.
 *
 * Covered:
 * - valid token → `principal.kind === "oauth"` with correct user, parsed scopes,
 *   clientId, tokenId; and through `createAdapterContext`, `accessMode === "user"`.
 * - opaque (non-JWT) session bearer → NOT treated as oauth (→ session path).
 * - negatives that must yield NO oauth principal: expired, wrong `aud`, wrong
 *   `iss`, tampered signature, malformed/garbage, `alg: none` (unsigned), a
 *   header `alg` outside the pinned set (RS256), unknown `sub`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import {
	createAdapterContext,
	createAdapterContextForOAuthAudience,
} from "../../src/server/adapters/utils/context.js";
import {
	questpieApiAudienceForApp,
	resolveOAuthPrincipal,
} from "../../src/server/adapters/utils/oauth-principal.js";
import { accessModeForPrincipal } from "../../src/server/config/context.js";

const BASE_URL = "https://app.example.test";
const AUDIENCE = `${BASE_URL}/api/mcp`;
const CRDT_AUDIENCE = BASE_URL;

function b64url(input: Buffer | string): string {
	return Buffer.from(input).toString("base64url");
}

// One Ed25519 keypair for the whole suite: private key mints tokens, public key
// is published as the JWKS the verifier fetches. EdDSA matches what Better Auth
// issues and what `EXPECTED_TOKEN_ALGORITHMS` pins.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KID = "mo6-test-key";
const publicJwk = publicKey.export({ format: "jwk" }) as Record<
	string,
	unknown
>;
publicJwk.kid = KID;
publicJwk.alg = "EdDSA";
publicJwk.use = "sig";
const JWKS = { keys: [publicJwk] };

// A SECOND (RSA / RS256) key published alongside the Ed25519 key — used ONLY to
// prove the algorithm pin. A token this RSA key VALIDLY signs is still rejected,
// because RS256 is not in the verifier's pinned `EXPECTED_TOKEN_ALGORITHMS`
// (["EdDSA"]); without the pin, this same token would verify and resolve.
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RSA_KID = "mo6-rsa-key";
const rsaJwk = rsa.publicKey.export({ format: "jwk" }) as Record<
	string,
	unknown
>;
rsaJwk.kid = RSA_KID;
rsaJwk.alg = "RS256";
rsaJwk.use = "sig";
JWKS.keys.push(rsaJwk);

/** Mint a real EdDSA-signed JWT with the given claims (defaults are valid). */
function mintToken(
	claims: Record<string, unknown> = {},
	opts: { alg?: string; exp?: number; sign?: boolean } = {},
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(
		JSON.stringify({ alg: opts.alg ?? "EdDSA", kid: KID, typ: "JWT" }),
	);
	const payload = b64url(
		JSON.stringify({
			iss: BASE_URL,
			aud: AUDIENCE,
			iat: now,
			exp: opts.exp ?? now + 3600,
			sub: "user-1",
			scope: "openid collections:posts:read collections:posts:write",
			jti: "tok-123",
			client_id: "client-abc",
			...claims,
		}),
	);
	const signingInput = `${header}.${payload}`;
	if (opts.sign === false) {
		// Unsigned / detached — used for the alg:none attack case.
		return `${signingInput}.`;
	}
	const signature = sign(null, Buffer.from(signingInput), privateKey);
	return `${signingInput}.${b64url(signature)}`;
}

/** Mint a genuinely-valid RS256 JWT signed by the published RSA key. */
function mintRs256Token(): string {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(
		JSON.stringify({ alg: "RS256", kid: RSA_KID, typ: "JWT" }),
	);
	const payload = b64url(
		JSON.stringify({
			iss: BASE_URL,
			aud: AUDIENCE,
			iat: now,
			exp: now + 3600,
			sub: "user-1",
			scope: "openid collections:posts:read",
			jti: "tok-rsa",
			client_id: "client-abc",
		}),
	);
	const signingInput = `${header}.${payload}`;
	const signature = sign("sha256", Buffer.from(signingInput), rsa.privateKey);
	return `${signingInput}.${b64url(signature)}`;
}

/**
 * A mock Better Auth instance exposing exactly what the resource client reads:
 * `options.baseURL`/`basePath`, and a `$context` with `getPlugin` (jwt +
 * oauth-provider options) and `internalAdapter.findUserById`. `issuer` and
 * `jwksUrl` are derived from these — matching how real tokens are issued.
 */
function makeMockAuth(
	users: Record<string, { id: string; email: string } | null> = {
		"user-1": { id: "user-1", email: "user-1@example.test" },
	},
) {
	return {
		options: { baseURL: BASE_URL, basePath: "/api/auth" },
		$context: Promise.resolve({
			getPlugin: (name: string) => {
				if (name === "oauth-provider")
					return { options: { disableJwtPlugin: false } };
				if (name === "jwt")
					return {
						options: {
							jwt: { issuer: BASE_URL },
							jwks: { jwksPath: "/jwks" },
						},
					};
				return undefined;
			},
			internalAdapter: {
				findUserById: async (id: string) => users[id] ?? null,
			},
		}),
	};
}

function makeApp(auth: unknown) {
	return {
		auth,
		db: {},
		config: { app: { url: BASE_URL } },
	} as any;
}

function bearerRequest(token: string): Request {
	return new Request(`${BASE_URL}/api/mcp`, {
		headers: { authorization: `Bearer ${token}` },
	});
}

// Real JWKS transport is the only thing stubbed. Restore after each test.
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
function stubJwks(): void {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(JWKS), {
			status: 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

describe("resolveOAuthPrincipal — valid token", () => {
	test("resolves an oauth principal with user, scopes, clientId, tokenId", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken()),
			{},
		);

		expect(resolved).not.toBeNull();
		expect(resolved!.principal.kind).toBe("oauth");
		expect(resolved!.principal.user.id).toBe("user-1");
		expect(resolved!.principal.scopes).toEqual([
			"openid",
			"collections:posts:read",
			"collections:posts:write",
		]);
		expect(resolved!.principal.clientId).toBe("client-abc");
		expect(resolved!.principal.tokenId).toBe("tok-123");
		// Session mirrors { user, session } so ctx.session.user drives RBAC.
		expect(resolved!.session.user.id).toBe("user-1");
	});

	test("derives accessMode 'user' (never 'system') for the oauth principal", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken()),
			{},
		);
		expect(accessModeForPrincipal(resolved!.principal)).toBe("user");
	});

	test("uses azp as clientId fallback and tolerates absent jti", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const token = mintToken({
			client_id: undefined,
			azp: "client-from-azp",
			jti: undefined,
		});
		const resolved = await resolveOAuthPrincipal(app, bearerRequest(token), {});
		expect(resolved!.principal.clientId).toBe("client-from-azp");
		expect(resolved!.principal.tokenId).toBe("");
	});
});

describe("createAdapterContext — oauth principal threads through", () => {
	test("populates ctx.principal (oauth) + ctx.session.user and accessMode 'user'", async () => {
		stubJwks();
		// Real createContext behavior for the principal branch: accessMode is
		// derived from the supplied principal via the real accessModeForPrincipal.
		const app = {
			...makeApp(makeMockAuth()),
			createContext: async (ctx: any) => ({
				...ctx,
				accessMode: ctx.principal
					? accessModeForPrincipal(ctx.principal)
					: (ctx.accessMode ?? "user"),
			}),
		};

		const context = await createAdapterContext(
			app,
			bearerRequest(mintToken()),
			{},
		);

		expect(context.appContext.accessMode).toBe("user");
		expect((context.appContext.principal as any)?.kind).toBe("oauth");
		expect((context.appContext.principal as any)?.scopes).toContain(
			"collections:posts:read",
		);
		expect(context.session?.user.id).toBe("user-1");
		expect(context.appContext.session?.user.id).toBe("user-1");
	});

	test("binds a CRDT bearer to the CRDT resource audience, never the MCP audience", async () => {
		stubJwks();
		const app = {
			...makeApp(makeMockAuth()),
			createContext: async (ctx: any) => ({
				...ctx,
				accessMode: ctx.principal
					? accessModeForPrincipal(ctx.principal)
					: (ctx.accessMode ?? "user"),
			}),
		};
		const request = bearerRequest(mintToken({ aud: CRDT_AUDIENCE }));

		const mcpContext = await createAdapterContext(app, request, {});
		expect(mcpContext.appContext.principal).toBeUndefined();

		const crdtContext = await createAdapterContextForOAuthAudience(
			app,
			request,
			{},
			questpieApiAudienceForApp(app),
		);
		expect((crdtContext.appContext.principal as any)?.kind).toBe("oauth");
		expect(crdtContext.appContext.accessMode).toBe("user");
	});
});

describe("resolveOAuthPrincipal — opaque session bearer is not oauth", () => {
	test("an opaque (non-JWT) bearer returns null (falls through to session path)", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		// Better Auth session tokens look like "<id>.<hmac>" — not a 3-part JWS.
		const opaque = "9f8a7b6c5d4e3f21.aGVsbG8td29ybGQtc2lnbmF0dXJl";
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(opaque),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("no Authorization header returns null", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			new Request(`${BASE_URL}/api/mcp`),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("a custom getSession resolver opts out of oauth resolution", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken()),
			{
				getSession: async () => null,
			},
		);
		expect(resolved).toBeNull();
	});
});

describe("resolveOAuthPrincipal — invalid tokens yield NO principal", () => {
	test("expired token → null", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const now = Math.floor(Date.now() / 1000);
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken({}, { exp: now - 60 })),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("wrong audience → null (RFC 8707 binding)", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken({ aud: "https://evil.test/api/mcp" })),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("wrong issuer → null", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken({ iss: "https://evil.test" })),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("tampered signature → null", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const valid = mintToken();
		// Corrupt a character early in the signature segment so the decoded
		// signature bytes definitely differ (a trailing base64url char can decode
		// to the same value, so flip near the start).
		const parts = valid.split(".");
		const sig = parts[2]!;
		const first = sig[0];
		const replacement = first === "A" ? "B" : "A";
		const flipped = replacement + sig.slice(1);
		const tampered = `${parts[0]}.${parts[1]}.${flipped}`;
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(tampered),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("alg:none unsigned token → null (unsigned-JWT attack blocked)", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		const unsigned = mintToken({}, { alg: "none", sign: false });
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(unsigned),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("valid RS256 token whose key is in the JWKS → null (alg outside the pinned set)", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		// The RSA key IS published in the JWKS and the signature IS valid, so this
		// only fails because RS256 is not in EXPECTED_TOKEN_ALGORITHMS — proving the
		// algorithm pin rejects a substituted (non-EdDSA) alg on its own.
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintRs256Token()),
			{},
		);
		expect(resolved).toBeNull();
	});

	test("garbage / malformed bearer → null", async () => {
		stubJwks();
		const app = makeApp(makeMockAuth());
		for (const junk of ["not-a-token", "a.b.c", "...", "eyJ.eyJ"]) {
			const resolved = await resolveOAuthPrincipal(
				app,
				bearerRequest(junk),
				{},
			);
			expect(resolved).toBeNull();
		}
	});

	test("valid signature but unknown sub (user deleted) → null", async () => {
		stubJwks();
		// findUserById returns null for every id.
		const app = makeApp(makeMockAuth({}));
		const resolved = await resolveOAuthPrincipal(
			app,
			bearerRequest(mintToken({ sub: "ghost" })),
			{},
		);
		expect(resolved).toBeNull();
	});
});
