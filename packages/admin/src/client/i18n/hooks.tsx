/**
 * I18n React Hooks
 *
 * React context and hooks for i18n in the admin UI.
 */

import { DEFAULT_LOCALE } from "questpie/shared";
import * as React from "react";
import { createContext, useCallback, useContext } from "react";
import type {
  I18nAdapter,
  I18nContext as I18nContextType,
  I18nProviderProps,
  I18nText,
  UseTranslationResult,
} from "./types";

// ============================================================================
// Context
// ============================================================================

const I18nContext = createContext<I18nAdapter | null>(null);

// ============================================================================
// Provider
// ============================================================================

/**
 * I18n Provider Component
 *
 * Provides i18n to all child components.
 * The adapter is the source of truth for UI locale.
 *
 * @example
 * ```tsx
 * import { I18nProvider, createSimpleI18n } from "@questpie/admin/i18n";
 *
 * const i18n = createSimpleI18n({ ... });
 *
 * <I18nProvider adapter={i18n}>
 *   <App />
 * </I18nProvider>
 * ```
 */
export function I18nProvider({
  adapter,
  children,
}: I18nProviderProps): React.ReactElement {
  // Force re-render when locale changes in adapter
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Subscribe to locale changes from adapter
  React.useEffect(() => {
    return adapter.onLocaleChange(() => {
      forceUpdate();
    });
  }, [adapter]);

  // Context value - adapter is source of truth
  // useMemo depends on adapter.locale to create new reference when locale changes
  const contextValue = React.useMemo<I18nAdapter>(
    () => ({
      locale: adapter.locale,
      locales: adapter.locales,
      t: adapter.t.bind(adapter),
      setLocale: adapter.setLocale.bind(adapter),
      onLocaleChange: adapter.onLocaleChange.bind(adapter),
      formatDate: adapter.formatDate.bind(adapter),
      formatNumber: adapter.formatNumber.bind(adapter),
      formatRelative: adapter.formatRelative?.bind(adapter),
      getLocaleName: adapter.getLocaleName.bind(adapter),
      isRTL: adapter.isRTL.bind(adapter),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, adapter.locale],
  );

  return (
    <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the i18n adapter (throws if not in provider)
 */
export function useI18n(): I18nAdapter {
  const adapter = useContext(I18nContext);
  if (!adapter) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return adapter;
}

/**
 * Get i18n adapter or null (safe version)
 */
export function useSafeI18n(): I18nAdapter | null {
  return useContext(I18nContext);
}

/**
 * Main translation hook
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t, locale, formatDate } = useTranslation();
 *   return <h1>{t("dashboard.title")}</h1>;
 * }
 * ```
 */
export function useTranslation(): UseTranslationResult {
  const adapter = useI18n();

  return {
    locale: adapter.locale,
    locales: adapter.locales,
    t: adapter.t,
    setLocale: adapter.setLocale,
    formatDate: adapter.formatDate,
    formatNumber: adapter.formatNumber,
    getLocaleName: adapter.getLocaleName,
    isRTL: adapter.isRTL(),
  };
}

/**
 * Get just the translate function
 */
export function useT(): I18nAdapter["t"] {
  return useI18n().t;
}

/**
 * Get current locale
 */
export function useLocale(): string {
  return useI18n().locale;
}

/**
 * Get locale setter
 */
export function useSetLocale(): I18nAdapter["setLocale"] {
  return useI18n().setLocale;
}

// ============================================================================
// I18nText Resolver
// ============================================================================

/**
 * Check if an object is a locale map (has locale codes as keys)
 */
function isLocaleMap(obj: object): obj is Record<string, string> {
  // If it has a "key" property, it's a translation key lookup
  if ("key" in obj) return false;
  // Check if all values are strings (locale map)
  return Object.values(obj).every((v) => typeof v === "string");
}

/**
 * Resolve locale map to string for given locale
 */
function resolveLocaleMap(
  map: Record<string, string>,
  locale: string,
  fallback: string,
): string {
  // Try exact locale match
  if (map[locale]) return map[locale];
  // Try language code only (e.g., "en" from "en-US")
  const lang = locale.split("-")[0];
  if (lang && map[lang]) return map[lang];
  // Try default locale as fallback
  if (map[DEFAULT_LOCALE]) return map[DEFAULT_LOCALE];
  // Return first available value
  const firstValue = Object.values(map)[0];
  return firstValue ?? fallback;
}

/**
 * Resolve I18nText to string
 *
 * @example
 * ```tsx
 * function Label({ text }: { text: I18nText }) {
 *   const resolve = useResolveText();
 *   return <span>{resolve(text)}</span>;
 * }
 * ```
 */
export function useResolveText(): (
  text: I18nText | ((values: Record<string, any>) => I18nText) | undefined,
  fallback?: string,
  contextValues?: Record<string, any>,
) => string {
  const adapter = useSafeI18n();

  return useCallback(
    (
      text: I18nText | ((values: Record<string, any>) => I18nText) | undefined,
      fallback = "",
      contextValues?: Record<string, any>,
    ): string => {
      const resolveValue = (value: I18nText | undefined): string => {
        if (value === undefined || value === null) return fallback;

        // Plain string
        if (typeof value === "string") return value;

        // Function
        if (typeof value === "function") {
          if (!adapter && !contextValues) return fallback;
          const i18nCtx = adapter
            ? {
                locale: adapter.locale,
                t: adapter.t,
                formatDate: adapter.formatDate,
                formatNumber: adapter.formatNumber,
              }
            : undefined;
          const ctx = {
            ...(contextValues ?? {}),
            ...(i18nCtx ?? {}),
          } as I18nContextType & Record<string, any>;
          try {
            const result = value(ctx);
            return resolveValue(result as I18nText);
          } catch (error) {
            console.error("Failed to resolve dynamic text:", error);
            return fallback;
          }
        }

        // Object with key (translation key lookup)
        if (
          typeof value === "object" &&
          "key" in value &&
          typeof value.key === "string"
        ) {
          const keyObj = value as {
            key: string;
            fallback?: string;
            params?: Record<string, unknown>;
          };
          if (!adapter) return keyObj.fallback ?? fallback;
          const result = adapter.t(keyObj.key, keyObj.params);
          // If t() returns the key (not found), use fallback
          return result === keyObj.key ? (keyObj.fallback ?? result) : result;
        }

        // Locale map (inline translations)
        if (typeof value === "object" && isLocaleMap(value)) {
          const locale = adapter?.locale ?? DEFAULT_LOCALE;
          return resolveLocaleMap(value, locale, fallback);
        }

        return fallback;
      };

      return resolveValue(text as I18nText | undefined);
    },
    [adapter],
  );
}

/**
 * Resolve I18nText synchronously (without adapter)
 * Only works with string and object types, not functions
 *
 * @param locale - Optional locale to use for locale maps (defaults to "en")
 */
export function resolveTextSync(
  text: I18nText | undefined,
  fallback = "",
  locale = DEFAULT_LOCALE,
): string {
  if (text === undefined || text === null) return fallback;
  if (typeof text === "string") return text;
  if (typeof text === "function") return fallback;
  if (typeof text === "object" && "key" in text) {
    return text.fallback ?? fallback;
  }
  // Locale map (inline translations)
  if (typeof text === "object" && isLocaleMap(text)) {
    return resolveLocaleMap(text, locale, fallback);
  }
  return fallback;
}

// ============================================================================
// Text Component
// ============================================================================

/**
 * Text component that resolves I18nText to a string
 *
 * Use this when you need to render I18nText in JSX.
 *
 * @example
 * ```tsx
 * <Text text={{ en: "Hello", sk: "Ahoj" }} />
 * <Text text="Static text" />
 * <Text text={{ key: "common.save" }} />
 * ```
 */
export function Text({
  text,
  fallback = "",
  as: Component = "span",
  className,
}: {
  text: I18nText | undefined;
  fallback?: string;
  as?: React.ElementType;
  className?: string;
}): React.ReactElement | null {
  const resolve = useResolveText();
  const resolved = resolve(text, fallback);
  if (!resolved) return null;
  return <Component className={className}>{resolved}</Component>;
}
