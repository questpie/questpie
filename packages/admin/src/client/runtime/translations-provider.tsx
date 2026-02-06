/**
 * Translations Provider
 *
 * Fetches admin UI translations from the server and provides i18n context.
 * This enables single source of truth for all translations on the server.
 *
 * @example
 * ```tsx
 * // In AdminProvider
 * <TranslationsProvider initialLocale="en">
 *   {children}
 * </TranslationsProvider>
 * ```
 */

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { DEFAULT_LOCALE } from "questpie/shared";
import {
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";
import { I18nProvider } from "../i18n/hooks";
import { createSimpleI18n, type SimpleMessages } from "../i18n/simple";
import { selectClient, useAdminStore } from "./provider";

// ============================================================================
// Constants
// ============================================================================

/** Cookie for UI locale (admin interface language) */
const UI_LOCALE_COOKIE = "questpie_ui_locale";
/** Cookie max age (1 year) */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// ============================================================================
// Cookie Helpers
// ============================================================================

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

function setCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: this string is ok
  document.cookie = `${name}=${value}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function getUiLocaleFromCookie(): string | null {
  return getCookie(UI_LOCALE_COOKIE);
}

export function setUiLocaleCookie(locale: string): void {
  setCookie(UI_LOCALE_COOKIE, locale);
}

// ============================================================================
// Types
// ============================================================================

export interface TranslationsProviderProps {
  /** Initial UI locale */
  initialLocale?: string;
  /** Children to render */
  children: ReactNode;
  /** Fallback while loading translations */
  fallback?: ReactNode;
}

// ============================================================================
// Query Options
// ============================================================================

/**
 * Query options for fetching admin UI translations.
 * Can be used with TanStack Query's prefetching in loaders.
 *
 * @example
 * ```ts
 * // In TanStack Start loader
 * export const Route = createFileRoute("/admin")({
 *   loader: async ({ context }) => {
 *     await context.queryClient.ensureQueryData(
 *       getAdminTranslationsQueryOptions(context.client, "en")
 *     );
 *   },
 * });
 * ```
 */
export function getAdminTranslationsQueryOptions(client: any, locale: string) {
  return {
    queryKey: ["cms", "adminTranslations", locale] as const,
    queryFn: async () => {
      try {
        const result = await client.rpc.getAdminTranslations({ locale });
        return result as {
          locale: string;
          messages: SimpleMessages;
          fallbackLocale: string;
        };
      } catch {
        // Fallback if function doesn't exist (older server)
        return {
          locale: DEFAULT_LOCALE,
          messages: {} as SimpleMessages,
          fallbackLocale: DEFAULT_LOCALE,
        };
      }
    },
    staleTime: Number.POSITIVE_INFINITY, // Cache forever
    gcTime: Number.POSITIVE_INFINITY,
  };
}

/**
 * Query options for fetching available admin UI locales.
 *
 * @example
 * ```ts
 * // In TanStack Start loader
 * export const Route = createFileRoute("/admin")({
 *   loader: async ({ context }) => {
 *     await context.queryClient.ensureQueryData(
 *       getAdminLocalesQueryOptions(context.client)
 *     );
 *   },
 * });
 * ```
 */
export function getAdminLocalesQueryOptions(client: any) {
  return {
    queryKey: ["cms", "adminLocales"] as const,
    queryFn: async () => {
      try {
        const result = await client.rpc.getAdminLocales({});
        return result as {
          locales: string[];
          defaultLocale: string;
        };
      } catch {
        // Fallback if function doesn't exist
        return {
          locales: [DEFAULT_LOCALE],
          defaultLocale: DEFAULT_LOCALE,
        };
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  };
}

// ============================================================================
// Inner Provider (with Suspense)
// ============================================================================

interface TranslationsInnerProps {
  initialLocale: string;
  children: ReactNode;
}

function TranslationsInner({
  initialLocale,
  children,
}: TranslationsInnerProps): ReactElement {
  const client = useAdminStore(selectClient);
  const [locale, setLocaleState] = useState(initialLocale);

  // Fetch available locales
  const { data: localesData } = useSuspenseQuery(
    getAdminLocalesQueryOptions(client),
  );

  // Fetch translations for current locale
  const { data: translationsData } = useSuspenseQuery(
    getAdminTranslationsQueryOptions(client, locale),
  );

  // Handle locale change
  const setLocale = useCallback((newLocale: string) => {
    setLocaleState(newLocale);
    setUiLocaleCookie(newLocale);
  }, []);

  // Create i18n adapter
  const i18nAdapter = useMemo(() => {
    return createSimpleI18n({
      locale: translationsData.locale,
      locales: localesData.locales,
      messages: { [translationsData.locale]: translationsData.messages },
      fallbackLocale: translationsData.fallbackLocale,
      onLocaleChange: setLocale,
    });
  }, [translationsData, localesData.locales, setLocale]);

  return <I18nProvider adapter={i18nAdapter}>{children}</I18nProvider>;
}

// ============================================================================
// Loading Fallback
// ============================================================================

function LoadingFallback(): ReactElement {
  return (
    <div className="qp-flex qp-h-screen qp-w-screen qp-items-center qp-justify-center qp-bg-background">
      <div className="qp-flex qp-flex-col qp-items-center qp-gap-4">
        <div className="qp-h-8 qp-w-8 qp-animate-spin qp-rounded-full qp-border-4 qp-border-primary qp-border-t-transparent" />
        <span className="qp-text-sm qp-text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Translations Provider
 *
 * Fetches admin UI translations from the server and provides i18n context.
 * Uses Suspense for loading state.
 *
 * @example
 * ```tsx
 * <AdminStoreContext.Provider value={store}>
 *   <TranslationsProvider initialLocale="en">
 *     <ContentLocalesProvider>
 *       {children}
 *     </ContentLocalesProvider>
 *   </TranslationsProvider>
 * </AdminStoreContext.Provider>
 * ```
 */
export function TranslationsProvider({
  initialLocale,
  children,
  fallback,
}: TranslationsProviderProps): ReactElement {
  const resolvedLocale =
    initialLocale ?? getUiLocaleFromCookie() ?? DEFAULT_LOCALE;

  return (
    <Suspense fallback={fallback ?? <LoadingFallback />}>
      <TranslationsInner initialLocale={resolvedLocale}>
        {children}
      </TranslationsInner>
    </Suspense>
  );
}
