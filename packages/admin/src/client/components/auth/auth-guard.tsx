/**
 * Auth Guard Component
 *
 * Wraps protected content and handles authentication state.
 * Shows loading state while checking session, redirects to login
 * if not authenticated or missing required role.
 *
 * @example
 * ```tsx
 * <AuthGuard loginPath="/admin/login" requiredRole="admin">
 *   <ProtectedContent />
 * </AuthGuard>
 * ```
 */

import * as React from "react";
import { useAuthClientSafe } from "../../hooks/use-auth";
import {
  selectBasePath,
  selectNavigate,
  useAdminStore,
} from "../../runtime/provider";
import { AuthLoading } from "./auth-loading";

// ============================================================================
// Types
// ============================================================================

export interface AuthGuardProps {
  /**
   * Content to render when authenticated
   */
  children: React.ReactNode;

  /**
   * Fallback to show while checking session
   * @default <AuthLoading />
   */
  loadingFallback?: React.ReactNode;

  /**
   * Path to redirect to when not authenticated
   * @default "{basePath}/login"
   */
  loginPath?: string;

  /**
   * Custom component to show when unauthorized (instead of redirect)
   */
  unauthorizedFallback?: React.ReactNode;

  /**
   * Required role for access
   * @default "admin"
   */
  requiredRole?: string;

  /**
   * Disable the auth guard (render children directly)
   * Useful for public pages within the admin layout
   */
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Auth Guard Component
 *
 * Protects content by checking authentication state and user role.
 * Uses Better Auth's useSession() hook internally.
 */
export function AuthGuard({
  children,
  loadingFallback,
  loginPath,
  unauthorizedFallback,
  requiredRole = "admin",
  disabled = false,
}: AuthGuardProps): React.ReactElement {
  const authClient = useAuthClientSafe();
  const basePath = useAdminStore(selectBasePath);
  const navigate = useAdminStore(selectNavigate);

  // Determine if auth is enabled (not disabled and has auth client)
  const authEnabled = !disabled && authClient !== null;

  // Use Better Auth's session hook - always call to follow Rules of Hooks
  // When authClient is null, we use a stable mock that returns no session
  const sessionResult = authClient?.useSession();
  const session = authEnabled ? sessionResult?.data : null;
  const isPending = authEnabled ? (sessionResult?.isPending ?? false) : false;

  // Handle redirect after render (useEffect for side effects)
  const resolvedLoginPath = loginPath ?? `${basePath}/login`;
  const shouldRedirect =
    authEnabled &&
    !isPending &&
    (!session || session.user?.role !== requiredRole);

  React.useEffect(() => {
    if (shouldRedirect && !unauthorizedFallback) {
      // Store current path for redirect after login
      const currentPath =
        typeof window !== "undefined" ? window.location.pathname : "";
      const redirectUrl = currentPath
        ? `${resolvedLoginPath}?redirect=${encodeURIComponent(currentPath)}`
        : resolvedLoginPath;
      navigate(redirectUrl);
    }
  }, [shouldRedirect, unauthorizedFallback, resolvedLoginPath, navigate]);

  // If disabled or no auth client, render children directly
  if (!authEnabled) {
    return <>{children}</>;
  }

  // Loading state
  if (isPending) {
    return <>{loadingFallback ?? <AuthLoading />}</>;
  }

  // Not authenticated or wrong role
  if (!session || session.user?.role !== requiredRole) {
    // Show unauthorized fallback if provided
    if (unauthorizedFallback) {
      return <>{unauthorizedFallback}</>;
    }

    // Otherwise show loading while redirect happens
    return <>{loadingFallback ?? <AuthLoading />}</>;
  }

  // Authenticated with correct role - render children
  return <>{children}</>;
}

export default AuthGuard;
