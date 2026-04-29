import type { Auth } from "better-auth";

import type { AuthConfig, AppConfigInput } from "./module-types.js";

export type TypedAuthConfig<TSession = unknown> = AuthConfig & {
	/**
	 * Internal type-only channel used by codegen to recover the inferred Better
	 * Auth session shape without forcing downstream apps to export an unnameable
	 * plugin-instantiated config type.
	 */
	__questpieSessionType__?: TSession;
};

/**
 * Identity factory for `config/app.ts` — provides type inference for
 * composite app config (locale, access, hooks, context).
 *
 * @example
 * ```ts
 * // config/app.ts
 * import { appConfig } from "questpie";
 *
 * export default appConfig({
 *   locale: { locales: [{ code: "en" }], defaultLocale: "en" },
 *   access: { read: true },
 *   hooks: { collections: [...] },
 *   context: async ({ session }) => ({ role: session?.user?.role ?? "guest" }),
 * });
 * ```
 */
export function appConfig<T extends AppConfigInput>(config: T): T {
	return config;
}

/**
 * Identity factory for `config/auth.ts` — provides type inference for
 * auth configuration (Better Auth options).
 *
 * @example
 * ```ts
 * // config/auth.ts
 * import { authConfig } from "questpie";
 *
 * export default authConfig({
 *   emailAndPassword: { enabled: true },
 *   socialProviders: { google: { clientId: "...", clientSecret: "..." } },
 * });
 * ```
 */
export function authConfig<T extends AuthConfig>(
	config: T,
): TypedAuthConfig<Auth<T>["$Infer"]["Session"]> {
	return config as TypedAuthConfig<Auth<T>["$Infer"]["Session"]>;
}
