/**
 * MO13 — end-to-end verification of the whole MCP-over-OAuth feature (spec §3.1).
 *
 * This is the release capstone. Unlike the earlier MO tests (which either
 * fabricate the `oauth` principal — `scope-gate.test.ts` — or mint a self-signed
 * token against a stubbed JWKS — `oauth-principal.test.ts`), this test drives the
 * *real* `@better-auth/oauth-provider` flow against a live HTTP server and a real
 * database, obtaining a genuine app-issued JWT access token, then exercises the
 * production `POST /mcp` route with it:
 *
 *   sign up → DCR client registration (RFC 7591) → /oauth2/authorize (+ PKCE)
 *   → /oauth2/consent → /oauth2/token → real JWT → POST /mcp (Bearer).
 *
 * It proves the three spec §3.1 use-cases:
 *  (a) External MCP client bounded by `scopes ∩ RBAC` — BOTH narrowing
 *      directions (scope-narrowed AND RBAC-narrowed) plus out-of-scope denied at
 *      call time.
 *  (b) explicitly trusted stdio maintenance — full access, no OAuth.
 *
 * ── Real generated catalog (MO11) ──
 * The provider's *granular* per-resource scope catalog
 * (`collections:<name>:read|write|delete`) is NO LONGER supplied by this test:
 * MO11's `applyOAuthScopeCatalog` derives it from the registered collections
 * (`posts`, `lockedNotes`) and merges it into the `oauthProvider()` at
 * auth-instance build time — the same declarative source the MCP scope gate
 * derives from. Because the DCR endpoint and `/oauth2/authorize` validate
 * requested scopes against that catalog, a real DCR client on the *shipped*
 * starter can now obtain the granular scopes it needs. The `oauthProvider`
 * override below sets ONLY `validAudiences` (bound to this run's ephemeral port —
 * an audience concern, orthogonal to scopes); the scope catalog comes from the
 * framework.
 *
 * The oauth table schema fixes (jsonb array/json columns, unbounded
 * `verification.value`) and the token-issuer verification fix live in the source
 * (`modules/starter/collections/oauth-*.ts`, `adapters/utils/oauth-principal.ts`)
 * — this test runs against the shipped starter collections, no overrides.
 */

import { describe, expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

import { oauthProvider } from "@better-auth/oauth-provider";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { admin, bearer, jwt } from "better-auth/plugins";
import { collection, starterModule } from "questpie";

import { createFetchHandler } from "../../questpie/src/server/adapters/http.js";
import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import { createTestContext } from "../../questpie/test/utils/test-context.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createMcpServer, mcpModule } from "../src/exports/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// `posts` — RBAC allows everything for an authenticated session. Isolates the
// SCOPE gate: what the oauth caller reaches here is decided purely by scopes.
const posts = collection("posts")
	.fields(({ f }) => ({ title: f.text(255).required() }))
	.access({
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	});

// `lockedNotes` — RBAC allows read but DENIES write/delete unconditionally.
// Isolates the RBAC gate: even a token holding write/delete scopes cannot reach
// those tools, proving `scopes ∩ RBAC` never GRANTS beyond RBAC.
const lockedNotes = collection("lockedNotes")
	.fields(({ f }) => ({ title: f.text(255).required() }))
	.access({
		read: ({ session }) => !!session,
		create: false,
		update: false,
		delete: false,
	});

// A fixed high port so the auth instance's `baseURL` (captured at build time)
// matches where the JWKS is actually served (the token verifier fetches
// `${baseURL}/jwks`). Ephemeral (`port: 0`) would break that match.
const PORT = 34519;
const ORIGIN = `http://localhost:${PORT}`;
const MCP_AUD = `${ORIGIN}/api/mcp`;
const AUTH_BASE = `${ORIGIN}/api/auth`;
const REDIRECT_URI = "http://localhost:9999/callback";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64url(buf: Buffer): string {
	return buf.toString("base64url");
}
function pkce() {
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}
function decodeJwtHeader(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
}
function decodeJwtPayload(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

/** JSON-RPC over Streamable HTTP against the live `/mcp` route. */
async function mcpRpc(
	method: string,
	params: unknown,
	token: string,
): Promise<{ status: number; body: any }> {
	const res = await fetch(`${ORIGIN}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	const text = await res.text();
	let body: any;
	try {
		body = JSON.parse(text);
	} catch {
		const line = text.split("\n").find((l) => l.startsWith("data:"));
		body = line ? JSON.parse(line.slice("data:".length).trim()) : { raw: text };
	}
	return { status: res.status, body };
}

/**
 * Run the entire OAuth 2.1 authorization-code + PKCE flow through the *real*
 * provider and return a genuine app-issued access token.
 *
 * - `clientScopes` — the scopes the DCR client is registered to allow.
 * - `requestScopes` — the scopes actually requested at authorize/consent (⊆
 *   clientScopes), i.e. what the issued token carries.
 *
 * DCR + authorize + consent + token are driven through `auth.handler(Request)`
 * (a real Request so the provider's `ctx.request` exists). `resource` is bound
 * at authorize + token to the MCP endpoint (RFC 8707) so the token is a JWT with
 * `aud` = the MCP resource.
 */
async function obtainAccessToken(
	auth: any,
	cookie: string,
	clientScopes: string[],
	requestScopes: string[],
): Promise<string> {
	// 1. DCR register a public (PKCE) client.
	const regRes = await auth.handler(
		new Request(`${AUTH_BASE}/oauth2/register`, {
			method: "POST",
			// DCR precedes user authorization, so a new external client has no
			// QUESTPIE session cookie yet.
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				redirect_uris: [REDIRECT_URI],
				client_name: "MO13 MCP Client",
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code"],
				response_types: ["code"],
				scope: clientScopes.join(" "),
			}),
		}),
	);
	if (regRes.status !== 200) {
		throw new Error(`DCR failed: ${regRes.status} ${await regRes.text()}`);
	}
	const clientId = (await regRes.json()).client_id as string;

	const { verifier, challenge } = pkce();

	// 2. authorize (GET) with the user's cookie session.
	const authUrl = new URL(`${AUTH_BASE}/oauth2/authorize`);
	authUrl.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: requestScopes.join(" "),
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: MCP_AUD,
		state: "mo13",
	}).toString();
	const authResp = await auth.handler(
		new Request(authUrl, { headers: { cookie } }),
	);
	const loc = authResp.headers.get("location");
	if (!loc) throw new Error(`authorize did not redirect: ${authResp.status}`);

	let code = loc.includes("/callback")
		? new URL(loc).searchParams.get("code")
		: null;

	// 3. If redirected to the consent page, approve consent explicitly. The
	// redirect carries the signed `oauth_query` the consent endpoint requires.
	if (!code) {
		const oauthQuery = new URL(loc, ORIGIN).search.replace(/^\?/, "");
		const consentResp = await auth.handler(
			new Request(`${AUTH_BASE}/oauth2/consent`, {
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
			}),
		);
		const cBody = await consentResp.json();
		const redirectUri = cBody?.url ?? cBody?.redirect_uri;
		if (redirectUri)
			code = new URL(redirectUri, ORIGIN).searchParams.get("code");
	}
	if (!code) throw new Error("no authorization code issued");

	// 4. token exchange (PKCE verifier + resource binding).
	const tokenResp = await auth.handler(
		new Request(`${AUTH_BASE}/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: clientId,
				code,
				code_verifier: verifier,
				redirect_uri: REDIRECT_URI,
				resource: MCP_AUD,
			}).toString(),
		}),
	);
	const token = await tokenResp.json();
	if (!token.access_token) {
		throw new Error(`token exchange failed: ${JSON.stringify(token)}`);
	}
	return token.access_token as string;
}

async function connectStdio(server: McpServer) {
	const [ct, st] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "mo13-stdio", version: "1.0.0" });
	await server.connect(st);
	await client.connect(ct);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MO13 end-to-end OAuth MCP flow + system mode", () => {
	it("lets a public MCP client register before the user signs in", async () => {
		const setup = await buildMockApp(
			{ modules: [starterModule] },
			{
				app: { url: ORIGIN },
				secret: "test-auth-secret-with-more-than-32-chars",
			},
		);

		try {
			await runTestDbMigrations(setup.app);
			const response = await setup.app.auth.handler(
				new Request(`${AUTH_BASE}/oauth2/register`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						redirect_uris: [REDIRECT_URI],
						client_name: "Unauthenticated MCP Client",
						token_endpoint_auth_method: "none",
						grant_types: ["authorization_code"],
						response_types: ["code"],
						scope: "openid",
					}),
				}),
			);

			expect(response.status).toBe(200);
			expect((await response.json()).client_id).toBeString();
		} finally {
			await setup.cleanup();
		}
	});

	async function setupApp() {
		const setup = await buildMockApp(
			{
				modules: [starterModule, mcpModule],
				collections: { posts, lockedNotes },
				auth: {
					emailAndPassword: {
						enabled: true,
						requireEmailVerification: false,
					},
					// Override the starter's oauthProvider (deduped by id "oauth-provider",
					// override wins) ONLY to bind `validAudiences` to this run's ephemeral
					// port — the starter derives the audience from env at module load, which
					// won't match. No `scopes` here: MO11's `applyOAuthScopeCatalog` derives
					// the granular catalog from the registered collections at auth build.
					plugins: [
						admin(),
						bearer(),
						jwt(),
						oauthProvider({
							loginPage: "/admin/login",
							consentPage: "/admin/oauth/consent",
							allowDynamicClientRegistration: true,
							allowUnauthenticatedClientRegistration: true,
							validAudiences: [MCP_AUD],
							accessTokenExpiresIn: 3600,
						}),
					],
				},
				// The HTTP transport is read-only by default; enable write/delete at the
				// MCP-policy layer so the scope/RBAC gates (not the coarse transport
				// policy) decide visibility. Mirrors scope-gate.test.ts.
				config: {
					mcp: {
						crud: {
							collections: {
								posts: { read: true, write: true, delete: true },
								lockedNotes: { read: true, write: true, delete: true },
							},
						},
					},
				},
			},
			{
				app: { url: ORIGIN },
				secret: "test-auth-secret-with-more-than-32-chars",
			},
		);

		const handler = createFetchHandler(setup.app);
		const server = Bun.serve({
			port: PORT,
			fetch: (req) =>
				handler(req).then(
					(r) => r ?? new Response("not found", { status: 404 }),
				),
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.posts.create(
			{ title: "Seeded post" },
			createTestContext({ accessMode: "system" }),
		);
		await setup.app.collections.lockedNotes.create(
			{ title: "Secret note" },
			createTestContext({ accessMode: "system" }),
		);

		const signUp = await setup.app.auth.api.signUpEmail({
			body: {
				email: "mo13@example.test",
				password: "password123",
				name: "MO13",
			},
			asResponse: true,
		});
		const cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";

		return {
			app: setup.app,
			auth: setup.app.auth as any,
			cookie,
			cleanup: async () => {
				server.stop(true);
				await setup.cleanup();
			},
		};
	}

	// ── (a) external client: a REAL token is issued and threads through /mcp ──

	it("issues a real app-issued JWT via DCR + authorize + consent + token and resolves it to an oauth principal on POST /mcp", async () => {
		const { auth, cookie, cleanup } = await setupApp();
		try {
			// Token scoped to posts read-only (broad RBAC on posts, narrow scope).
			const token = await obtainAccessToken(
				auth,
				cookie,
				[
					"openid",
					"collections:posts:read",
					"collections:posts:write",
					"collections:posts:delete",
				],
				["openid", "collections:posts:read"],
			);

			// It is a signed JWT bound to the MCP audience.
			const header = decodeJwtHeader(token);
			const payload = decodeJwtPayload(token);
			expect(typeof header.alg).toBe("string");
			const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
			expect(aud).toContain(MCP_AUD);
			expect(payload.iss).toBe(`${ORIGIN}/api/auth`);
			expect(String(payload.scope)).toContain("collections:posts:read");

			// The live /mcp route resolves it to an `oauth` principal and dispatches:
			// a custom tool that echoes the principal proves kind + user identity.
			const list = await mcpRpc("tools/list", {}, token);
			expect(list.status).toBe(200);
			const names: string[] = (list.body?.result?.tools ?? [])
				.map((t: any) => t.name)
				.sort();
			// scope-narrowed: read tools present, write/delete absent.
			expect(names).toContain("collections.posts.list");
			expect(names).toContain("collections.posts.get");
			expect(names).toContain("collections.posts.count");
			expect(names).not.toContain("collections.posts.create");
			expect(names).not.toContain("collections.posts.update");
			expect(names).not.toContain("collections.posts.delete");
		} finally {
			await cleanup();
		}
	});

	it("bounds the external client by scopes ∩ RBAC — direction 1: scopes narrow a broad-RBAC resource", async () => {
		const { auth, cookie, cleanup } = await setupApp();
		try {
			// Broad RBAC on posts, but the token holds ONLY the read scope.
			const token = await obtainAccessToken(
				auth,
				cookie,
				[
					"openid",
					"collections:posts:read",
					"collections:posts:write",
					"collections:posts:delete",
				],
				["openid", "collections:posts:read"],
			);

			const list = await mcpRpc("tools/list", {}, token);
			const names: string[] = (list.body?.result?.tools ?? []).map(
				(t: any) => t.name,
			);
			expect(names).toContain("collections.posts.list");
			expect(names).not.toContain("collections.posts.create");
			expect(names).not.toContain("collections.posts.delete");

			// In-scope call SUCCEEDS.
			const okCall = await mcpRpc(
				"tools/call",
				{ name: "collections.posts.list", arguments: { limit: 5 } },
				token,
			);
			expect(okCall.status).toBe(200);
			expect(okCall.body?.result?.isError).toBeUndefined();
			expect(
				(okCall.body?.result?.structuredContent as any)?.docs?.length,
			).toBeGreaterThanOrEqual(1);

			// Out-of-scope tool is ABSENT from the list AND denied on a direct call.
			const deniedCall = await mcpRpc(
				"tools/call",
				{ name: "collections.posts.delete", arguments: { id: "anything" } },
				token,
			);
			expect(deniedCall.status).toBe(200); // JSON-RPC envelope OK…
			// …but the call itself is an error (tool unavailable for this token).
			const errText = JSON.stringify(
				deniedCall.body?.result ?? deniedCall.body?.error,
			);
			expect(errText).toMatch(/not found|access denied/i);
			expect(deniedCall.body?.result?.isError ?? true).toBeTruthy();

			// And no row was deleted — the denial stopped the mutation.
			const stillThere = await mcpRpc(
				"tools/call",
				{ name: "collections.posts.count", arguments: {} },
				token,
			);
			expect(
				(stillThere.body?.result?.structuredContent as any)?.value,
			).toBeGreaterThanOrEqual(1);
		} finally {
			await cleanup();
		}
	});

	it("bounds the external client by scopes ∩ RBAC — direction 2: RBAC narrows a broadly-scoped resource (scopes cannot grant)", async () => {
		const { auth, cookie, cleanup } = await setupApp();
		try {
			// The token holds the FULL lockedNotes scope set (read+write+delete) — but
			// lockedNotes RBAC denies write/delete unconditionally. The gate can only
			// remove, never grant: write/delete tools must stay hidden.
			const token = await obtainAccessToken(
				auth,
				cookie,
				[
					"openid",
					"collections:lockedNotes:read",
					"collections:lockedNotes:write",
					"collections:lockedNotes:delete",
				],
				[
					"openid",
					"collections:lockedNotes:read",
					"collections:lockedNotes:write",
					"collections:lockedNotes:delete",
				],
			);

			const list = await mcpRpc("tools/list", {}, token);
			const names: string[] = (list.body?.result?.tools ?? []).map(
				(t: any) => t.name,
			);
			// RBAC allows read → read tools present.
			expect(names).toContain("collections.lockedNotes.list");
			expect(names).toContain("collections.lockedNotes.get");
			// RBAC denies write/delete → NOT present despite the held scopes.
			expect(names).not.toContain("collections.lockedNotes.create");
			expect(names).not.toContain("collections.lockedNotes.update");
			expect(names).not.toContain("collections.lockedNotes.delete");

			// A direct call to the RBAC-denied delete is denied at call time too.
			const deniedCall = await mcpRpc(
				"tools/call",
				{ name: "collections.lockedNotes.delete", arguments: { id: "x" } },
				token,
			);
			expect(deniedCall.body?.result?.isError ?? true).toBeTruthy();
		} finally {
			await cleanup();
		}
	});

	// ── (b) explicitly trusted stdio maintenance: full access, no OAuth ──

	it("stdio trusted maintenance retains full access with NO OAuth", async () => {
		const { app, cleanup } = await setupApp();
		try {
			const server = await createMcpServer(app, {
				transport: "stdio",
				config: { stdio: { trustedMaintenance: true } },
			});
			const { client, close } = await connectStdio(server);
			try {
				const names = (await client.listTools()).tools
					.map((t) => t.name)
					.sort();

				// Full access to tools a bounded oauth caller could NOT reach:
				// posts delete (write/delete not granted to the read-only token above)…
				expect(names).toContain("collections.posts.delete");
				expect(names).toContain("collections.posts.create");
				// …and lockedNotes delete, which RBAC denies for any `user`/`oauth`
				// principal but `system` bypasses.
				expect(names).toContain("collections.lockedNotes.delete");
				expect(names).toContain("collections.lockedNotes.list");

				// And it actually executes an RBAC-denied delete-class tool: create a
				// lockedNotes row (RBAC `create: false`) — allowed only under system.
				const created = await client.callTool({
					name: "collections.lockedNotes.create",
					arguments: { data: { title: "created-by-system" } },
				});
				expect(created.isError).toBeUndefined();
			} finally {
				await close();
			}
		} finally {
			await cleanup();
		}
	});
});
