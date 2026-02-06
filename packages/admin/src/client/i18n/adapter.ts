/**
 * I18n Adapter Helpers
 *
 * Utilities for creating adapters from external i18n libraries.
 */

import {
  getDateTimeFormat,
  getDisplayNames,
  getNumberFormat,
} from "./intl-cache";
import type { I18nAdapter } from "./types";

// ============================================================================
// RTL Locales
// ============================================================================

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi"]);

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * Options for creating an adapter from external library
 */
export interface CreateAdapterOptions {
  /** Get current locale */
  getLocale: () => string;

  /** Get available locales */
  getLocales: () => string[];

  /** Translate function */
  translate: (key: string, params?: Record<string, unknown>) => string;

  /** Set locale */
  setLocale: (locale: string) => void | Promise<void>;

  /** Subscribe to locale changes - required for reactivity */
  onLocaleChange: (callback: (locale: string) => void) => () => void;

  /** Optional: custom date formatter */
  formatDate?: I18nAdapter["formatDate"];

  /** Optional: custom number formatter */
  formatNumber?: I18nAdapter["formatNumber"];

  /** Optional: custom relative time formatter */
  formatRelative?: I18nAdapter["formatRelative"];

  /** Optional: custom locale name getter */
  getLocaleName?: (locale: string) => string;

  /** Optional: custom RTL check */
  isRTL?: () => boolean;
}

/**
 * Create an I18nAdapter from external library functions
 *
 * @example
 * ```ts
 * // With i18next
 * const adapter = createAdapter({
 *   getLocale: () => i18next.language,
 *   getLocales: () => i18next.languages,
 *   translate: (key, params) => i18next.t(key, params),
 *   setLocale: (locale) => i18next.changeLanguage(locale),
 * });
 * ```
 */
export function createAdapter(options: CreateAdapterOptions): I18nAdapter {
  const {
    getLocale,
    getLocales,
    translate,
    setLocale,
    onLocaleChange,
    formatDate: customFormatDate,
    formatNumber: customFormatNumber,
    formatRelative: customFormatRelative,
    getLocaleName: customGetLocaleName,
    isRTL: customIsRTL,
  } = options;

  return {
    get locale() {
      return getLocale();
    },

    get locales() {
      return getLocales();
    },

    t: translate,
    setLocale,
    onLocaleChange,

    formatDate:
      customFormatDate ??
      ((date, opts) => {
        const d = typeof date === "number" ? new Date(date) : date;
        return getDateTimeFormat(getLocale(), opts).format(d);
      }),

    formatNumber:
      customFormatNumber ??
      ((value, opts) => {
        return getNumberFormat(getLocale(), opts).format(value);
      }),

    formatRelative: customFormatRelative,

    getLocaleName:
      customGetLocaleName ??
      ((locale) => {
        try {
          return (
            getDisplayNames(getLocale(), { type: "language" }).of(locale) ??
            locale
          );
        } catch {
          return locale;
        }
      }),

    isRTL: customIsRTL ?? (() => RTL_LOCALES.has(getLocale())),
  };
}

// ============================================================================
// i18next Adapter
// ============================================================================

/**
 * i18next instance type (minimal interface)
 */
interface I18nextInstance {
  language: string;
  languages: readonly string[];
  t: (key: string, options?: Record<string, unknown>) => string;
  changeLanguage: (locale: string) => Promise<unknown>;
  on?: (event: string, callback: (locale: string) => void) => void;
  off?: (event: string, callback: (locale: string) => void) => void;
}

/**
 * Create adapter from i18next instance
 *
 * @example
 * ```ts
 * import i18next from "i18next";
 * import { createI18nextAdapter } from "@questpie/admin/i18n";
 *
 * const adapter = createI18nextAdapter(i18next);
 * ```
 */
export function createI18nextAdapter(i18next: I18nextInstance): I18nAdapter {
  return createAdapter({
    getLocale: () => i18next.language,
    getLocales: () => [...i18next.languages],
    translate: (key, params) => i18next.t(key, params),
    setLocale: (locale) => i18next.changeLanguage(locale).then(() => {}),
    onLocaleChange: (callback) => {
      i18next.on?.("languageChanged", callback);
      return () => {
        i18next.off?.("languageChanged", callback);
      };
    },
  });
}

// ============================================================================
// react-intl Adapter
// ============================================================================

/**
 * react-intl IntlShape (minimal interface)
 */
interface IntlShape {
  locale: string;
  formatMessage: (
    descriptor: { id: string },
    values?: Record<string, unknown>,
  ) => string;
  formatDate: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime?: (value: number, unit: string) => string;
}

/**
 * Create adapter from react-intl's useIntl() result
 *
 * @example
 * ```tsx
 * import { useIntl } from "react-intl";
 * import { createReactIntlAdapter } from "@questpie/admin/i18n";
 *
 * function App() {
 *   const intl = useIntl();
 *   const adapter = createReactIntlAdapter(intl, ["en", "de", "sk"], setLocale, onLocaleChange);
 *   // ...
 * }
 * ```
 */
export function createReactIntlAdapter(
  intl: IntlShape,
  locales: string[],
  setLocale: (locale: string) => void | Promise<void>,
  onLocaleChange: (callback: (locale: string) => void) => () => void,
): I18nAdapter {
  return createAdapter({
    getLocale: () => intl.locale,
    getLocales: () => locales,
    translate: (key, params) => intl.formatMessage({ id: key }, params),
    setLocale,
    onLocaleChange,
    formatDate: intl.formatDate,
    formatNumber: intl.formatNumber,
  });
}
