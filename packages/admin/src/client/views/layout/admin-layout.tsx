/**
 * AdminLayout Component
 *
 * Complete admin layout with:
 * - Sidebar navigation (using shadcn sidebar primitives)
 * - Main content area
 * - Optional header/footer
 *
 * Automatically reads from AdminProvider context when props are not provided.
 */

import * as React from "react";
import { SidebarInset, SidebarProvider } from "../../components/ui/sidebar";
import { type AdminToasterProps, Toaster } from "../../components/ui/sonner";
import {
  BreadcrumbProvider,
  useCurrentBreadcrumbs,
} from "../../contexts/breadcrumb-context";
import { cn } from "../../lib/utils";
import { useAdminStore } from "../../runtime/provider";
import type { NavigationGroup } from "../../runtime/routes";
import { GlobalSearch } from "../common";
import { AdminSidebar, type AdminSidebarProps } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";

// ============================================================================
// Types
// ============================================================================

/**
 * Theme mode for the admin interface
 */
export type AdminTheme = "light" | "dark" | "system";

/**
 * Layout mode for content area width
 * - default: max-w-6xl (forms, settings)
 * - wide: max-w-7xl (tables, cards)
 * - full: 100% with padding (kanban, calendar)
 * - immersive: 100% no padding (puck editor)
 */
export type LayoutMode = "default" | "wide" | "full" | "immersive";

/**
 * Shared layout props that can be passed through AdminLayoutProvider
 * or directly to AdminLayout.
 */
export interface AdminLayoutSharedProps {
  /**
   * Link component (router-specific)
   */
  LinkComponent: AdminSidebarProps["LinkComponent"];

  /**
   * Current active route
   */
  activeRoute?: string;

  /**
   * Base path for admin routes
   * @default "/admin"
   */
  basePath?: string;

  /**
   * Header content
   */
  header?: React.ReactNode;

  /**
   * Footer content
   */
  footer?: React.ReactNode;

  /**
   * Additional sidebar props
   */
  sidebarProps?: Partial<
    Omit<AdminSidebarProps, "navigation" | "LinkComponent">
  >;

  /**
   * Current theme.
   * Pass from your app's theme context.
   * @default "system"
   */
  theme?: AdminTheme;

  /**
   * Callback to change theme.
   * Connect to your app's theme context setTheme function.
   */
  setTheme?: (theme: AdminTheme) => void;

  /**
   * Show theme toggle button in the topbar
   * @default true (when setTheme is provided)
   */
  showThemeToggle?: boolean;

  /**
   * Additional toaster props
   */
  toasterProps?: Omit<AdminToasterProps, "theme">;

  /**
   * Custom layout className
   */
  className?: string;

  /**
   * Layout mode for content area width
   * @default "default"
   */
  layoutMode?: LayoutMode;
}

export interface AdminLayoutProps extends AdminLayoutSharedProps {
  /**
   * Navigation groups for sidebar.
   * If not provided, reads from AdminProvider context.
   */
  navigation?: NavigationGroup[];

  /**
   * Brand name for sidebar.
   * If not provided, reads from AdminProvider context.
   */
  brandName?: string;

  /**
   * Whether sidebar is collapsed
   */
  sidebarCollapsed?: boolean;

  /**
   * Main content to render
   */
  children: React.ReactNode;

  /**
   * Navigation function (for search/quick actions)
   */
  navigate?: (path: string) => void;
}

// ============================================================================
// Internal Hook - Resolve props from store
// ============================================================================

function useLayoutProps(props: {
  navigation?: NavigationGroup[];
  brandName?: string;
  navigate?: (path: string) => void;
}): {
  navigation: NavigationGroup[];
  brandName: string;
  navigate: (path: string) => void;
} {
  // Subscribe to store values reactively (for HMR support)
  const storeNavigation = useAdminStore((s) => s.navigation);
  const storeBrandName = useAdminStore((s) => s.brandName);
  const storeNavigate = useAdminStore((s) => s.navigate);

  return {
    navigation: props.navigation ?? storeNavigation,
    brandName: props.brandName ?? storeBrandName,
    navigate: props.navigate ?? storeNavigate,
  };
}

// ============================================================================
// Internal Components
// ============================================================================

/**
 * Topbar wrapper that reads breadcrumbs from context
 */
function AdminTopbarWithBreadcrumbs(
  props: Omit<React.ComponentProps<typeof AdminTopbar>, "breadcrumbs">,
) {
  const breadcrumbs = useCurrentBreadcrumbs();
  return <AdminTopbar {...props} breadcrumbs={breadcrumbs} />;
}

// ============================================================================
// Component
// ============================================================================

/**
 * AdminLayout Component
 *
 * When used inside AdminProvider, navigation and brandName are automatically
 * read from context if not provided as props.
 *
 * @example
 * ```tsx
 * // With AdminProvider (automatic)
 * <AdminProvider admin={admin} client={client}>
 *   <AdminLayout LinkComponent={Link} activeRoute="/admin/posts">
 *     <Outlet />
 *   </AdminLayout>
 * </AdminProvider>
 *
 * // Without AdminProvider (manual)
 * <AdminLayout
 *   navigation={buildNavigation(admin)}
 *   LinkComponent={Link}
 *   activeRoute="/admin/posts"
 *   brandName="My CMS"
 * >
 *   <Outlet />
 * </AdminLayout>
 * ```
 */
export function AdminLayout({
  navigation: navigationProp,
  LinkComponent,
  activeRoute,
  basePath = "/admin",
  brandName: brandNameProp,
  sidebarCollapsed: sidebarCollapsedProp = false,
  children,
  className,
  sidebarProps,
  header,
  footer,
  navigate: navigateProp,
  theme = "system",
  setTheme,
  showThemeToggle,
  toasterProps,
  layoutMode = "default",
}: AdminLayoutProps): React.ReactElement {
  // Infer show flags from content
  const shouldShowHeader = !!header;
  const shouldShowFooter = !!footer;
  // Resolve navigation and brandName from props or store
  const { navigation, brandName, navigate } = useLayoutProps({
    navigation: navigationProp,
    brandName: brandNameProp,
    navigate: navigateProp,
  });

  const [isSearchOpen, setIsSearchOpen] = React.useState(false);

  // Keyboard shortcuts for search
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <BreadcrumbProvider>
      <div
        className={cn("min-h-screen bg-background bg-grid-quest", className)}
      >
        {/* <div className="fixed inset-0 bg-grid-quest  pointer-events-none z-10" /> */}
        <GlobalSearch
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          navigate={navigate}
          basePath={basePath}
        />

        {/* Max-width container for ultrawide monitors - centered with subtle side borders */}
        <SidebarProvider
          defaultOpen={!sidebarCollapsedProp}
          className="mx-auto max-w-[1920px] border-x border-border/40 h-svh overflow-hidden"
        >
          {/* Sidebar */}
          <AdminSidebar
            navigation={navigationProp}
            LinkComponent={LinkComponent}
            activeRoute={activeRoute}
            basePath={basePath}
            brandName={brandNameProp}
            {...sidebarProps}
          />

          {/* Content Area */}
          <SidebarInset className="flex h-svh flex-col">
            <AdminTopbarWithBreadcrumbs
              onSearchOpen={() => setIsSearchOpen(true)}
              theme={theme}
              setTheme={setTheme}
              showThemeToggle={showThemeToggle}
            />

            {/* Header (optional) */}
            {shouldShowHeader && header && (
              <header className="border-b">{header}</header>
            )}

            <main className="flex-1 overflow-y-auto">
              <div
                className={cn(
                  "mx-auto",
                  layoutMode === "default" && "max-w-6xl p-5 md:p-8 lg:p-10",
                  layoutMode === "wide" && "max-w-7xl p-5 md:p-8 lg:p-10",
                  layoutMode === "full" && "max-w-full p-4 md:p-6",
                  layoutMode === "immersive" && "max-w-full p-0",
                )}
              >
                {children}
              </div>
            </main>

            {/* Footer (optional) */}
            {shouldShowFooter && footer && (
              <footer className="border-t">{footer}</footer>
            )}
          </SidebarInset>
        </SidebarProvider>

        {/* Toast notifications */}
        <Toaster theme={theme} {...toasterProps} />
      </div>
    </BreadcrumbProvider>
  );
}
