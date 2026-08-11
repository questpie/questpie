import { describe, expect, it } from "bun:test";

import { oauthProvider } from "@better-auth/oauth-provider";
import { APIError, betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";

import {
	configureAuthEntryMethods,
	type AuthEntryMethodsInput,
} from "../../src/exports/auth.js";

const emptyDatabase = (): MemoryDB => ({
	user: [],
	account: [],
	session: [],
	verification: [],
});

const createTestAuth = (
	configured: ReturnType<typeof configureAuthEntryMethods>,
	database: MemoryDB = emptyDatabase(),
) =>
	betterAuth({
		baseURL: "https://auth.example.test",
		secret: "a-test-secret-long-enough-for-better-auth",
		database: memoryAdapter(database),
		trustedOrigins: ["https://auth.example.test"],
		rateLimit: { enabled: false },
		...configured.authOptions,
	});

const jsonHeaders = {
	"content-type": "application/json",
	origin: "https://auth.example.test",
};

type TestProviderUser = {
	id: string | number;
	name: string;
	email?: string | null;
	emailVerified: boolean;
};

let activeGoogleFixture: TestProviderUser | undefined;

const socialInput = (user: TestProviderUser): AuthEntryMethodsInput => {
	activeGoogleFixture = user;
	return {
		credentials: { enabled: false },
		socialProviders: {
			google: {
				clientId: "google-client",
				clientSecret: "google-secret",
			},
		},
		requireVerifiedProviderEmail: true,
	};
};

async function beginSocialCallback(
	auth: ReturnType<typeof betterAuth>,
	provider: "google" | "github",
	callbackURL = "https://auth.example.test/complete",
) {
	const response = await auth.handler(
		new Request("https://auth.example.test/api/auth/sign-in/social", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				provider,
				callbackURL,
				errorCallbackURL: "https://auth.example.test/error",
				disableRedirect: true,
			}),
		}),
	);
	const body = (await response.json()) as { url: string };
	return {
		state: new URL(body.url).searchParams.get("state") ?? "",
		cookie: response.headers
			.getSetCookie()
			.map((value) => value.split(";", 1)[0])
			.join("; "),
	};
}

async function beginLinkCallback(
	auth: ReturnType<typeof betterAuth>,
	sessionCookie: string,
	callbackURL: string,
) {
	const response = await auth.handler(
		new Request("https://auth.example.test/api/auth/link-social", {
			method: "POST",
			headers: { ...jsonHeaders, cookie: sessionCookie },
			body: JSON.stringify({
				provider: "google",
				callbackURL,
				errorCallbackURL: "https://auth.example.test/link-error",
				disableRedirect: true,
			}),
		}),
	);
	const body = (await response.json()) as { url: string };
	return {
		state: new URL(body.url).searchParams.get("state") ?? "",
		cookie: [
			sessionCookie,
			...response.headers.getSetCookie().map((value) => value.split(";", 1)[0]),
		].join("; "),
	};
}

function fakeGoogleIdToken(user: TestProviderUser): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode({
		sub: user.id,
		name: user.name,
		email: user.email,
		email_verified: user.emailVerified,
		picture: "https://example.test/avatar.png",
	})}.signature`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

async function createSignedGoogleIdToken(user: TestProviderUser) {
	const keys = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const now = Math.floor(Date.now() / 1000);
	const header = bytesToBase64Url(
		new TextEncoder().encode(
			JSON.stringify({ alg: "RS256", kid: "questpie-test-key", typ: "JWT" }),
		),
	);
	const payload = bytesToBase64Url(
		new TextEncoder().encode(
			JSON.stringify({
				sub: String(user.id),
				name: user.name,
				email: user.email,
				email_verified: user.emailVerified,
				picture: "https://example.test/avatar.png",
				iss: "https://accounts.google.com",
				aud: "google-client",
				iat: now,
				exp: now + 300,
			}),
		),
	);
	const signingInput = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		keys.privateKey,
		new TextEncoder().encode(signingInput),
	);
	const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
	return {
		token: `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`,
		publicJwk: {
			...publicJwk,
			alg: "RS256",
			kid: "questpie-test-key",
			use: "sig",
		},
	};
}

async function signInWithSignedGoogleIdToken(
	auth: ReturnType<typeof betterAuth>,
	user: TestProviderUser,
) {
	const { token, publicJwk } = await createSignedGoogleIdToken(user);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url === "https://www.googleapis.com/oauth2/v3/certs") {
			return Response.json({ keys: [publicJwk] });
		}
		throw new Error(`Unexpected Google verification request: ${url}`);
	};
	try {
		return await auth.handler(
			new Request("https://auth.example.test/api/auth/sign-in/social", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					provider: "google",
					idToken: {
						token,
						accessToken: "provider-access-token",
					},
				}),
			}),
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

async function withFakeProviderNetwork<T>(
	provider: "google" | "github",
	user: TestProviderUser,
	run: () => Promise<T>,
): Promise<T> {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("access_token") || url.includes("/token")) {
			return Response.json({
				access_token: "provider-access-token",
				expires_in: 3600,
				id_token: fakeGoogleIdToken(user),
				token_type: "Bearer",
			});
		}
		if (provider === "github" && url.endsWith("/user/emails")) {
			return Response.json(
				user.email
					? [
							{
								email: user.email,
								primary: true,
								verified: user.emailVerified,
								visibility: "private",
							},
						]
					: [],
			);
		}
		if (provider === "github" && url.endsWith("/user")) {
			return Response.json({
				id: user.id,
				login: "github-user",
				name: user.name,
				email: user.email,
				avatar_url: "https://example.test/avatar.png",
			});
		}
		throw new Error(`Unexpected provider request: ${url}`);
	};
	try {
		return await run();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

async function withFakeTokenExchange<T>(run: () => Promise<T>): Promise<T> {
	if (!activeGoogleFixture) throw new Error("missing Google fixture");
	return withFakeProviderNetwork("google", activeGoogleFixture, run);
}

async function signInWithGoogleCallback(auth: ReturnType<typeof betterAuth>) {
	if (!activeGoogleFixture) throw new Error("missing Google fixture");
	const { state, cookie } = await beginSocialCallback(auth, "google");
	return withFakeProviderNetwork("google", activeGoogleFixture, () =>
		auth.handler(
			new Request(
				`https://auth.example.test/api/auth/callback/google?code=provider-code&state=${state}`,
				{ headers: { cookie } },
			),
		),
	);
}

describe("configureAuthEntryMethods", () => {
	it("rejects incomplete provider credential pairs without disclosing a secret", () => {
		for (const provider of ["google", "github"] as const) {
			for (const partial of [
				{ clientId: "client", clientSecret: "" },
				{ clientId: "", clientSecret: "must-not-appear" },
				{ clientId: "client" },
				{ clientSecret: "must-not-appear" },
			]) {
				expect(() =>
					configureAuthEntryMethods({
						credentials: { enabled: true },
						socialProviders: { [provider]: partial },
						requireVerifiedProviderEmail: true,
					} as AuthEntryMethodsInput),
				).toThrow(`Auth entry provider "${provider}"`);
			}
		}
	});

	it("rejects provider identity and token verification overrides", () => {
		for (const socialProviders of [
			{
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
					getUserInfo: async () => null,
				},
			},
			{
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
					verifyIdToken: async () => true,
				},
			},
			{
				github: {
					clientId: "github-client",
					clientSecret: "github-secret",
					getUserInfo: async () => null,
				},
			},
		]) {
			expect(() =>
				configureAuthEntryMethods({
					credentials: { enabled: false },
					socialProviders,
					requireVerifiedProviderEmail: true,
				} as AuthEntryMethodsInput),
			).toThrow("does not allow");
		}
	});

	it("rejects plugins outside the reviewed non-entry allowlist", () => {
		for (const id of ["anonymous", "magic-link", "username", "custom-entry"]) {
			expect(() =>
				configureAuthEntryMethods({
					authOptions: { plugins: [{ id }] },
					credentials: { enabled: true },
					requireVerifiedProviderEmail: true,
				} as AuthEntryMethodsInput),
			).toThrow(`plugin "${id}"`);
		}
	});

	it("composes the OAuth authorization server without adding a human entry method", async () => {
		const database = emptyDatabase();
		(database as MemoryDB & { oauthClient: unknown[] }).oauthClient = [];
		const configured = configureAuthEntryMethods({
			authOptions: {
				plugins: [
					jwt(),
					oauthProvider({
						loginPage: "/sign-in",
						consentPage: "/oauth/consent",
						scopes: ["openid", "profile", "email", "mcp:tools"],
						allowDynamicClientRegistration: true,
						allowUnauthenticatedClientRegistration: true,
					}),
				],
			},
			credentials: { enabled: true },
			requireVerifiedProviderEmail: true,
		});

		expect(configured.publicMethods).toEqual([
			{ id: "email", kind: "credentials" },
		]);
		expect(configured.authOptions.plugins?.map(({ id }) => id)).toEqual([
			"jwt",
			"oauth-provider",
		]);

		const auth = createTestAuth(configured, database);
		const registrationResponse = await auth.handler(
			new Request("https://auth.example.test/api/auth/oauth2/register", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					client_name: "Test MCP client",
					redirect_uris: ["https://client.example.test/callback"],
					token_endpoint_auth_method: "none",
					grant_types: ["authorization_code"],
					response_types: ["code"],
				}),
			}),
		);
		expect(registrationResponse.ok).toBe(true);
		const registration = (await registrationResponse.json()) as {
			client_id: string;
		};
		const authorizeURL = new URL(
			"https://auth.example.test/api/auth/oauth2/authorize",
		);
		authorizeURL.searchParams.set("response_type", "code");
		authorizeURL.searchParams.set("client_id", registration.client_id);
		authorizeURL.searchParams.set(
			"redirect_uri",
			"https://client.example.test/callback",
		);
		authorizeURL.searchParams.set("scope", "openid");
		authorizeURL.searchParams.set(
			"code_challenge",
			"a-valid-pkce-code-challenge-with-at-least-43-characters",
		);
		authorizeURL.searchParams.set("code_challenge_method", "S256");
		const authorizeResponse = await auth.handler(new Request(authorizeURL));
		expect(authorizeResponse.status).toBe(302);
		expect(authorizeResponse.headers.get("location")).toStartWith("/sign-in?");
		expect(database.user).toHaveLength(0);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);

		const response = await auth.handler(
			new Request("https://auth.example.test/api/auth/sign-up/email", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					email: "oauth-composition@example.test",
					name: "OAuth Composition",
					password: "a-secure-test-password",
				}),
			}),
		);
		expect(response.ok).toBe(true);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
	});

	it("normalizes the built-in GitHub numeric profile id", async () => {
		const configured = configureAuthEntryMethods({
			credentials: { enabled: false },
			socialProviders: {
				github: {
					clientId: "github-client",
					clientSecret: "github-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const provider = configured.authOptions.socialProviders?.github;
		if (!provider?.getUserInfo) throw new Error("missing GitHub provider");
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/user/emails")) {
				return Response.json([
					{
						email: "github@example.test",
						primary: true,
						verified: true,
						visibility: "private",
					},
				]);
			}
			return Response.json({
				id: 123456789,
				login: "github-user",
				name: "GitHub User",
				email: "github@example.test",
				avatar_url: "https://example.test/avatar.png",
			});
		};
		try {
			const result = await provider.getUserInfo({ accessToken: "token" });
			expect(result?.user.id).toBe("123456789");
			expect(result?.user.emailVerified).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects an unverified signed Google ID token before persistence", async () => {
		const database = emptyDatabase();
		const configured = configureAuthEntryMethods({
			credentials: { enabled: false },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const response = await signInWithSignedGoogleIdToken(
			createTestAuth(configured, database),
			{
				id: "google-id-token-unverified",
				name: "Unverified ID Token",
				email: "unverified-id-token@example.test",
				emailVerified: false,
			},
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			code: "social_provider_error",
			message: "Social provider authentication failed",
		});
		expect(database.user).toHaveLength(0);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it("persists a verified signed Google ID token identity", async () => {
		const database = emptyDatabase();
		const configured = configureAuthEntryMethods({
			credentials: { enabled: false },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const response = await signInWithSignedGoogleIdToken(
			createTestAuth(configured, database),
			{
				id: "google-id-token-verified",
				name: "Verified ID Token",
				email: "verified-id-token@example.test",
				emailVerified: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
		expect(database.session).toHaveLength(1);
	});

	it("derives a deterministic secret-free catalog from the effective config", () => {
		const result = configureAuthEntryMethods({
			credentials: { enabled: true },
			socialProviders: {
				github: {
					clientId: "github-client",
					clientSecret: "github-secret",
				},
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});

		expect(result.publicMethods).toEqual([
			{ id: "email", kind: "credentials" },
			{ id: "google", kind: "social" },
			{ id: "github", kind: "social" },
		]);
		expect(JSON.stringify(result.publicMethods)).not.toContain("secret");
		expect(result.authOptions.account?.accountLinking).toMatchObject({
			disableImplicitLinking: true,
		});
	});

	it("omits an absent provider from both the server config and public catalog", () => {
		const result = configureAuthEntryMethods({
			credentials: { enabled: false },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});

		expect(Object.keys(result.authOptions.socialProviders ?? {})).toEqual([
			"google",
		]);
		expect(result.publicMethods).toEqual([{ id: "google", kind: "social" }]);
	});

	it("merges an existing auth config while applying the protected provider last", async () => {
		const basePlugin = { id: "bearer" as const };
		const configured = configureAuthEntryMethods({
			authOptions: {
				emailAndPassword: { minPasswordLength: 14 },
				account: { updateAccountOnSignIn: false },
				plugins: [basePlugin],
			},
			...socialInput({
				id: "protected-user",
				name: "Protected",
				email: "protected@example.test",
				emailVerified: false,
			}),
		});
		const database = emptyDatabase();

		expect(configured.authOptions.emailAndPassword?.minPasswordLength).toBe(14);
		expect(configured.authOptions.account?.updateAccountOnSignIn).toBe(false);
		expect(configured.authOptions.plugins?.map(({ id }) => id)).toContain(
			basePlugin.id,
		);
		expect(
			(await signInWithGoogleCallback(createTestAuth(configured, database))).ok,
		).toBe(false);
		expect(database.user).toHaveLength(0);
	});

	it("rejects social entry methods outside the protected catalog", () => {
		for (const authOptions of [
			{
				socialProviders: {
					google: { clientId: "bypass-client", clientSecret: "bypass-secret" },
				},
			},
			{ plugins: [{ id: "generic-oauth" }] },
			{ plugins: [{ id: "one-tap" }] },
			{ plugins: [{ id: "oauth-proxy" }] },
		]) {
			expect(() =>
				configureAuthEntryMethods({
					authOptions,
					credentials: { enabled: true },
					requireVerifiedProviderEmail: true,
				} as AuthEntryMethodsInput),
			).toThrow();
		}
	});

	it.each([
		["missing", undefined],
		["null", null],
		["blank", "   "],
		["unverified", "person@example.test"],
	] as const)(
		"rejects a %s provider email before new user account or session persistence",
		async (_, email) => {
			const database = emptyDatabase();
			const auth = createTestAuth(
				configureAuthEntryMethods(
					socialInput({
						id: "provider-user-new",
						name: "Provider Person",
						email,
						emailVerified: email === undefined,
					}),
				),
				database,
			);

			const response = await signInWithGoogleCallback(auth);

			expect(response.ok).toBe(false);
			expect(response.headers.get("location")).toContain(
				"error=social_provider_error",
			);
			expect(database.user).toHaveLength(0);
			expect(database.account).toHaveLength(0);
			expect(database.session).toHaveLength(0);
		},
	);

	it("rejects a verified profile without a stable provider identity", async () => {
		const database = emptyDatabase();
		const response = await signInWithGoogleCallback(
			createTestAuth(
				configureAuthEntryMethods(
					socialInput({
						id: "   ",
						name: "Missing Identity",
						email: "missing-id@example.test",
						emailVerified: true,
					}),
				),
				database,
			),
		);

		expect(response.ok).toBe(false);
		expect(database.user).toHaveLength(0);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it("leaves an existing normalized-email identity unchanged for an unverified response", async () => {
		const now = new Date();
		const existingUser = {
			id: "existing-collision",
			name: "Existing Person",
			email: "person@example.test",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		};
		const database: MemoryDB = {
			...emptyDatabase(),
			user: [existingUser],
		};
		const auth = createTestAuth(
			configureAuthEntryMethods(
				socialInput({
					id: "provider-collision",
					name: "Provider Person",
					email: "PERSON@example.test",
					emailVerified: false,
				}),
			),
			database,
		);

		expect((await signInWithGoogleCallback(auth)).ok).toBe(false);
		expect(database.user).toEqual([existingUser]);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it("does not refresh an already-linked account or create a session for an unverified response", async () => {
		const now = new Date();
		const existingUser = {
			id: "existing-linked-user",
			name: "Existing Linked",
			email: "linked@example.test",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		};
		const existingAccount = {
			id: "existing-linked-account",
			userId: existingUser.id,
			providerId: "google",
			accountId: "linked-provider-user",
			accessToken: "old-access-token",
			createdAt: now,
			updatedAt: now,
		};
		const database: MemoryDB = {
			...emptyDatabase(),
			user: [existingUser],
			account: [existingAccount],
		};
		const auth = createTestAuth(
			configureAuthEntryMethods(
				socialInput({
					id: existingAccount.accountId,
					name: "Provider Linked",
					email: existingUser.email,
					emailVerified: false,
				}),
			),
			database,
		);

		expect((await signInWithGoogleCallback(auth)).ok).toBe(false);
		expect(database.user).toEqual([existingUser]);
		expect(database.account).toEqual([existingAccount]);
		expect(database.session).toHaveLength(0);
	});

	it("persists one user account and session for a verified new identity", async () => {
		const database = emptyDatabase();
		const auth = createTestAuth(
			configureAuthEntryMethods(
				socialInput({
					id: "verified-provider-user",
					name: "Verified Person",
					email: "verified@example.test",
					emailVerified: true,
				}),
			),
			database,
		);

		expect((await signInWithGoogleCallback(auth)).headers.get("location")).toBe(
			"https://auth.example.test/complete",
		);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
		expect(database.session).toHaveLength(1);
	});

	it("does not link a verified identity to an existing normalized email", async () => {
		const now = new Date();
		const existingUser = {
			id: "verified-collision",
			name: "Existing Person",
			email: "collision@example.test",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		};
		const database: MemoryDB = {
			...emptyDatabase(),
			user: [existingUser],
		};
		const auth = createTestAuth(
			configureAuthEntryMethods(
				socialInput({
					id: "verified-provider-collision",
					name: "Provider Person",
					email: "  COLLISION@example.test  ",
					emailVerified: true,
				}),
			),
			database,
		);

		expect((await signInWithGoogleCallback(auth)).ok).toBe(false);
		expect(database.user).toEqual([existingUser]);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it.each(["google", "github"] as const)(
		"applies the verified-email gate to the %s authorization-code callback",
		async (provider) => {
			const database = emptyDatabase();
			const providerUser = {
				id: provider === "github" ? 987654321 : "google-callback-user",
				name: "Callback Person",
				email: "callback@example.test",
				emailVerified: false,
			};
			const configured = configureAuthEntryMethods({
				credentials: { enabled: false },
				socialProviders: {
					[provider]: {
						clientId: `${provider}-client`,
						clientSecret: `${provider}-secret`,
					},
				},
				requireVerifiedProviderEmail: true,
			});
			const auth = createTestAuth(configured, database);
			const { state, cookie } = await beginSocialCallback(auth, provider);

			const response = await withFakeProviderNetwork(
				provider,
				providerUser,
				() =>
					auth.handler(
						new Request(
							`https://auth.example.test/api/auth/callback/${provider}?code=provider-code&state=${state}`,
							{ headers: { cookie } },
						),
					),
			);

			expect(response.status).toBe(302);
			const location = response.headers.get("location") ?? "";
			expect(location).toContain("error=social_provider_error");
			expect(location).not.toContain("unable_to_get_user_info");
			expect(database.user).toHaveLength(0);
			expect(database.account).toHaveLength(0);
			expect(database.session).toHaveLength(0);
		},
	);

	it.each(["normalized-email collision", "already-linked account"] as const)(
		"keeps the %s unchanged on an unverified authorization-code callback",
		async (scenario) => {
			const now = new Date();
			const existingUser = {
				id: "callback-existing-user",
				name: "Existing Callback User",
				email: "callback-existing@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			};
			const existingAccount = {
				id: "callback-existing-account",
				userId: existingUser.id,
				providerId: "google",
				accountId: "callback-provider-user",
				accessToken: "old-callback-token",
				createdAt: now,
				updatedAt: now,
			};
			const database: MemoryDB = {
				...emptyDatabase(),
				user: [existingUser],
				account: scenario === "already-linked account" ? [existingAccount] : [],
			};
			const providerUser = {
				id: existingAccount.accountId,
				name: "Unverified Callback",
				email: existingUser.email.toUpperCase(),
				emailVerified: false,
			};
			const auth = createTestAuth(
				configureAuthEntryMethods({
					credentials: { enabled: false },
					socialProviders: {
						google: {
							clientId: "google-client",
							clientSecret: "google-secret",
						},
					},
					requireVerifiedProviderEmail: true,
				}),
				database,
			);
			const { state, cookie } = await beginSocialCallback(auth, "google");

			const response = await withFakeProviderNetwork(
				"google",
				providerUser,
				() =>
					auth.handler(
						new Request(
							`https://auth.example.test/api/auth/callback/google?code=provider-code&state=${state}`,
							{ headers: { cookie } },
						),
					),
			);

			expect(response.headers.get("location")).toContain(
				"error=social_provider_error",
			);
			expect(database.user).toEqual([existingUser]);
			expect(database.account).toEqual(
				scenario === "already-linked account" ? [existingAccount] : [],
			);
			expect(database.session).toHaveLength(0);
		},
	);

	it("scrubs an unknown callback failure code and description", async () => {
		const configured = configureAuthEntryMethods({
			authOptions: {
				databaseHooks: {
					user: {
						create: {
							before: async () => {
								throw new APIError("BAD_REQUEST", {
									code: "internal_detail_leaked-secret-token-abc",
									message: "private database detail",
								});
							},
						},
					},
				},
			},
			...socialInput({
				id: "hook-error-user",
				name: "Hook Error",
				email: "hook-error@example.test",
				emailVerified: true,
			}),
		});
		const auth = createTestAuth(configured);
		const { state, cookie } = await beginSocialCallback(auth, "google");
		const response = await withFakeTokenExchange(() =>
			auth.handler(
				new Request(
					`https://auth.example.test/api/auth/callback/google?code=provider-code&state=${state}`,
					{ headers: { cookie } },
				),
			),
		);
		const location = response.headers.get("location") ?? "";

		expect(location).toContain("error=social_provider_error");
		expect(location).not.toContain("internal_detail");
		expect(location).not.toContain("private+database+detail");
	});

	it("preserves a relative successful callback redirect", async () => {
		const database = emptyDatabase();
		const configured = configureAuthEntryMethods(
			socialInput({
				id: "relative-callback-user",
				name: "Relative Callback",
				email: "relative@example.test",
				emailVerified: true,
			}),
		);
		const auth = createTestAuth(configured, database);
		const { state, cookie } = await beginSocialCallback(
			auth,
			"google",
			"/complete?error=none&next=/inbox",
		);

		const response = await withFakeTokenExchange(() =>
			auth.handler(
				new Request(
					`https://auth.example.test/api/auth/callback/google?code=provider-code&state=${state}`,
					{ headers: { cookie } },
				),
			),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"/complete?error=none&next=/inbox",
		);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(1);
		expect(database.session).toHaveLength(1);
	});

	it("preserves a successful explicit-link callback containing an error key", async () => {
		const database = emptyDatabase();
		const configured = configureAuthEntryMethods({
			credentials: { enabled: true },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const auth = createTestAuth(configured, database);
		const signUp = await auth.handler(
			new Request("https://auth.example.test/api/auth/sign-up/email", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					email: "link@example.test",
					name: "Link Person",
					password: "a-secure-test-password",
				}),
			}),
		);
		const sessionCookie = signUp.headers
			.getSetCookie()
			.map((value) => value.split(";", 1)[0])
			.join("; ");
		const { state, cookie } = await beginLinkCallback(
			auth,
			sessionCookie,
			"/settings?error=none&tab=accounts",
		);
		const response = await withFakeProviderNetwork(
			"google",
			{
				id: "linked-google-user",
				name: "Link Person",
				email: "link@example.test",
				emailVerified: true,
			},
			() =>
				auth.handler(
					new Request(
						`https://auth.example.test/api/auth/callback/google?code=provider-code&state=${state}`,
						{ headers: { cookie } },
					),
				),
		);

		expect(response.headers.get("location")).toBe(
			"/settings?error=none&tab=accounts",
		);
		expect(database.user).toHaveLength(1);
		expect(database.account).toHaveLength(2);
	});

	it("keeps non-social credential error codes unchanged", async () => {
		const auth = createTestAuth(
			configureAuthEntryMethods({
				credentials: { enabled: true },
				requireVerifiedProviderEmail: true,
			}),
		);
		const response = await auth.handler(
			new Request("https://auth.example.test/api/auth/reset-password", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					newPassword: "a-secure-test-password",
					token: "bad-token",
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
	});

	it("does not let mapProfileToUser upgrade an unverified provider email", async () => {
		const database = emptyDatabase();
		const input = socialInput({
			id: "mapper-user",
			name: "Mapper User",
			email: "mapper@example.test",
			emailVerified: false,
		});
		if (!input.socialProviders?.google)
			throw new Error("missing fixture provider");
		input.socialProviders.google.mapProfileToUser = async () => ({
			emailVerified: true,
		});

		const response = await signInWithGoogleCallback(
			createTestAuth(configureAuthEntryMethods(input), database),
		);

		expect(response.ok).toBe(false);
		expect(database.user).toHaveLength(0);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it("normalizes provider cancellation without reflecting its raw description", async () => {
		const diagnostics: string[] = [];
		const configured = configureAuthEntryMethods({
			authOptions: {
				logger: {
					log: (_level, message, ...details) =>
						diagnostics.push(`${message} ${JSON.stringify(details)}`),
				},
			},
			credentials: { enabled: false },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const auth = createTestAuth(configured);
		const { state, cookie } = await beginSocialCallback(auth, "google");
		const response = await auth.handler(
			new Request(
				`https://auth.example.test/api/auth/callback/%67oogle?error=access_denied&error_description=private-provider-detail&state=${state}`,
				{ headers: { cookie } },
			),
		);
		const location = response.headers.get("location") ?? "";

		expect(response.status).toBe(302);
		expect(location).toContain("error=social_provider_error");
		expect(location).not.toContain("access_denied");
		expect(location).not.toContain("private-provider-detail");
		expect(location).not.toContain("error_description");
		expect(diagnostics.join("\n")).toContain("private-provider-detail");
	});

	it("uses the configured API error URL when social errorCallbackURL is omitted", async () => {
		const configured = configureAuthEntryMethods({
			authOptions: {
				onAPIError: {
					errorURL: "https://auth.example.test/custom-error",
				},
			},
			credentials: { enabled: false },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
		});
		const auth = createTestAuth(configured);
		const startResponse = await auth.handler(
			new Request("https://auth.example.test/api/auth/sign-in/social", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					provider: "google",
					callbackURL: "https://auth.example.test/complete",
					disableRedirect: true,
				}),
			}),
		);
		const startBody = (await startResponse.json()) as { url: string };
		const state = new URL(startBody.url).searchParams.get("state") ?? "";
		const cookie = startResponse.headers
			.getSetCookie()
			.map((value) => value.split(";", 1)[0])
			.join("; ");
		const response = await auth.handler(
			new Request(
				`https://auth.example.test/api/auth/callback/google?error=access_denied&error_description=private-provider-detail&state=${state}`,
				{ headers: { cookie } },
			),
		);
		const location = new URL(
			response.headers.get("location") ?? "",
			"https://auth.example.test",
		);

		expect(response.status).toBe(302);
		expect(location.pathname).toBe("/custom-error");
		expect(location.searchParams.get("error")).toBe("social_provider_error");
		expect(location.searchParams.has("error_description")).toBe(false);
	});

	it("enables the browser-only last-method cookie only with multiple methods", async () => {
		const multiple = configureAuthEntryMethods({
			credentials: { enabled: true },
			socialProviders: {
				google: {
					clientId: "google-client",
					clientSecret: "google-secret",
				},
			},
			requireVerifiedProviderEmail: true,
			lastLoginMethod: {
				enabledWhenMultiple: true,
				storeInDatabase: false,
			},
		});
		const database = emptyDatabase();
		const response = await createTestAuth(multiple, database).handler(
			new Request("https://auth.example.test/api/auth/sign-up/email", {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					email: "last-method@example.test",
					name: "Last Method",
					password: "a-secure-test-password",
				}),
			}),
		);
		const cookies = response.headers.getSetCookie().join("\n");

		expect(response.ok).toBe(true);
		expect(cookies).toContain("better-auth.last_used_login_method=email");
		expect(cookies.toLowerCase()).toContain("max-age=2592000");
		expect(JSON.stringify(database.user)).not.toContain("lastLoginMethod");

		const single = configureAuthEntryMethods({
			credentials: { enabled: true },
			requireVerifiedProviderEmail: true,
			lastLoginMethod: {
				enabledWhenMultiple: true,
				storeInDatabase: false,
			},
		});
		expect(single.authOptions.plugins).toEqual([]);
	});

	it.each(["github", "disabled-provider", "stale-provider"])(
		"ignores a forged or stale last-method cookie value %s",
		async (cookieValue) => {
			const configured = configureAuthEntryMethods({
				credentials: { enabled: true },
				socialProviders: {
					google: {
						clientId: "google-client",
						clientSecret: "google-secret",
					},
				},
				requireVerifiedProviderEmail: true,
				lastLoginMethod: {
					enabledWhenMultiple: true,
					storeInDatabase: false,
				},
			});
			const database = emptyDatabase();
			const response = await createTestAuth(configured, database).handler(
				new Request("https://auth.example.test/api/auth/sign-up/email", {
					method: "POST",
					headers: {
						...jsonHeaders,
						cookie: `better-auth.last_used_login_method=${cookieValue}`,
					},
					body: JSON.stringify({
						email: `${cookieValue}@example.test`,
						name: "Cookie Oracle",
						password: "a-secure-test-password",
					}),
				}),
			);

			expect(response.ok).toBe(true);
			expect(response.headers.getSetCookie().join("\n")).toContain(
				"better-auth.last_used_login_method=email",
			);
			expect(database.account).toHaveLength(1);
			expect(database.account[0]?.providerId).toBe("credential");
		},
	);
});
