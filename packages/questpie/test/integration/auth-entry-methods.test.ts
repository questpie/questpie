import { describe, expect, it } from "bun:test";

import { APIError, betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";

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

const socialInput = (user: {
	id: string;
	name: string;
	email?: string | null;
	emailVerified: boolean;
}): AuthEntryMethodsInput => ({
	credentials: { enabled: false },
	socialProviders: {
		google: {
			clientId: "google-client",
			clientSecret: "google-secret",
			verifyIdToken: async () => true,
			getUserInfo: async () => ({ user, data: { privateProfile: true } }),
		},
	},
	requireVerifiedProviderEmail: true,
});

const signInWithGoogleIdToken = (auth: ReturnType<typeof betterAuth>) =>
	auth.handler(
		new Request("https://auth.example.test/api/auth/sign-in/social", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				provider: "google",
				idToken: {
					token: "provider-id-token",
					accessToken: "new-provider-access-token",
				},
			}),
		}),
	);

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

async function withFakeTokenExchange<T>(run: () => Promise<T>): Promise<T> {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({
			access_token: "provider-access-token",
			expires_in: 3600,
			id_token: "provider-id-token",
			token_type: "Bearer",
		});
	try {
		return await run();
	} finally {
		globalThis.fetch = originalFetch;
	}
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
		const basePlugin = { id: "base-auth-plugin" };
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
			(await signInWithGoogleIdToken(createTestAuth(configured, database))).ok,
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

			const response = await signInWithGoogleIdToken(auth);

			expect(response.ok).toBe(false);
			expect(await response.json()).toEqual({
				code: "social_provider_error",
				message: "Social provider authentication failed",
			});
			expect(database.user).toHaveLength(0);
			expect(database.account).toHaveLength(0);
			expect(database.session).toHaveLength(0);
		},
	);

	it("rejects a verified profile without a stable provider identity", async () => {
		const database = emptyDatabase();
		const response = await signInWithGoogleIdToken(
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

		expect((await signInWithGoogleIdToken(auth)).ok).toBe(false);
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

		expect((await signInWithGoogleIdToken(auth)).ok).toBe(false);
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

		expect((await signInWithGoogleIdToken(auth)).ok).toBe(true);
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

		expect((await signInWithGoogleIdToken(auth)).ok).toBe(false);
		expect(database.user).toEqual([existingUser]);
		expect(database.account).toHaveLength(0);
		expect(database.session).toHaveLength(0);
	});

	it.each(["google", "github"] as const)(
		"applies the verified-email gate to the %s authorization-code callback",
		async (provider) => {
			const database = emptyDatabase();
			const configured = configureAuthEntryMethods({
				credentials: { enabled: false },
				socialProviders: {
					[provider]: {
						clientId: `${provider}-client`,
						clientSecret: `${provider}-secret`,
						getUserInfo: async () => ({
							user: {
								id: `${provider}-callback-user`,
								name: "Callback Person",
								email: "callback@example.test",
								emailVerified: false,
							},
							data: { privateProfile: true },
						}),
					},
				},
				requireVerifiedProviderEmail: true,
			});
			const auth = createTestAuth(configured, database);
			const { state, cookie } = await beginSocialCallback(auth, provider);

			const response = await withFakeTokenExchange(() =>
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
			expect(location).not.toContain("privateProfile");
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
			const auth = createTestAuth(
				configureAuthEntryMethods({
					credentials: { enabled: false },
					socialProviders: {
						google: {
							clientId: "google-client",
							clientSecret: "google-secret",
							getUserInfo: async () => ({
								user: {
									id: existingAccount.accountId,
									name: "Unverified Callback",
									email: existingUser.email.toUpperCase(),
									emailVerified: false,
								},
								data: {},
							}),
						},
					},
					requireVerifiedProviderEmail: true,
				}),
				database,
			);
			const { state, cookie } = await beginSocialCallback(auth, "google");

			const response = await withFakeTokenExchange(() =>
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

		const response = await signInWithGoogleIdToken(
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
