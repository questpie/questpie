/**
 * Plugin-extensible config bucket for `app.state.config`.
 *
 * Each config FILE in `config/` maps to one KEY here:
 * - `config/app.ts`     → `AppStateConfig.app`
 * - `config/auth.ts`    → `AppStateConfig.auth`
 * - `config/admin.ts`   → `AppStateConfig.admin`  (augmented by @questpie/admin)
 * - `config/openapi.ts` → `AppStateConfig.openapi` (augmented by @questpie/openapi)
 *
 * Plugins augment this interface:
 * ```ts
 * declare module "questpie" {
 *   interface AppStateConfig {
 *     myPlugin?: MyPluginConfig;
 *   }
 * }
 * ```
 */
export interface AppStateConfig {
	app?: import("./module-types.js").AppConfigInput;
	auth?: import("better-auth").BetterAuthOptions;
}

export type ResolvedAppStateConfig = Partial<AppStateConfig> &
	Record<string, unknown>;
