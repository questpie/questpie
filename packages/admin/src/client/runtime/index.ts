/**
 * Admin Runtime
 *
 * React integration for the admin UI using Zustand store from props pattern.
 */

// Re-export useShallow for convenience when selecting multiple values
export { useShallow } from "zustand/shallow";
// Content Locales Provider
export { useSafeContentLocales } from "./content-locales-provider";
// Locale Scope (for nested forms)
export { LocaleScopeProvider, useScopedLocale } from "./locale-scope";
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
} from "./provider";
// Routes
// Server-Side Translations
