import * as React from "react";
import type { I18nText } from "../i18n/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Simple icon component type for breadcrumbs
 */
type BreadcrumbIcon = React.ComponentType<{ className?: string }>;

/**
 * Menu item for breadcrumb dropdown
 */
export interface BreadcrumbMenuItem {
  label: I18nText;
  href: string;
  icon?: BreadcrumbIcon;
}

/**
 * Single breadcrumb item
 */
export interface Breadcrumb {
  /**
   * Display label (supports I18nText for localization)
   */
  label: I18nText;

  /**
   * Navigation href (optional - last item usually doesn't have one)
   */
  href?: string;

  /**
   * Icon component (optional)
   */
  icon?: BreadcrumbIcon;

  /**
   * Dropdown menu items for quick navigation
   * e.g., switch between collections or items
   */
  menu?: {
    items: BreadcrumbMenuItem[];
  };
}

/**
 * Breadcrumb context value
 */
interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (breadcrumbs: Breadcrumb[]) => void;
}

// ============================================================================
// Context
// ============================================================================

const BreadcrumbContext = React.createContext<BreadcrumbContextValue | null>(
  null,
);

// ============================================================================
// Provider
// ============================================================================

export interface BreadcrumbProviderProps {
  children: React.ReactNode;
}

export function BreadcrumbProvider({
  children,
}: BreadcrumbProviderProps): React.ReactElement {
  const [breadcrumbs, setBreadcrumbs] = React.useState<Breadcrumb[]>([]);

  const value = React.useMemo(
    () => ({
      breadcrumbs,
      setBreadcrumbs,
    }),
    [breadcrumbs],
  );

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get breadcrumb context
 * @throws if used outside BreadcrumbProvider
 */
export function useBreadcrumbContext(): BreadcrumbContextValue {
  const context = React.useContext(BreadcrumbContext);
  if (!context) {
    throw new Error(
      "useBreadcrumbContext must be used within a BreadcrumbProvider",
    );
  }
  return context;
}

/**
 * Get breadcrumb context (optional - returns null if not in provider)
 */
export function useBreadcrumbContextOptional(): BreadcrumbContextValue | null {
  return React.useContext(BreadcrumbContext);
}

/**
 * Set breadcrumbs for the current page
 * Automatically cleans up on unmount
 *
 * @example
 * ```tsx
 * function PostsListPage() {
 *   useBreadcrumbs([
 *     { label: "Dashboard", href: "/admin", icon: House },
 *     { label: "Posts", icon: Article },
 *   ]);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useBreadcrumbs(breadcrumbs: Breadcrumb[]): void {
  const context = useBreadcrumbContextOptional();

  React.useEffect(() => {
    if (!context) return;

    context.setBreadcrumbs(breadcrumbs);

    return () => {
      context.setBreadcrumbs([]);
    };
  }, [context, breadcrumbs]);
}

/**
 * Get current breadcrumbs (read-only)
 */
export function useCurrentBreadcrumbs(): Breadcrumb[] {
  const context = useBreadcrumbContextOptional();
  return context?.breadcrumbs ?? [];
}
