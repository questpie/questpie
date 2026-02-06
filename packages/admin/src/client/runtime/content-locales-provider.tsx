/**
 * Content Locales Provider
 *
 * Fetches and provides content locales from the backend CMS configuration.
 * Content locales are different from UI locales - they define which languages
 * are available for content translation.
 */

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LOCALE } from "questpie/shared";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import { selectClient, useAdminStore } from "./provider";

// ============================================================================
// Types
// ============================================================================

export interface ContentLocale {
  /** Locale code (e.g. "en", "sk", "en-US") */
  code: string;
  /** Human-readable label (e.g. "English", "Slovenčina") */
  label?: string;
  /** Is this the fallback locale? */
  fallback?: boolean;
  /** Custom country code for flag display (e.g. "us" for "en") */
  flagCountryCode?: string;
}

export interface ContentLocalesData {
  /** Available content locales */
  locales: ContentLocale[];
  /** Default locale code */
  defaultLocale: string;
  /** Fallback locale mappings (e.g. { "en-GB": "en" }) */
  fallbacks?: Record<string, string>;
}

export interface ContentLocalesContextValue extends ContentLocalesData {
  /** Check if localization is enabled (more than one locale) */
  isLocalized: boolean;
  /** Get the human-readable label for a locale code */
  getLocaleLabel: (code: string) => string;
  /** Check if a locale code is valid */
  isValidLocale: (code: string) => boolean;
  /** Get fallback locale for a given locale */
  getFallbackLocale: (code: string) => string;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

// ============================================================================
// Context
// ============================================================================

const ContentLocalesContext = createContext<ContentLocalesContextValue | null>(
  null,
);

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_LOCALES: ContentLocalesData = {
  locales: [{ code: DEFAULT_LOCALE, label: "English", fallback: true }],
  defaultLocale: DEFAULT_LOCALE,
};

// ============================================================================
// Provider Component
// ============================================================================

export interface ContentLocalesProviderProps {
  children: ReactNode;
}

/**
 * Content Locales Provider
 *
 * Fetches content locales from the backend and provides them to the UI.
 * Must be used inside AdminProvider to access the client.
 *
 * @example
 * ```tsx
 * <AdminProvider admin={admin} client={client}>
 *   <ContentLocalesProvider>
 *     <App />
 *   </ContentLocalesProvider>
 * </AdminProvider>
 * ```
 */
export function ContentLocalesProvider({
  children,
}: ContentLocalesProviderProps): ReactElement {
  const client = useAdminStore(selectClient);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cms", "contentLocales"],
    queryFn: async () => {
      try {
        // Use type assertion since the client type may not include getContentLocales
        // depending on which modules are used
        const result = await (client as any).rpc.getContentLocales({});
        return result as ContentLocalesData;
      } catch {
        // If the function doesn't exist, return default locales
        return DEFAULT_LOCALES;
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  const localesData = data ?? DEFAULT_LOCALES;

  const value: ContentLocalesContextValue = {
    ...localesData,
    isLocalized: localesData.locales.length > 1,
    isLoading,
    error: error as Error | null,

    getLocaleLabel: (code: string): string => {
      const locale = localesData.locales.find((l) => l.code === code);
      return locale?.label ?? code.toUpperCase();
    },

    isValidLocale: (code: string): boolean => {
      return localesData.locales.some((l) => l.code === code);
    },

    getFallbackLocale: (code: string): string => {
      // Check explicit fallbacks first
      if (localesData.fallbacks?.[code]) {
        return localesData.fallbacks[code];
      }
      // Return default locale
      return localesData.defaultLocale;
    },
  };

  return (
    <ContentLocalesContext.Provider value={value}>
      {children}
    </ContentLocalesContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get content locales from context.
 *
 * Must be used inside ContentLocalesProvider.
 * Returns locale data, helper functions, and loading state.
 *
 * @example
 * ```tsx
 * function LocaleSwitcher() {
 *   const {
 *     locales,
 *     defaultLocale,
 *     isLocalized,
 *     getLocaleLabel,
 *   } = useContentLocales();
 *
 *   if (!isLocalized) return null;
 *
 *   return (
 *     <select>
 *       {locales.map(l => (
 *         <option key={l.code} value={l.code}>
 *           {getLocaleLabel(l.code)}
 *         </option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
export function useContentLocales(): ContentLocalesContextValue {
  const context = useContext(ContentLocalesContext);
  if (!context) {
    throw new Error(
      "useContentLocales must be used within ContentLocalesProvider. " +
        "Wrap your app with <ContentLocalesProvider> inside <AdminProvider>.",
    );
  }
  return context;
}

/**
 * Safely get content locales from context.
 * Returns null if not inside provider (useful for optional features).
 */
export function useSafeContentLocales(): ContentLocalesContextValue | null {
  return useContext(ContentLocalesContext);
}
