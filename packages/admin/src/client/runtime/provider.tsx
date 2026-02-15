/**
 * Admin Provider
 *
 * React context provider for the admin UI using Zustand store from props pattern.
 * This enables optimized re-renders through selectors.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { QuestpieClient } from "questpie/client";
import { DEFAULT_LOCALE } from "questpie/shared";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { createStore, useStore } from "zustand";
import type { adminModule } from "#questpie/admin/server/index.js";
import { Admin, type AdminInput } from "../builder/admin";
import { I18nProvider } from "../i18n/hooks";
import { adminMessages } from "../i18n/messages";
import { createSimpleI18n, type SimpleMessages } from "../i18n/simple";
import type { I18nAdapter } from "../i18n/types";
import { ContentLocalesProvider } from "./content-locales-provider";
import { buildNavigation, type NavigationGroup } from "./routes";
import {
  getUiLocaleFromCookie as getServerUiLocaleFromCookie,
  TranslationsProvider,
} from "./translations-provider";

// ============================================================================
// Constants
// ============================================================================

/** Cookie for UI locale (admin interface language) */
const UI_LOCALE_COOKIE = "questpie_ui_locale";
/** Cookie for content locale (CMS content language) */
const CONTENT_LOCALE_COOKIE = "questpie_content_locale";
/** Cookie max age (1 year) */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Legacy cookie name for backwards compatibility
const LEGACY_LOCALE_COOKIE = "questpie_locale";

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

function getUiLocaleFromCookie(): string | null {
  // Try new cookie first, fall back to legacy
  return getCookie(UI_LOCALE_COOKIE) ?? getCookie(LEGACY_LOCALE_COOKIE);
}

function getContentLocaleFromCookie(): string | null {
  // Try new cookie first, fall back to legacy
  return getCookie(CONTENT_LOCALE_COOKIE) ?? getCookie(LEGACY_LOCALE_COOKIE);
}

function setUiLocaleCookie(locale: string): void {
  setCookie(UI_LOCALE_COOKIE, locale);
}

function setContentLocaleCookie(locale: string): void {
  setCookie(CONTENT_LOCALE_COOKIE, locale);
}

// ============================================================================
// Store Types
// ============================================================================

export interface AdminState {
  // Core values (from props)
  admin: Admin;
  client: QuestpieClient<(typeof adminModule)["$inferCms"]>;
  authClient: any | null;
  basePath: string;
  navigate: (path: string) => void;
  realtime: {
    enabled: boolean;
  };

  // Content locale state (CMS content language)
  // Note: UI locale is managed by I18n adapter, not the store
  contentLocale: string;
  setContentLocale: (locale: string) => void;

  // Derived/cached values
  navigation: NavigationGroup[];
  brandName: string;
}

export type AdminStore = ReturnType<typeof createAdminStore>;

// ============================================================================
// Store Factory
// ============================================================================

interface CreateAdminStoreProps {
  admin: Admin;
  client: QuestpieClient<any>;
  authClient: any | null;
  basePath: string;
  navigate: (path: string) => void;
  realtime: {
    enabled: boolean;
  };
  initialContentLocale: string;
}

function createAdminStore({
  admin,
  client,
  authClient,
  basePath,
  navigate,
  realtime,
  initialContentLocale,
}: CreateAdminStoreProps) {
  if (client && initialContentLocale && "setLocale" in client) {
    (client as any).setLocale(initialContentLocale);
  }

  return createStore<AdminState>((set) => ({
    // Core values
    admin,
    client,
    authClient,
    basePath,
    navigate,
    realtime,

    // Content Locale (CMS content language)
    // Note: UI locale is managed by I18n adapter, not the store
    contentLocale: initialContentLocale,
    setContentLocale: (newLocale: string) => {
      setContentLocaleCookie(newLocale);
      set({ contentLocale: newLocale });
    },

    // Derived values (computed once, updated when needed)
    navigation: buildNavigation(admin, { basePath }),
    brandName: "Admin",
  }));
}

// ============================================================================
// Context
// ============================================================================

const AdminStoreContext = createContext<AdminStore | null>(null);

// ============================================================================
// Provider Props
// ============================================================================

export interface AdminProviderProps {
  /**
   * Admin configuration - pass your AdminBuilder directly.
   * Can also accept an Admin instance for backward compatibility.
   */
  admin: AdminInput<any>;

  /**
   * The API client for data fetching
   */
  client: QuestpieClient<any>;

  /**
   * The auth client for authentication (created via createAdminAuthClient)
   */
  authClient?: any;

  /**
   * Base path for admin routes (default: "/admin")
   */
  basePath?: string;

  /**
   * Realtime settings for auto-refreshing collection/global queries via SSE.
   *
   * - `true`: enable (default)
   * - `false`: disabled
   * - `undefined`: enabled by default
   * - object: configure enabled flag
   *
   * The SSE connection config (base URL, credentials) is handled by the client's
   * built-in `realtime` API — see `createClient()` from `questpie/client`.
   */
  realtime?:
    | boolean
    | {
        enabled?: boolean;
      };

  /**
   * Navigate function for routing
   */
  navigate?: (path: string) => void;

  /**
   * Initial UI locale (admin interface language)
   * If not provided, reads from cookie or uses default from admin config
   */
  initialUiLocale?: string;

  /**
   * Initial content locale (CMS content language)
   * If not provided, reads from cookie or uses default from admin config
   */
  initialContentLocale?: string;

  /**
   * Optional query client (if not provided, uses the nearest QueryClientProvider)
   */
  queryClient?: QueryClient;

  /**
   * Optional custom i18n adapter
   * If not provided, uses the built-in simple i18n with admin messages
   * @deprecated Use useServerTranslations instead
   */
  i18nAdapter?: I18nAdapter;

  /**
   * Use server-side translations (fetched via getAdminTranslations RPC).
   * When true, translations are fetched from the server configured via
   * .adminLocale() and .messages() on QuestpieBuilder.
   *
   * @default false (for backwards compatibility)
   *
   * @example
   * ```tsx
   * // Server configures locales and messages
   * const cms = q()
   *   .use(adminModule)
   *   .adminLocale({ locales: ["en", "sk"], defaultLocale: "en" })
   *   .messages({ sk: { "common.save": "Ulozit" } })
   *   .build();
   *
   * // Client fetches from server
   * <AdminProvider admin={admin} client={client} useServerTranslations>
   *   {children}
   * </AdminProvider>
   * ```
   */
  useServerTranslations?: boolean;

  /**
   * Fallback element to show while loading server translations.
   * Only used when useServerTranslations is true.
   */
  translationsFallback?: ReactNode;

  /**
   * Children to render
   */
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Merge admin messages with custom translations
 */
function mergeMessages(
  baseMessages: SimpleMessages,
  customTranslations: Record<string, SimpleMessages> | undefined,
): Record<string, SimpleMessages> {
  // Start with base English messages
  const result: Record<string, SimpleMessages> = {
    en: { ...baseMessages },
  };

  if (!customTranslations) return result;

  // Merge custom translations
  for (const [locale, messages] of Object.entries(customTranslations)) {
    result[locale] = {
      ...(result[locale] ?? {}),
      ...messages,
    };
  }

  return result;
}

/**
 * Legacy I18n Provider (client-side translations)
 * Used when useServerTranslations is false
 */
interface LegacyI18nProviderProps {
  admin: Admin;
  locale: string;
  localeConfig: { default?: string; supported?: string[] };
  defaultLocale: string;
  customI18nAdapter?: I18nAdapter;
  children: ReactNode;
}

function LegacyI18nProvider({
  admin,
  locale,
  localeConfig,
  defaultLocale,
  customI18nAdapter,
  children,
}: LegacyI18nProviderProps): ReactElement {
  const i18nAdapterRef = useRef<I18nAdapter | null>(null);
  if (!i18nAdapterRef.current) {
    if (customI18nAdapter) {
      i18nAdapterRef.current = customI18nAdapter;
    } else {
      // Get translations from admin builder state
      const translations = admin.getTranslations() as
        | Record<string, SimpleMessages>
        | undefined;
      const messages = mergeMessages(adminMessages, translations);

      i18nAdapterRef.current = createSimpleI18n({
        locale,
        locales: localeConfig.supported ?? [DEFAULT_LOCALE],
        messages,
        fallbackLocale: defaultLocale,
        // Persist UI locale to cookie when it changes
        onLocaleChange: setUiLocaleCookie,
      });
    }
  }

  return (
    <I18nProvider adapter={i18nAdapterRef.current}>
      <ContentLocalesProvider>{children}</ContentLocalesProvider>
    </I18nProvider>
  );
}

/**
 * Admin provider component
 *
 * Creates a scoped Zustand store for admin state management.
 * Use `useAdminStore(selector)` to access state with optimized re-renders.
 *
 * @example
 * ```tsx
 * import { AdminProvider, useAdminStore } from "@questpie/admin/runtime";
 *
 * function App() {
 *   return (
 *     <AdminProvider admin={admin} client={client}>
 *       <MyComponent />
 *     </AdminProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   // Only re-renders when locale changes
 *   const locale = useAdminStore((s) => s.locale);
 *   const setLocale = useAdminStore((s) => s.setLocale);
 *   // ...
 * }
 * ```
 */
export function AdminProvider({
  admin: adminInput,
  client,
  authClient,
  basePath = "/admin",
  realtime,
  navigate: navigateProp,
  initialUiLocale,
  initialContentLocale,
  i18nAdapter: customI18nAdapter,
  useServerTranslations = false,
  translationsFallback,
  children,
}: AdminProviderProps): ReactElement {
  // Normalize admin input - accepts both AdminBuilder and Admin instance
  const admin = Admin.normalize(adminInput);

  // Default navigate function
  const navigate =
    navigateProp ??
    ((path: string) => {
      if (typeof window !== "undefined") {
        window.location.href = path;
      }
    });

  // Get initial locales
  const localeConfig = admin.getLocale();
  const defaultLocale = localeConfig.default ?? DEFAULT_LOCALE;

  // Resolve UI locale (admin interface language)
  // When using server translations, prefer the server cookie
  const resolvedUiLocale = useServerTranslations
    ? (initialUiLocale ?? getServerUiLocaleFromCookie() ?? defaultLocale)
    : (initialUiLocale ?? getUiLocaleFromCookie() ?? defaultLocale);

  // Resolve content locale (CMS content language)
  const resolvedContentLocale =
    initialContentLocale ?? getContentLocaleFromCookie() ?? defaultLocale;

  // Create store (once per provider instance)
  const storeRef = useRef<AdminStore | null>(null);

  const realtimeConfig = {
    enabled:
      typeof realtime === "boolean" ? realtime : (realtime?.enabled ?? true),
  };

  if (!storeRef.current) {
    storeRef.current = createAdminStore({
      admin,
      client,
      authClient: authClient ?? null,
      basePath,
      navigate,
      realtime: realtimeConfig,
      initialContentLocale: resolvedContentLocale,
    });
  }

  useEffect(() => {
    if (storeRef.current) {
      storeRef.current.setState({
        admin,
        navigation: buildNavigation(admin, { basePath }),
        realtime: realtimeConfig,
      });
    }
  }, [admin, basePath, realtimeConfig]);

  // Get content locale from store for reactive updates
  const contentLocale = useStore(storeRef.current, (s) => s.contentLocale);

  // Sync content locale changes to API client
  // This sets Accept-Language header for all API requests
  useEffect(() => {
    if (client && contentLocale && "setLocale" in client) {
      (client as any).setLocale(contentLocale);
    }
  }, [client, contentLocale]);

  // Render with appropriate i18n provider
  const i18nContent = useServerTranslations ? (
    <TranslationsProvider
      initialLocale={resolvedUiLocale}
      fallback={translationsFallback}
    >
      <ContentLocalesProvider>{children}</ContentLocalesProvider>
    </TranslationsProvider>
  ) : (
    <LegacyI18nProvider
      admin={admin}
      locale={resolvedUiLocale}
      localeConfig={localeConfig}
      defaultLocale={defaultLocale}
      customI18nAdapter={customI18nAdapter}
    >
      {children}
    </LegacyI18nProvider>
  );

  return (
    <AdminStoreContext.Provider value={storeRef.current}>
      <BrandingSync />
      {i18nContent}
    </AdminStoreContext.Provider>
  );
}

// ============================================================================
// Branding Sync (reads server config and updates store)
// ============================================================================

function BrandingSync() {
  const store = useContext(AdminStoreContext);
  useEffect(() => {
    if (!store) return;
    const client = store.getState().client;
    if (!client || !(client as any).rpc?.getAdminConfig) return;

    (client as any).rpc
      .getAdminConfig()
      .then((config: any) => {
        if (config?.branding?.name) {
          const name = config.branding.name;
          const resolved =
            typeof name === "string"
              ? name
              : typeof name === "object" && name !== null
                ? (name.en ?? Object.values(name)[0] ?? "Admin")
                : "Admin";
          store.setState({ brandName: resolved as string });
        }
      })
      .catch(() => {
        // Fail silently - keep default "Admin"
      });
  }, [store]);
  return null;
}

// ============================================================================
// Store Hooks
// ============================================================================

/**
 * Access admin store with a selector for optimized re-renders.
 *
 * @example
 * ```tsx
 * // Only re-renders when locale changes
 * const locale = useAdminStore((s) => s.locale);
 *
 * // Get multiple values (re-renders when any changes)
 * const { admin, client } = useAdminStore((s) => ({
 *   admin: s.admin,
 *   client: s.client,
 * }));
 *
 * // Get navigation (computed once)
 * const navigation = useAdminStore((s) => s.navigation);
 * ```
 */
export function useAdminStore<T>(selector: (state: AdminState) => T): T {
  const store = useContext(AdminStoreContext);
  if (!store) {
    throw new Error(
      "useAdminStore must be used within AdminProvider. " +
        "Wrap your app with <AdminProvider admin={admin} client={client}>",
    );
  }
  return useStore(store, selector);
}

/**
 * Check if currently inside AdminProvider.
 * Useful for components that can work both with and without context.
 *
 * @example
 * ```tsx
 * const hasProvider = useHasAdminProvider();
 * ```
 */
export function useHasAdminProvider(): boolean {
  const store = useContext(AdminStoreContext);
  return store !== null;
}

/**
 * Get the raw store from context (or null if outside provider).
 * For advanced use cases where you need conditional store access.
 */
export function useAdminStoreRaw(): AdminStore | null {
  return useContext(AdminStoreContext);
}

// ============================================================================
// Convenience Selectors
// ============================================================================

/** Select admin instance */
export const selectAdmin = (s: AdminState) => s.admin;

/** Select client instance */
export const selectClient = (s: AdminState) => s.client;

/** Select auth client instance */
export const selectAuthClient = (s: AdminState) => s.authClient;

/** Select base path */
export const selectBasePath = (s: AdminState) => s.basePath;

/** Select navigate function */
export const selectNavigate = (s: AdminState) => s.navigate;

/** Select realtime config */
export const selectRealtime = (s: AdminState) => s.realtime;

/** Select current content locale (CMS content language) */
export const selectContentLocale = (s: AdminState) => s.contentLocale;

/** Select setContentLocale function */
export const selectSetContentLocale = (s: AdminState) => s.setContentLocale;

/** Select navigation groups */
export const selectNavigation = (s: AdminState) => s.navigation;

/** Select brand name */
export const selectBrandName = (s: AdminState) => s.brandName;
