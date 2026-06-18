import type { Auth } from "better-auth";

import type {
	AppConfigInput,
	AppConfigResolved,
	AuthConfig,
} from "./module-types.js";
import type { ValidateContextResolver } from "./types.js";

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
 * import { appConfig } from "questpie/app";
 *
 * export default appConfig({
 *   locale: { locales: [{ code: "en" }], defaultLocale: "en" },
 *   access: { read: true },
 *   hooks: { collections: [...] },
 *   context: async ({ session }) => ({ role: session?.user?.role ?? "guest" }),
 * });
 * ```
 */
export function appConfig<T extends AppConfigInput>(
	config: T & {
		// Reject a `context` resolver that resolves to only a primitive or only
		// `null` — extensions must be an object bundle. `session ? {…} : null`
		// passes. Generic capture fires at THIS call, so the error lands on the
		// bad `appConfig({...})` (not on a `Parameters<…>` assignment).
		context?: ValidateContextResolver<NonNullable<T["context"]>>;
	},
): AppConfigResolved<T> {
	// Runtime is identity — the erasure is type-level only. access/hooks are
	// fully typed at the CALL SITE (rule ctx params infer), but deliberately
	// never captured in a generic: contextually-typed rule functions embed
	// AccessContext (= the merged AppContext) in their inferred types, and
	// riding `typeof appConfig-file` back into the generated index collapses
	// the whole AppContext augmentation (TS2456). Only locale and the context
	// resolver (whose ANNOTATED return drives extension inference) survive
	// into the return type. Same erasure precedent as CollectionAccessStorage.
	return config as unknown as AppConfigResolved<T>;
}

/**
 * Identity factory for `config/auth.ts` — provides type inference for
 * auth configuration (Better Auth options).
 *
 * @example
 * ```ts
 * // config/auth.ts
 * import { authConfig } from "questpie/app";
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
