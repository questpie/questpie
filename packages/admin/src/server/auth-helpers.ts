/**
 * SSR Auth Helpers
 *
 * Server-side utilities for authentication in SSR frameworks.
 * These helpers work with Better Auth to check session on the server.
 *
 * @example TanStack Router
 * ```ts
 * import { requireAdminAuth } from "@questpie/admin/server";
 *
 * export const Route = createFileRoute("/admin")({
 *   beforeLoad: async ({ context }) => {
 *     const redirect = await requireAdminAuth({
 *       request: context.request,
 *       app,
 *       loginPath: "/admin/login",
 *     });
 *     if (redirect) throw redirect;
 *   },
 * });
 * ```
 */

import type { Questpie } from "questpie";

/**
 * Session object from Better Auth
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
    [key: string]: unknown;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    [key: string]: unknown;
  };
}

/**
 * Options for requireAdminAuth
 */
export interface RequireAdminAuthOptions {
  /**
   * The incoming request
   */
  request: Request;

  /**
   * The app instance with auth configured
   */
  app: Questpie<any>;

  /**
   * Path to redirect to when not authenticated
   * @default "/admin/login"
   */
  loginPath?: string;

  /**
   * Required role for access
   * @default "admin"
   */
  requiredRole?: string;

  /**
   * Query parameter name for redirect URL
   * @default "redirect"
   */
  redirectParam?: string;
}

/**
 * Options for getAdminSession
 */
export interface GetAdminSessionOptions {
  /**
   * The incoming request
   */
  request: Request;

  /**
   * The app instance with auth configured
   */
  app: Questpie<any>;
}

/**
 * Check if user is authenticated with required role on the server.
 * Returns a redirect Response if not authenticated, null if authenticated.
 *
 * Use this in server loaders/middleware to protect routes.
 *
 * @example TanStack Router
 * ```ts
 * export const Route = createFileRoute("/admin")({
 *   beforeLoad: async ({ context }) => {
 *     const redirect = await requireAdminAuth({
 *       request: context.request,
 *       app,
 *       loginPath: "/admin/login",
 *     });
 *     if (redirect) throw redirect;
 *   },
 * });
 * ```
 *
 * @example Next.js Middleware
 * ```ts
 * export async function middleware(request: NextRequest) {
 *   const redirect = await requireAdminAuth({
 *     request,
 *     app,
 *     loginPath: "/admin/login",
 *   });
 *   if (redirect) return redirect;
 *   return NextResponse.next();
 * }
 * ```
 */
export async function requireAdminAuth({
  request,
  app,
  loginPath = "/admin/login",
  requiredRole = "admin",
  redirectParam = "redirect",
}: RequireAdminAuthOptions): Promise<Response | null> {
  // Check if auth is configured
  if (!app.auth) {
    console.warn("requireAdminAuth: Auth not configured on app instance");
    return null;
  }

  try {
    // Get session from Better Auth
    const session = await app.auth.api.getSession({
      headers: request.headers,
    });

    // No session - redirect to login
    if (!session || !session.user) {
      const currentUrl = new URL(request.url);
      const redirectUrl = new URL(loginPath, currentUrl.origin);
      redirectUrl.searchParams.set(redirectParam, currentUrl.pathname);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Check role - cast to any because role is added by Better Auth admin plugin
    const userRole = (session.user as any).role;
    if (userRole !== requiredRole) {
      const currentUrl = new URL(request.url);
      const redirectUrl = new URL(loginPath, currentUrl.origin);
      redirectUrl.searchParams.set(redirectParam, currentUrl.pathname);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Authenticated with correct role
    return null;
  } catch (error) {
    console.error("requireAdminAuth: Error checking session", error);
    // On error, redirect to login for safety
    const currentUrl = new URL(request.url);
    const redirectUrl = new URL(loginPath, currentUrl.origin);
    return Response.redirect(redirectUrl.toString(), 302);
  }
}

/**
 * Get the current admin session on the server.
 * Returns null if not authenticated.
 *
 * Use this when you need access to the session data in server code.
 *
 * @example
 * ```ts
 * const session = await getAdminSession({ request, app });
 * if (!session) {
 *   return redirect("/admin/login");
 * }
 * console.log("User:", session.user.name);
 * ```
 */
export async function getAdminSession({
  request,
  app,
}: GetAdminSessionOptions): Promise<AuthSession | null> {
  // Check if auth is configured
  if (!app.auth) {
    return null;
  }

  try {
    const session = await app.auth.api.getSession({
      headers: request.headers,
    });

    if (!session || !session.user) {
      return null;
    }

    return session as AuthSession;
  } catch (error) {
    console.error("getAdminSession: Error getting session", error);
    return null;
  }
}

/**
 * Check if the current user has admin role on the server.
 *
 * @example
 * ```ts
 * const isAdmin = await isAdminUser({ request, app });
 * if (!isAdmin) {
 *   return json({ error: "Unauthorized" }, { status: 403 });
 * }
 * ```
 */
export async function isAdminUser({
  request,
  app,
  requiredRole = "admin",
}: GetAdminSessionOptions & { requiredRole?: string }): Promise<boolean> {
  const session = await getAdminSession({ request, app });
  // Cast to any to access role - it's added by Better Auth admin plugin
  return (session?.user as any)?.role === requiredRole;
}
