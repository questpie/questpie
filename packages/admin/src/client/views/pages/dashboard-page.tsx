/**
 * Dashboard Page
 *
 * Default dashboard page that renders the DashboardGrid component
 * based on the admin configuration.
 */

import * as React from "react";
import type { DashboardConfig } from "../../builder";
import { useAdminConfig } from "../../hooks/use-admin-config";
import {
  selectBasePath,
  selectNavigate,
  useAdminStore,
} from "../../runtime/provider";
import { DashboardGrid } from "../dashboard/dashboard-grid";

export interface DashboardPageProps {
  /**
   * Override dashboard title
   */
  title?: string;

  /**
   * Override dashboard description
   */
  description?: string;

  /**
   * Additional CSS class
   */
  className?: string;
}

/**
 * Default dashboard page component.
 *
 * Reads dashboard configuration from AdminProvider and renders DashboardGrid.
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(coreAdminModule)
 *   .dashboard({
 *     title: "Welcome",
 *     widgets: [
 *       { type: "stats", collection: "posts" },
 *     ],
 *   })
 * ```
 */
export function DashboardPage({
  title,
  description,
  className,
}: DashboardPageProps) {
  const basePath = useAdminStore(selectBasePath);
  const navigate = useAdminStore(selectNavigate);
  const { data: serverConfig } = useAdminConfig();

  const dashboardConfig = (serverConfig?.dashboard ?? {}) as DashboardConfig;

  // Merge props with config
  const config = {
    ...dashboardConfig,
    ...(title && { title }),
    ...(description && { description }),
  };

  return (
    <DashboardGrid
      config={config}
      basePath={basePath}
      navigate={navigate}
      className={className}
    />
  );
}


