/**
 * Plugin-extensible config bucket for app.state.config.
 *
 * Plugins augment this interface to declare their config keys:
 * ```ts
 * declare module "questpie" {
 *   interface AppStateConfig {
 *     openapi?: OpenApiModuleConfig;
 *   }
 * }
 * ```
 *
 * All plugin-declared config keys are stored at `app.state.config.<key>`
 * instead of polluting the top-level `app.state`.
 */
export interface AppStateConfig {}

export type ResolvedAppStateConfig = Partial<AppStateConfig> &
	Record<string, unknown>;
