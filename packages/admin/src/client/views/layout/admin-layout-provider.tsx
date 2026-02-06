/**
 * AdminLayoutProvider Component
 *
 * Universal layout wrapper that works with any router.
 * Provides AdminProvider + AdminLayout and renders children.
 *
 * @example Next.js (App Router)
 * ```tsx
 * // app/admin/layout.tsx
 * export default function AdminLayout({ children }) {
 *   return (
 *     <AdminLayoutProvider
 *       admin={myAdmin}
 *       client={cmsClient}
 *       authClient={authClient}
 *       LinkComponent={Link}
 *     >
 *       {children}
 *     </AdminLayoutProvider>
 *   );
 * }
 * ```
 *
 * @example TanStack Router
 * ```tsx
 * // routes/admin.tsx
 * function AdminLayout() {
 *   return (
 *     <AdminLayoutProvider
 *       admin={myAdmin}
 *       client={cmsClient}
 *       authClient={authClient}
 *       LinkComponent={Link}
 *     >
 *       <Outlet />
 *     </AdminLayoutProvider>
 *   );
 * }
 * ```
 *
 * @example With Auth Protection
 * ```tsx
 * <AdminLayoutProvider
 *   admin={myAdmin}
 *   client={cmsClient}
 *   authClient={authClient}
 *   enableAuthGuard={true}
 *   publicPaths={["/admin/login", "/admin/forgot-password"]}
 *   requiredRole="admin"
 * >
 *   {children}
 * </AdminLayoutProvider>
 * ```
 */

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";
import type * as React from "react";
import { Admin, type AdminInput } from "../../builder/admin";
import type { AdminBuilder } from "../../builder/admin-builder";
import { AuthGuard } from "../../components/auth";
import { AdminProvider } from "../../runtime/provider";
import { AdminLayout, type AdminLayoutSharedProps } from "./admin-layout";

// ============================================================================
// Types
// ============================================================================

export interface AdminLayoutProviderProps<
  TApp extends Questpie<any> = Questpie<any>,
> extends AdminLayoutSharedProps {
  /**
   * Admin configuration - pass your AdminBuilder directly.
   * Can also accept an Admin instance for backward compatibility.
   *
   * @example
   * ```tsx
   * // Recommended: pass builder directly
   * <AdminLayoutProvider admin={admin} ... />
   *
   * // Also works (backward compatible)
   * <AdminLayoutProvider admin={Admin.from(admin)} ... />
   * ```
   */
  admin: AdminInput<any>;

  /**
   * API client for data fetching
   */
  client: QuestpieClient<TApp>;

  /**
   * Auth client for authentication (created via createAdminAuthClient)
   */
  authClient?: any;

  /**
   * Optional QueryClient instance (will create one if not provided)
   */
  queryClient?: QueryClient;

  // =========================================================================
  // Auth Guard Options
  // =========================================================================

  /**
   * Enable authentication guard for protected routes.
   * When true, checks if user is authenticated before rendering content.
   * @default true if authClient is provided
   */
  enableAuthGuard?: boolean;

  /**
   * Paths that don't require authentication.
   * Use relative paths from basePath (e.g., "/login" for "/admin/login").
   * @default ["/login", "/forgot-password", "/reset-password", "/accept-invite"]
   */
  publicPaths?: string[];

  /**
   * Required role for accessing protected routes.
   * @default "admin"
   */
  requiredRole?: string;

  /**
   * Custom loading component while checking authentication.
   */
  authLoadingFallback?: React.ReactNode;

  /**
   * Custom unauthorized component (instead of redirecting to login).
   */
  authUnauthorizedFallback?: React.ReactNode;

  // =========================================================================
  // i18n Options
  // =========================================================================

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
   * <AdminLayoutProvider
   *   admin={admin}
   *   client={client}
   *   useServerTranslations
   * >
   *   {children}
   * </AdminLayoutProvider>
   * ```
   */
  useServerTranslations?: boolean;

  /**
   * Fallback element to show while loading server translations.
   * Only used when useServerTranslations is true.
   */
  translationsFallback?: React.ReactNode;

  /**
   * Initial UI locale (admin interface language)
   * If not provided, reads from cookie or uses default from admin config
   */
  initialUiLocale?: string;

  /**
   * Children to render inside the layout
   * - Next.js: {children} from layout props
   * - TanStack Router: <Outlet />
   */
  children: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

import { QueryClient as QueryClientClass } from "@tanstack/react-query";

let cachedQueryClient: QueryClient | undefined;

function getDefaultQueryClient(): QueryClient {
  if (!cachedQueryClient) {
    cachedQueryClient = new QueryClientClass({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000, // 1 minute
        },
      },
    });
  }
  return cachedQueryClient;
}

/**
 * Default public paths that don't require authentication
 * These paths also render WITHOUT the admin layout (no sidebar/header)
 */
const DEFAULT_PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/accept-invite",
  "/setup",
];

/**
 * Check if current path matches any public path
 */
function isPublicPath(
  currentPath: string | undefined,
  basePath: string,
  publicPaths: string[],
): boolean {
  if (!currentPath) return false;

  // Normalize paths
  const normalizedCurrent = currentPath.replace(/\/+$/, "");
  const normalizedBase = basePath.replace(/\/+$/, "");

  for (const publicPath of publicPaths) {
    // Build full public path
    const fullPublicPath = `${normalizedBase}${publicPath}`.replace(/\/+$/, "");

    // Check exact match or starts with (for nested routes)
    if (
      normalizedCurrent === fullPublicPath ||
      normalizedCurrent.startsWith(`${fullPublicPath}/`)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * AdminLayoutProvider Component
 *
 * Universal wrapper for admin layout that works with any router.
 * Handles all the provider setup and renders children inside the layout.
 */
export function AdminLayoutProvider<TApp extends Questpie<any>>({
  admin: adminInput,
  client,
  authClient,
  queryClient,
  // Shared layout props
  LinkComponent,
  activeRoute,
  basePath = "/admin",
  header,
  footer,
  sidebarProps,
  theme,
  setTheme,
  showThemeToggle,
  toasterProps,
  className,
  // Auth guard props
  enableAuthGuard,
  publicPaths = DEFAULT_PUBLIC_PATHS,
  requiredRole = "admin",
  authLoadingFallback,
  authUnauthorizedFallback,
  // i18n props
  useServerTranslations,
  translationsFallback,
  initialUiLocale,
  // Children
  children,
}: AdminLayoutProviderProps<TApp>): React.ReactElement {
  const qc = queryClient ?? getDefaultQueryClient();

  // Normalize admin input - accepts both AdminBuilder and Admin instance
  const admin = Admin.normalize(adminInput);

  // Determine if auth guard should be enabled
  // Default: enabled if authClient is provided
  const shouldUseAuthGuard = enableAuthGuard ?? authClient != null;

  // Check if current route is public
  const currentPath =
    activeRoute ??
    (typeof window !== "undefined" ? window.location.pathname : undefined);
  const isCurrentPathPublic = isPublicPath(currentPath, basePath, publicPaths);

  // Determine content based on path type:
  // - Public paths (login, setup, etc.): render children directly (no AdminLayout)
  // - Protected paths: render with AdminLayout + optional AuthGuard
  let innerContent: React.ReactNode;

  if (isCurrentPathPublic) {
    // Public paths render children directly without admin layout (sidebar/header)
    // Auth pages (login, setup) use their own AuthLayout component
    innerContent = children;
  } else {
    // Protected paths get the full admin layout
    const layoutContent = (
      <AdminLayout
        LinkComponent={LinkComponent}
        activeRoute={activeRoute}
        basePath={basePath}
        header={header}
        footer={footer}
        sidebarProps={sidebarProps}
        theme={theme}
        setTheme={setTheme}
        showThemeToggle={showThemeToggle}
        toasterProps={toasterProps}
        className={className}
      >
        {children}
      </AdminLayout>
    );

    // Optionally wrap with auth guard
    innerContent = shouldUseAuthGuard ? (
      <AuthGuard
        loginPath={`${basePath}/login`}
        requiredRole={requiredRole}
        loadingFallback={authLoadingFallback}
        unauthorizedFallback={authUnauthorizedFallback}
      >
        {layoutContent}
      </AuthGuard>
    ) : (
      layoutContent
    );
  }

  const content = (
    <AdminProvider
      admin={admin}
      client={client}
      authClient={authClient}
      useServerTranslations={useServerTranslations}
      translationsFallback={translationsFallback}
      initialUiLocale={initialUiLocale}
    >
      {innerContent}
    </AdminProvider>
  );

  // Always wrap with QueryClientProvider
  return <QueryClientProvider client={qc}>{content}</QueryClientProvider>;
}

export default AdminLayoutProvider;
