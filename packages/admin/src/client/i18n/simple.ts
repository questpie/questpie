/**
 * Simple I18n Implementation
 *
 * A minimal i18n implementation for basic use cases.
 * For full i18n features (pluralization, ICU, etc.), use i18next or react-intl.
 *
 * Features:
 * - Basic key-value translation
 * - Simple interpolation ({{key}})
 * - Uses Intl APIs for formatting
 * - Basic pluralization via Intl.PluralRules
 */

import {
  getDateTimeFormat,
  getDisplayNames,
  getNumberFormat,
  getPluralRules,
  getRelativeTimeFormat,
} from "./intl-cache";
import type { I18nAdapter } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Simple messages format
 */
export type SimpleMessages = Record<string, string | PluralMessages>;

/**
 * Plural messages (using Intl.PluralRules categories)
 */
export type PluralMessages = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

/**
 * Options for createSimpleI18n
 */
export interface SimpleI18nOptions {
  /** Initial locale */
  locale: string;

  /** Available locales */
  locales: string[];

  /** Messages per locale */
  messages: Record<string, SimpleMessages>;

  /** Fallback locale (defaults to first in locales) */
  fallbackLocale?: string;

  /** Callback when locale changes */
  onLocaleChange?: (locale: string) => void;
}

// ============================================================================
// RTL Detection
// ============================================================================

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi"]);

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a simple i18n adapter
 *
 * @example
 * ```ts
 * const i18n = createSimpleI18n({
 *   locale: "en",
 *   locales: ["en", "de"],
 *   messages: {
 *     en: {
 *       "common.save": "Save",
 *       "items.count": { one: "{{count}} item", other: "{{count}} items" }
 *     },
 *     de: {
 *       "common.save": "Speichern",
 *       "items.count": { one: "{{count}} Artikel", other: "{{count}} Artikel" }
 *     }
 *   }
 * });
 * ```
 */
export function createSimpleI18n(options: SimpleI18nOptions): I18nAdapter {
  let currentLocale = options.locale;
  const {
    locales,
    messages,
    fallbackLocale = locales[0],
    onLocaleChange: onLocaleChangeCallback,
  } = options;

  // Event listeners for locale changes
  const listeners = new Set<(locale: string) => void>();

  /**
   * Notify all listeners about locale change
   */
  function notifyListeners(locale: string): void {
    // Call the initial callback if provided
    onLocaleChangeCallback?.(locale);
    // Notify all subscribed listeners
    for (const listener of listeners) {
      listener(locale);
    }
  }

  /**
   * Get message for key in locale
   */
  function getMessage(
    key: string,
    locale: string,
  ): string | PluralMessages | undefined {
    return messages[locale]?.[key];
  }

  /**
   * Interpolate values into string
   */
  function interpolate(str: string, params?: Record<string, unknown>): string {
    if (!params) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = params[key];
      return value !== undefined ? String(value) : `{{${key}}}`;
    });
  }

  /**
   * Check if value is plural messages
   */
  function isPluralMessages(value: unknown): value is PluralMessages {
    return (
      typeof value === "object" &&
      value !== null &&
      "one" in value &&
      "other" in value
    );
  }

  /**
   * Get plural form
   */
  function getPluralForm(
    forms: PluralMessages,
    count: number,
    locale: string,
  ): string {
    const rules = getPluralRules(locale);
    const category = rules.select(count);

    switch (category) {
      case "zero":
        return forms.zero ?? forms.other;
      case "one":
        return forms.one;
      case "two":
        return forms.two ?? forms.other;
      case "few":
        return forms.few ?? forms.other;
      case "many":
        return forms.many ?? forms.other;
      default:
        return forms.other;
    }
  }

  return {
    get locale() {
      return currentLocale;
    },

    get locales() {
      return locales;
    },

    t(key: string, params?: Record<string, unknown>): string {
      // Try current locale
      let value = getMessage(key, currentLocale);

      // Fallback to fallback locale
      if (value === undefined && currentLocale !== fallbackLocale) {
        value = getMessage(key, fallbackLocale);
      }

      // Return key if not found
      if (value === undefined) {
        return key;
      }

      // Handle plural forms
      if (isPluralMessages(value)) {
        const count = typeof params?.count === "number" ? params.count : 1;
        const form = getPluralForm(value, count, currentLocale);
        return interpolate(form, params);
      }

      // Regular string
      return interpolate(value, params);
    },

    setLocale(locale: string): void {
      if (locales.includes(locale) && locale !== currentLocale) {
        currentLocale = locale;
        notifyListeners(locale);
      }
    },

    onLocaleChange(callback: (locale: string) => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    formatDate(date: Date | number, opts?: Intl.DateTimeFormatOptions): string {
      const d = typeof date === "number" ? new Date(date) : date;
      return getDateTimeFormat(currentLocale, opts).format(d);
    },

    formatNumber(value: number, opts?: Intl.NumberFormatOptions): string {
      return getNumberFormat(currentLocale, opts).format(value);
    },

    formatRelative(date: Date | number): string {
      const d = typeof date === "number" ? new Date(date) : date;
      const now = Date.now();
      const diff = d.getTime() - now;
      const diffSeconds = Math.round(diff / 1000);
      const diffMinutes = Math.round(diff / 60000);
      const diffHours = Math.round(diff / 3600000);
      const diffDays = Math.round(diff / 86400000);

      const rtf = getRelativeTimeFormat(currentLocale, {
        numeric: "auto",
      });

      if (Math.abs(diffSeconds) < 60) {
        return rtf.format(diffSeconds, "second");
      }
      if (Math.abs(diffMinutes) < 60) {
        return rtf.format(diffMinutes, "minute");
      }
      if (Math.abs(diffHours) < 24) {
        return rtf.format(diffHours, "hour");
      }
      return rtf.format(diffDays, "day");
    },

    getLocaleName(locale: string): string {
      try {
        return (
          getDisplayNames(currentLocale, { type: "language" }).of(locale) ??
          locale
        );
      } catch {
        return locale;
      }
    },

    isRTL(): boolean {
      return RTL_LOCALES.has(currentLocale);
    },
  };
}
