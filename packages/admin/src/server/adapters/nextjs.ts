/**
 * Next.js Adapter
 *
 * Convenience helpers for Next.js middleware integration.
 *
 * @example App Router middleware
 * ```ts
 * // middleware.ts
 * import { createNextAuthMiddleware } from "@questpie/admin/server/adapters/nextjs";
 * import { app } from "./questpie/server/app";
 *
 * export default createNextAuthMiddleware({
 *   app,
 *   loginPath: "/admin/login",
 *   protectedPaths: ["/admin"],
 *   publicPaths: ["/admin/login", "/admin/forgot-password"],
 * });
 *
 * export const config = {
 *   matcher: ["/admin/:path*"],
 * };
 * ```
 */

import type { Questpie } from "questpie";
import { getAdminSession, requireAdminAuth } from "../auth-helpers.js";

/**
 * Options for Next.js auth middleware
 */
export interface NextAuthMiddlewareOptions {
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
	 * Paths that require authentication (uses startsWith matching)
	 * @default ["/admin"]
	 */
	protectedPaths?: string[];

	/**
	 * Paths within protectedPaths that should be publicly accessible
	 * @default ["/admin/login", "/admin/forgot-password", "/admin/reset-password", "/admin/accept-invite"]
	 */
	publicPaths?: string[];

	/**
	 * Query parameter name for redirect URL
	 * @default "redirect"
	 */
	redirectParam?: string;
}

/**
 * Check if a path matches any of the given patterns
 */
function pathMatches(pathname: string, patterns: string[]): boolean {
	return patterns.some(
		(pattern) =>
			pathname === pattern ||
			pathname.startsWith(`${pattern}/`) ||
			pathname.startsWith(pattern),
	);
}

/**
 * Create a Next.js middleware for admin authentication.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { createNextAuthMiddleware } from "@questpie/admin/server/adapters/nextjs";
 * import { app } from "./questpie/server/app";
 *
 * export default createNextAuthMiddleware({
 *   app,
 *   loginPath: "/admin/login",
 * });
 *
 * export const config = {
 *   matcher: ["/admin/:path*"],
 * };
 * ```
 */
export function createNextAuthMiddleware({
	app,
	loginPath = "/admin/login",
	requiredRole = "admin",
	protectedPaths = ["/admin"],
	publicPaths = [
		"/admin/login",
		"/admin/forgot-password",
		"/admin/reset-password",
		"/admin/accept-invite",
	],
	redirectParam = "redirect",
}: NextAuthMiddlewareOptions) {
	return async function middleware(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// Check if this is a protected path
		const isProtected = pathMatches(pathname, protectedPaths);
		const isPublic = pathMatches(pathname, publicPaths);

		// If not protected or is public, continue
		if (!isProtected || isPublic) {
			// Return a "continue" response
			// In Next.js middleware, returning undefined or NextResponse.next() continues
			// Since we're using standard Response, we'll return a special header
			return new Response(null, {
				status: 200,
				headers: {
					"x-middleware-next": "1",
				},
			});
		}

		// Check authentication
		const redirect = await requireAdminAuth({
			request,
			app,
			loginPath,
			requiredRole,
			redirectParam,
		});

		if (redirect) {
			return redirect;
		}

		// Authenticated - continue
		return new Response(null, {
			status: 200,
			headers: {
				"x-middleware-next": "1",
			},
		});
	};
}

/**
 * Get the admin session in a Next.js server component or API route.
 *
 * @example Server Component
 * ```tsx
 * // app/admin/layout.tsx
 * import { getNextAdminSession } from "@questpie/admin/server/adapters/nextjs";
 * import { headers } from "next/headers";
 * import { app } from "~/questpie/server/app";
 *
 * export default async function AdminLayout({ children }) {
 *   const headersList = headers();
 *   const session = await getNextAdminSession({
 *     headers: headersList,
 *     app,
 *   });
 *
 *   if (!session) {
 *     redirect("/admin/login");
 *   }
 *
 *   return <div>{children}</div>;
 * }
 * ```
 *
 * @example API Route
 * ```ts
 * // app/api/admin/users/route.ts
 * import { getNextAdminSession } from "@questpie/admin/server/adapters/nextjs";
 * import { app } from "~/questpie/server/app";
 *
 * export async function GET(request: Request) {
 *   const session = await getNextAdminSession({
 *     headers: request.headers,
 *     app,
 *   });
 *
 *   if (!session || session.user.role !== "admin") {
 *     return Response.json({ error: "Unauthorized" }, { status: 401 });
 *   }
 *
 *   // ... handle request
 * }
 * ```
 */
export async function getNextAdminSession({
	headers,
	app,
}: {
	headers: Headers;
	app: Questpie<any>;
}) {
	// Create a minimal request object for getAdminSession
	const request = new Request("http://localhost", { headers });
	return getAdminSession({ request, app });
}
