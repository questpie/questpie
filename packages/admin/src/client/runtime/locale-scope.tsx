/**
 * LocaleScope Context
 *
 * Provides scoped locale state for nested forms (e.g., ResourceSheet).
 * When a component is wrapped in LocaleScopeProvider, locale changes
 * affect only that scope, not the global content locale.
 *
 * @example
 * ```tsx
 * // In ResourceSheet - creates isolated locale scope
 * <LocaleScopeProvider>
 *   <FormView ... />
 * </LocaleScopeProvider>
 *
 * // In FieldWrapper - uses scoped locale if available
 * const { locale, setLocale } = useScopedLocale();
 * ```
 */

import * as React from "react";
import {
  selectContentLocale,
  selectSetContentLocale,
  useAdminStore,
} from "./index";

// ============================================================================
// Types
// ============================================================================

interface LocaleScopeContextValue {
  /** Current locale in this scope */
  locale: string;
  /** Set locale for this scope only */
  setLocale: (locale: string) => void;
  /** Whether we're in a scoped context (nested form) */
  isScoped: boolean;
}

// ============================================================================
// Context
// ============================================================================

const LocaleScopeContext = React.createContext<LocaleScopeContextValue | null>(
  null,
);

// ============================================================================
// Provider
// ============================================================================

interface LocaleScopeProviderProps {
  children: React.ReactNode;
  /** Initial locale (defaults to current global content locale) */
  initialLocale?: string;
}

/**
 * Provides an isolated locale scope for nested forms.
 * Locale changes inside this provider don't affect the global state.
 */
export function LocaleScopeProvider({
  children,
  initialLocale,
}: LocaleScopeProviderProps) {
  const globalLocale = useAdminStore(selectContentLocale);
  const [scopedLocale, setScopedLocale] = React.useState(
    initialLocale ?? globalLocale,
  );

  // Sync with global locale on mount or when global changes (only if not yet modified)
  const hasModifiedRef = React.useRef(false);
  React.useEffect(() => {
    if (!hasModifiedRef.current) {
      setScopedLocale(globalLocale);
    }
  }, [globalLocale]);

  const setLocale = React.useCallback((locale: string) => {
    hasModifiedRef.current = true;
    setScopedLocale(locale);
  }, []);

  const value = React.useMemo<LocaleScopeContextValue>(
    () => ({
      locale: scopedLocale,
      setLocale,
      isScoped: true,
    }),
    [scopedLocale, setLocale],
  );

  return (
    <LocaleScopeContext.Provider value={value}>
      {children}
    </LocaleScopeContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Returns scoped locale if in a LocaleScopeProvider, otherwise global locale.
 * Use this in components that need locale-aware behavior (FieldWrapper, FormView).
 */
export function useScopedLocale(): LocaleScopeContextValue {
  const scopedContext = React.useContext(LocaleScopeContext);
  const globalLocale = useAdminStore(selectContentLocale);
  const globalSetLocale = useAdminStore(selectSetContentLocale);

  // If we're in a scoped context, use that
  if (scopedContext) {
    return scopedContext;
  }

  // Otherwise, use global locale
  return {
    locale: globalLocale,
    setLocale: globalSetLocale,
    isScoped: false,
  };
}

/**
 * Returns true if we're currently in a scoped locale context (nested form).
 */
export function useIsLocaleScopeActive(): boolean {
  const scopedContext = React.useContext(LocaleScopeContext);
  return scopedContext !== null;
}
