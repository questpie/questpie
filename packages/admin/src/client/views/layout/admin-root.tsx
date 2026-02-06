/**
 * AdminRoot Component
 *
 * The main entry point for the new admin() builder architecture.
 * Wires together AdminProvider, Layout, and Router.
 *
 * @example
 * ```tsx
 * import { admin } from "@questpie/admin/builder";
 * import { AdminRoot } from "@questpie/admin/views/layout";
 * import { createClient } from "questpie/client";
 *
 * const appAdmin = admin<typeof app>()
 *   .collections({ posts: { icon: "FileText" } })
 *   .build();
 *
 * const client = createClient<typeof app>({ baseUrl: "/api" });
 *
 * function AdminPage() {
 *   const segments = useAdminSegments(); // from your router
 *   const navigate = useNavigate();
 *
 *   return (
 *     <AdminRoot
 *       admin={appAdmin}
 *       client={client}
 *       segments={segments}
 *       navigate={navigate}
 *       LinkComponent={Link}
 *     />
 *   );
 * }
 * ```
 */

import type { QueryClient } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";
import type * as React from "react";
import type { Admin } from "../../builder/admin";
import { AdminProvider } from "../../runtime/provider";
import { AdminLayout } from "./admin-layout";
import { AdminRouter } from "./admin-router";
import type { LinkComponentProps } from "./admin-sidebar";

// ============================================================================
// Types
// ============================================================================

export interface AdminRootProps<TApp extends Questpie<any> = Questpie<any>> {
  /**
   * Admin configuration instance (from admin().build())
   */
  admin: Admin;

  /**
   * API client for data fetching
   */
  client: QuestpieClient<TApp>;

  /**
   * Current route segments after /admin
   * Example: ["collections", "posts"] for /admin/collections/posts
   */
  segments: string[];

  /**
   * Navigate function from your router
   */
  navigate: (path: string) => void;

  /**
   * Link component from your router
   */
  LinkComponent: React.ComponentType<LinkComponentProps>;

  /**
   * Current active route path (for sidebar highlighting)
   */
  activeRoute?: string;

  /**
   * Base path for admin routes (default: "/admin")
   */
  basePath?: string;

  /**
   * Optional QueryClient instance
   */
  queryClient?: QueryClient;

  /**
   * Custom dashboard component (overrides admin config)
   */
  DashboardComponent?: React.ComponentType;

  /**
   * Custom collection components
   */
  collectionComponents?: Record<
    string,
    {
      List?: React.ComponentType;
      Form?: React.ComponentType;
    }
  >;

  /**
   * Custom global components
   */
  globalComponents?: Record<
    string,
    {
      Form?: React.ComponentType;
    }
  >;

  /**
   * Custom not found component
   */
  NotFoundComponent?: React.ComponentType;

  /**
   * Header content
   */
  header?: React.ReactNode;

  /**
   * Footer content
   */
  footer?: React.ReactNode;

  /**
   * Sidebar props (footer, collapsed state, etc.)
   */
  sidebarProps?: {
    footer?: React.ReactNode;
    collapsed?: boolean;
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * AdminRoot Component
 *
 * The all-in-one component for mounting the admin UI.
 * Uses the new admin() builder architecture.
 */
export function AdminRoot<TApp extends Questpie<any>>({
  admin,
  client,
  segments,
  navigate,
  LinkComponent,
  activeRoute,
  basePath = "/admin",
  queryClient,
  DashboardComponent,
  collectionComponents,
  globalComponents,
  NotFoundComponent,
  header,
  footer,
  sidebarProps,
}: AdminRootProps<TApp>): React.ReactElement {
  return (
    <AdminProvider admin={admin} client={client} queryClient={queryClient}>
      <AdminLayout
        LinkComponent={LinkComponent}
        activeRoute={activeRoute}
        basePath={basePath}
        header={header}
        footer={footer}
        sidebarProps={sidebarProps}
      >
        <AdminRouter
          segments={segments}
          navigate={navigate}
          basePath={basePath}
          DashboardComponent={DashboardComponent}
          collectionComponents={collectionComponents}
          globalComponents={globalComponents}
          NotFoundComponent={NotFoundComponent}
        />
      </AdminLayout>
    </AdminProvider>
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { Admin } from "../../builder/admin";
export type { AdminProvider } from "../../runtime/provider";
