/**
 * Server-Side Type Definitions for Admin Package
 *
 * Barrel re-export of all admin augmentation types, split by domain:
 * - common: ComponentReference, ComponentTypeRegistry, AdminLocaleConfig
 * - views: ViewDefinition, ComponentDefinition, ComponentFactory, view factories
 * - form-layout: FormViewConfig, ListViewConfig, admin collection/global config
 * - dashboard: all dashboard widget and config types
 * - sidebar: sidebar items, sections, contributions
 * - shell: admin shell slots and rail configuration
 * - actions: action system types
 *
 * @example
 * ```ts
 * import type { AdminCollectionConfig, FormViewConfig } from "@questpie/admin/server";
 * ```
 */

export * from "./common.js";
export * from "./views.js";
export * from "./form-layout.js";
export * from "./dashboard.js";
export * from "./sidebar.js";
export * from "./shell.js";
export * from "./actions.js";

// ============================================================================
// Admin Config Input — composite config/admin.ts type
// ============================================================================

import type { AdminSidebarMode } from "questpie";

import type { AdminLocaleConfig } from "./common.js";
import type {
	DashboardContribution,
	ServerBrandingConfig,
	ServerDashboardConfig,
} from "./dashboard.js";
import type { ServerAdminShellConfig } from "./shell.js";
import type { SidebarContribution } from "./sidebar.js";

/**
 * Input type for `config/admin.ts` — a composite config file that consolidates
 * sidebar, dashboard, branding, and locale into a single file.
 *
 * Used with `adminConfig()` factory for type inference.
 *
 * @example
 * ```ts
 * // config/admin.ts
 * import { adminConfig } from "@questpie/admin/server";
 *
 * export default adminConfig({
 *   sidebar: [s.section({ ... }), s.item({ ... })],
 *   branding: { name: "My Admin" },
 *   locale: { defaultLocale: "en" },
 * });
 * ```
 */
export interface AdminConfigInput {
	/**
	 * How module `sidebar` contributions combine with the app config.
	 * `append` (default): merge module items into the app sidebar.
	 * `replace`: keep only this file's `sidebar` (no module nav injection).
	 */
	sidebarMode?: AdminSidebarMode;
	sidebar?: SidebarContribution;
	dashboard?: DashboardContribution | ServerDashboardConfig;
	shell?: ServerAdminShellConfig;
	branding?: ServerBrandingConfig;
	locale?: AdminLocaleConfig;
}

/**
 * Identity factory for `config/admin.ts` — provides type inference.
 */
export function adminConfig<T extends AdminConfigInput>(config: T): T {
	return config;
}

// ============================================================================
// Builder Method Types (for documentation — augmented via codegen)
// ============================================================================

// ============================================================================
// AppStateConfig augmentation — admin config bucket key
// ============================================================================

declare module "questpie" {
	interface AppStateConfig {
		admin?: AdminConfigInput;
	}
}
