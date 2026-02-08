/**
 * Admin Runtime Class
 *
 * Wraps AdminBuilder state with runtime methods for accessing configuration.
 * This is what gets passed to AdminProvider and used throughout the admin UI.
 */

import { DEFAULT_LOCALE, DEFAULT_LOCALE_CONFIG } from "questpie/shared";
import type { AdminBuilder } from "./admin-builder";
import type { AdminBuilderState } from "./admin-types";
import type {
  RegisteredAdmin,
  RegisteredCMS,
  RegisteredCollectionNames,
  RegisteredGlobalNames,
} from "./registry";

// ============================================================================
// Type Helpers for State Extraction
// ============================================================================

/**
 * Extract state from a builder or return the value as-is.
 * Builders have a `state` property, plain configs do not.
 */
type ExtractBuilderState<T> = T extends { state: infer S } ? S : T;

/**
 * Map over a record and extract state from each builder value.
 */
type ExtractBuilderStates<T> = {
  [K in keyof T]: ExtractBuilderState<T[K]>;
};

/**
 * Input type for Admin - accepts either an AdminBuilder or Admin instance
 */
export type AdminInput<TState extends AdminBuilderState = AdminBuilderState> =
  | AdminBuilder<TState>
  | Admin<TState>;

// ============================================================================
// Admin Class
// ============================================================================

/**
 * Admin runtime instance
 *
 * Provides methods to access admin configuration at runtime.
 *
 * @example
 * ```ts
 * import { Admin } from "@questpie/admin/builder";
 *
 * // Direct usage - pass builder to AdminLayoutProvider
 * <AdminLayoutProvider admin={admin} ... />
 *
 * // Or create Admin instance explicitly if needed
 * const adminInstance = Admin.normalize(adminBuilder);
 * ```
 */
export class Admin<TState extends AdminBuilderState = AdminBuilderState> {
  constructor(public readonly state: TState) {}

  /**
   * Normalize input to Admin instance (internal helper)
   */
  static normalize<TState extends AdminBuilderState>(
    input: AdminInput<TState>,
  ): Admin<TState> {
    if (input instanceof Admin) {
      return input;
    }
    return new Admin(input.state);
  }

  // ============================================================================
  // Page Methods
  // ============================================================================

  /**
   * Get all custom page configurations.
   * Automatically extracts `.state` from builders.
   */
  getPages(): ExtractBuilderStates<TState["pages"]> {
    const pages = this.state.pages ?? {};
    const result: Record<string, any> = {};

    for (const [name, config] of Object.entries(pages)) {
      // Extract state from builders, pass through plain configs
      result[name] =
        config && typeof config === "object" && "state" in config
          ? (config as any).state
          : config;
    }

    return result as ExtractBuilderStates<TState["pages"]>;
  }

  // ============================================================================
  // Component Methods
  // ============================================================================

  /**
   * Get all registered component implementations.
   */
  getComponents(): ExtractBuilderStates<TState["components"]> {
    const components = this.state.components ?? {};
    const result: Record<string, any> = {};

    for (const [name, config] of Object.entries(components)) {
      result[name] =
        config && typeof config === "object" && "state" in config
          ? (config as any).state
          : config;
    }

    return result as ExtractBuilderStates<TState["components"]>;
  }

  /**
   * Get a specific component implementation by name.
   */
  getComponent(
    name: string,
  ): ExtractBuilderState<TState["components"][string]> | undefined {
    const config = (this.state.components as Record<string, any>)?.[name];
    if (!config) return undefined;

    return config && typeof config === "object" && "state" in config
      ? config.state
      : config;
  }

  /**
   * Get configuration for a specific page.
   * Automatically extracts `.state` from builder.
   */
  getPageConfig(
    name: string,
  ): ExtractBuilderState<TState["pages"][string]> | undefined {
    const config = (this.state.pages as Record<string, any>)?.[name];
    if (!config) return undefined;

    // Extract state from builder, pass through plain config
    return config && typeof config === "object" && "state" in config
      ? config.state
      : config;
  }

  // ============================================================================
  // UI Configuration Methods
  // ============================================================================

  /**
   * Get default views configuration
   */
  getDefaultViews(): TState["defaultViews"] {
    return this.state.defaultViews ?? ({} as TState["defaultViews"]);
  }

  // ============================================================================
  // Locale Methods
  // ============================================================================

  /**
   * Get locale configuration
   */
  getLocale(): TState["locale"] {
    return this.state.locale ?? DEFAULT_LOCALE_CONFIG;
  }

  /**
   * Get available locales
   */
  getAvailableLocales(): string[] {
    return this.getLocale().supported ?? [DEFAULT_LOCALE];
  }

  /**
   * Get default locale
   */
  getDefaultLocale(): string {
    return this.getLocale().default ?? DEFAULT_LOCALE;
  }

  /**
   * Get human-readable label for a locale
   */
  getLocaleLabel(locale: string): string {
    // TODO: Support custom labels from locale config
    const labels: Record<string, string> = {
      en: "English",
      sk: "Slovencina",
      cs: "Cestina",
      de: "Deutsch",
      fr: "Francais",
      es: "Espanol",
      it: "Italiano",
      pt: "Portugues",
      pl: "Polski",
      nl: "Nederlands",
      ru: "Russkij",
      uk: "Ukrainska",
      ja: "Nihongo",
      ko: "Hangugeo",
      zh: "Zhongwen",
    };
    return labels[locale] ?? locale.toUpperCase();
  }

  // ============================================================================
  // Translations Methods
  // ============================================================================

  /**
   * Get translations map from builder state
   * Used by AdminProvider to initialize i18n
   */
  getTranslations(): TState["translations"] {
    return this.state.translations ?? ({} as TState["translations"]);
  }

  // ============================================================================
  // Registry Methods (for field/view lookups)
  // ============================================================================

  /**
   * Get all registered field definitions
   */
  getFields(): TState["fields"] {
    return this.state.fields ?? ({} as TState["fields"]);
  }

  /**
   * Get a specific field definition
   */
  getField(name: string): TState["fields"][string] | undefined {
    return (this.state.fields as Record<string, any>)?.[name];
  }

  /**
   * Get all registered list view definitions
   */
  getListViews(): TState["listViews"] {
    return this.state.listViews ?? ({} as TState["listViews"]);
  }

  /**
   * Get all registered edit view definitions
   */
  getEditViews(): TState["editViews"] {
    return this.state.editViews ?? ({} as TState["editViews"]);
  }

  /**
   * Get all registered widget definitions
   */
  getWidgets(): TState["widgets"] {
    return this.state.widgets ?? ({} as TState["widgets"]);
  }
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Infer the CMS type from an Admin instance
 */
export type InferAdminCMS<TAdmin> =
  TAdmin extends Admin<infer TState>
    ? TState extends { "~app": infer TApp }
      ? TApp
      : unknown
    : unknown;

/**
 * Get the registered Admin type (from module augmentation)
 */
export type AppAdmin =
  RegisteredAdmin extends AdminBuilder<infer TState>
    ? Admin<TState>
    : Admin<AdminBuilderState>;
