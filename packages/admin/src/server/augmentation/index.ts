/**
 * Server-Side Type Definitions for Admin Package
 *
 * Barrel re-export of all admin augmentation types, split by domain:
 * - common: ComponentReference, ComponentTypeRegistry, AdminLocaleConfig
 * - views: ViewDefinition, ComponentDefinition, ComponentFactory, view factories
 * - form-layout: FormViewConfig, ListViewConfig, admin collection/global config
 * - dashboard: all dashboard widget and config types
 * - sidebar: sidebar items, sections, contributions
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
export * from "./actions.js";

// ============================================================================
// Admin Config Input — composite config/admin.ts type
// ============================================================================

import type { AdminLocaleConfig } from "./common.js";
import type {
	DashboardContribution,
	ServerBrandingConfig,
	ServerDashboardConfig,
} from "./dashboard.js";
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
	sidebar?: SidebarContribution;
	dashboard?: DashboardContribution | ServerDashboardConfig;
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

import type { ActionsConfigContext, ServerActionsConfig } from "./actions.js";
import type {
	AdminCollectionConfig,
	AdminGlobalConfig,
	FormViewConfig,
	ListViewConfig,
	PreviewConfig,
} from "./form-layout.js";
import type {
	AdminConfigContext,
	ComponentFactory,
	FormViewConfigContext,
	ListViewConfigContext,
} from "./views.js";

/**
 * Admin methods added to CollectionBuilder via monkey patching.
 */
interface CollectionBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
	TListViewNames extends string = string,
	TEditViewNames extends string = string,
	TComponents extends Record<string, any> | string = string,
> {
	/**
	 * Set admin metadata for the collection.
	 */
	admin(
		configOrFn:
			| AdminCollectionConfig
			| ((ctx: AdminConfigContext<TComponents>) => AdminCollectionConfig),
	): this;

	/**
	 * Configure list view for the collection.
	 */
	list(
		configFn: (
			ctx: ListViewConfigContext<TFields, TListViewNames>,
		) => ListViewConfig,
	): this;

	/**
	 * Configure form view for the collection.
	 */
	form(
		configFn: (
			ctx: FormViewConfigContext<TFields, TEditViewNames>,
		) => FormViewConfig,
	): this;

	/**
	 * Configure preview for the collection.
	 */
	preview(config: PreviewConfig): this;

	/**
	 * Configure actions for the collection.
	 * Enables built-in actions and custom actions with forms.
	 *
	 * @example
	 * ```ts
	 * .actions(({ a, c, fr }) => ({
	 *   builtin: [a.create(), a.delete(), a.deleteMany()],
	 *   custom: [
	 *     a.action({
	 *       id: "publish",
	 *       label: { en: "Publish" },
	 *       icon: c.icon("ph:check-circle"),
	 *       handler: async ({ itemId }) => {
	 *         return { type: "success", toast: { message: "Published!" } };
	 *       },
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	actions(
		configFn: (
			ctx: ActionsConfigContext<TFields, TComponents>,
		) => ServerActionsConfig,
	): this;
}

/**
 * Admin methods added to GlobalBuilder via monkey patching.
 */
interface GlobalBuilderAdminMethods<
	TFields extends Record<string, any> = Record<string, any>,
	TEditViewNames extends string = string,
	TComponents extends Record<string, any> | string = string,
> {
	/**
	 * Set admin metadata for the global.
	 */
	admin(
		configOrFn:
			| AdminGlobalConfig
			| ((ctx: AdminConfigContext<TComponents>) => AdminGlobalConfig),
	): this;

	/**
	 * Configure form view for the global.
	 */
	form(
		configFn: (
			ctx: FormViewConfigContext<TFields, TEditViewNames>,
		) => FormViewConfig,
	): this;
}

// ============================================================================
// AppStateConfig augmentation — admin config bucket key
// ============================================================================

declare module "questpie" {
	interface AppStateConfig {
		admin?: AdminConfigInput;
	}
}
