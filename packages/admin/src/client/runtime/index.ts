/**
 * Admin Runtime
 *
 * React integration for the admin UI using Zustand store from props pattern.
 */

// Re-export useShallow for convenience when selecting multiple values
export { useShallow } from "zustand/shallow";
// Content Locales Provider
export {
  type ContentLocale,
  type ContentLocalesContextValue,
  type ContentLocalesData,
  ContentLocalesProvider,
  type ContentLocalesProviderProps,
  useContentLocales,
  useSafeContentLocales,
} from "./content-locales-provider";
// Locale Scope (for nested forms)
export {
  LocaleScopeProvider,
  useIsLocaleScopeActive,
  useScopedLocale,
} from "./locale-scope";
// Provider & Store
export {
  AdminProvider,
  type AdminProviderProps,
  type AdminState,
  type AdminStore,
  // Convenience selectors
  selectAdmin,
  selectAuthClient,
  selectBasePath,
  selectBrandName,
  selectClient,
  selectContentLocale,
  selectNavigate,
  selectNavigation,
  selectRealtime,
  selectSetContentLocale,
  // Store hooks
  useAdminStore,
  useAdminStoreRaw,
  useHasAdminProvider,
} from "./provider";
// Routes
export {
  type AdminRoutes,
  type BuildRoutesOptions,
  buildNavigation,
  buildRoutes,
  type CollectionRoutes,
  type GlobalRoutes,
  type NavigationGroup,
  type NavigationItem,
  type PageRoutes,
} from "./routes";
// Server-Side Translations
export {
  getAdminLocalesQueryOptions,
  getAdminTranslationsQueryOptions,
  getUiLocaleFromCookie,
  setUiLocaleCookie,
  TranslationsProvider,
  type TranslationsProviderProps,
} from "./translations-provider";
