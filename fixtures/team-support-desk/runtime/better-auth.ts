import type * as BetterAuth from "better-auth";
import { Pool } from "pg";

import { demoAuthIdentities } from "../src/auth/demo-identities";

const localSecret = "team-support-desk-better-auth-local-secret-v1";
const demoIdentityByEmail = new Map<
	string,
	(typeof demoAuthIdentities)[keyof typeof demoAuthIdentities]
>(
	Object.values(demoAuthIdentities).map((identity) => [
		identity.email,
		identity,
	]),
);

const runtimePackage = (specifier: string): Promise<unknown> =>
	import(specifier);

export async function createSupportBetterAuth() {
	// Runtime-only integration configuration. Structural Definitions cannot read
	// deployment values, and v4 has no createApp config projection into Services.
	const connectionString = globalThis.process.env.DATABASE_URL;
	if (!connectionString) throw new TypeError("DATABASE_URL is required");
	const trustedHost = globalThis.process.env.BETTER_AUTH_TRUSTED_HOST;
	const pool = new Pool({ connectionString, max: 4 });
	// Keep this executable-only package import outside Bun's generated server
	// bundle. Bun 1.3.14 miscompiles Better Auth 1.7.1 when the complete package
	// graph is merged into the larger QUESTPIE application bundle.
	const { betterAuth } = (await runtimePackage(
		"better-auth",
	)) as typeof BetterAuth;
	const auth = betterAuth({
		appName: "Team Support Desk",
		baseURL: {
			allowedHosts: [
				"127.0.0.1:*",
				"localhost:*",
				...(trustedHost === undefined ? [] : [trustedHost]),
			],
			protocol: "auto",
			fallback: "http://127.0.0.1:43120",
		},
		database: pool,
		secret: globalThis.process.env.BETTER_AUTH_SECRET ?? localSecret,
		emailAndPassword: { enabled: true },
		user: {
			modelName: "support_auth_user",
			additionalFields: {
				organizationHint: {
					type: "string",
					required: false,
					input: false,
				},
				membershipHint: {
					type: "string",
					required: false,
					input: false,
				},
				roleHint: {
					type: "string",
					required: false,
					input: false,
				},
			},
		},
		session: { modelName: "support_auth_session" },
		account: { modelName: "support_auth_account" },
		verification: { modelName: "support_auth_verification" },
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const identity = demoIdentityByEmail.get(user.email);
						if (!identity) return { data: user };
						return {
							data: {
								...user,
								id: identity.principalId,
								membershipHint: identity.membershipHint,
								organizationHint: identity.organizationHint,
								roleHint: identity.roleHint,
							},
						};
					},
				},
			},
		},
		advanced: {
			trustedProxyHeaders: true,
			cookiePrefix: "team-support",
			database: { generateId: () => crypto.randomUUID(), joins: true },
		},
	});
	return Object.freeze({
		auth,
		close: () => pool.end(),
	});
}

export type SupportBetterAuth = Awaited<
	ReturnType<typeof createSupportBetterAuth>
>["auth"];
