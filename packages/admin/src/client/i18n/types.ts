/**
 * I18n Types
 *
 * Minimal type definitions for i18n integration.
 * Designed to work with any i18n library.
 */

import type * as React from "react";

// ============================================================================
// Message Registry (Type-Safe Translation Keys)
// ============================================================================

/**
 * Message Registry for type-safe translation keys.
 *
 * This is an augmentation target - users can extend it for type-safe keys.
 * By default, the `t` function accepts any string key.
 *
 * @example
 * ```ts
 * // Optional: Augment for type-safe keys
 * declare module "@questpie/admin" {
 *   interface MessageRegistry {
 *     messages: typeof myMessages;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Augmentation target for user's message types
export interface MessageRegistry {
  // Augment this interface to provide type-safe message keys:
  // declare module "@questpie/admin" {
  //   interface MessageRegistry {
  //     messages: typeof adminMessagesEN;
  //   }
  // }
}

/**
 * Extract message keys from MessageRegistry if augmented, otherwise string.
 */
export type MessageKey = MessageRegistry extends { messages: infer T }
  ? keyof T & string
  : string;

// ============================================================================
// Core Adapter Interface
// ============================================================================

/**
 * I18n Adapter Interface
 *
 * This is the contract that any i18n implementation must fulfill.
 * Designed to be easily implemented by wrapping i18next, react-intl, etc.
 */
export interface I18nAdapter {
  /**
   * Current UI locale (e.g., "en", "de", "sk")
   */
  readonly locale: string;

  /**
   * Available locales
   */
  readonly locales: string[];

  /**
   * Translate a key
   *
   * @param key - Translation key (e.g., "common.save")
   * @param params - Interpolation values (e.g., { count: 5 })
   */
  t(key: string, params?: Record<string, unknown>): string;

  /**
   * Change the current locale
   */
  setLocale(locale: string): void | Promise<void>;

  /**
   * Subscribe to locale changes
   *
   * @param callback - Called when locale changes
   * @returns Unsubscribe function
   */
  onLocaleChange(callback: (locale: string) => void): () => void;

  /**
   * Format a date (uses Intl.DateTimeFormat)
   */
  formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions): string;

  /**
   * Format a number (uses Intl.NumberFormat)
   */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;

  /**
   * Format relative time (e.g., "2 days ago")
   */
  formatRelative?(date: Date | number): string;

  /**
   * Get display name for a locale (e.g., "en" -> "English")
   */
  getLocaleName(locale: string): string;

  /**
   * Check if current locale is RTL
   */
  isRTL(): boolean;
}

// ============================================================================
// I18nText - For Config Values
// ============================================================================

/**
 * Inline translations object - maps locale codes to translated strings
 *
 * @example
 * ```ts
 * { en: "Barbers", sk: "Holiči", cz: "Holiči" }
 * ```
 */
export type I18nLocaleMap = {
  [locale: string]: string;
};

/**
 * I18nText - A value that can be translated
 *
 * Used in admin config for labels, descriptions, etc.
 * Supports multiple formats for flexibility.
 *
 * @example
 * ```ts
 * // Simple string (no translation)
 * label: "Posts"
 *
 * // Translation key
 * label: { key: "nav.posts" }
 *
 * // Translation key with fallback
 * label: { key: "nav.posts", fallback: "Posts" }
 *
 * // Inline translations (recommended for collection/global labels)
 * label: { en: "Barbers", sk: "Holiči", cz: "Holiči" }
 *
 * // Dynamic function
 * label: (ctx) => ctx.t("nav.posts")
 * ```
 */
export type I18nText =
  | string
  | { key: string; fallback?: string; params?: Record<string, unknown> }
  | I18nLocaleMap
  | ((ctx: I18nContext) => string);

/**
 * Context passed to I18nText functions
 */
export interface I18nContext {
  locale: string;
  t: I18nAdapter["t"];
  formatDate: I18nAdapter["formatDate"];
  formatNumber: I18nAdapter["formatNumber"];
}

// ============================================================================
// React Types
// ============================================================================

/**
 * Props for the I18nProvider component
 */
export interface I18nProviderProps {
  /**
   * I18n adapter instance (source of truth for UI locale)
   */
  adapter: I18nAdapter;

  /**
   * Children to render
   */
  children: React.ReactNode;
}

/**
 * Return type of useTranslation hook
 */
export interface UseTranslationResult {
  /** Current locale */
  locale: string;
  /** Available locales */
  locales: string[];
  /** Translate function */
  t: I18nAdapter["t"];
  /** Change locale */
  setLocale: I18nAdapter["setLocale"];
  /** Format date */
  formatDate: I18nAdapter["formatDate"];
  /** Format number */
  formatNumber: I18nAdapter["formatNumber"];
  /** Get locale display name */
  getLocaleName: I18nAdapter["getLocaleName"];
  /** Is RTL locale */
  isRTL: boolean;
}
