/**
 * TanStack Router Adapter
 *
 * Convenience helpers for TanStack Router/Start integration.
 *
 * @example
 * ```ts
 * import { createTanStackAuthGuard } from "@questpie/admin/server/adapters/tanstack";
 * import { app } from "~/questpie/server/app";
 *
 * export const Route = createFileRoute("/admin")({
 *   beforeLoad: createTanStackAuthGuard({ app, loginPath: "/admin/login" }),
 * });
 * ```
 */

import type { Questpie } from "questpie";
import { requireAdminAuth } from "../auth-helpers.js";

/**
 * Options for TanStack auth guard
 */
export interface TanStackAuthGuardOptions {
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
 * Context passed to TanStack Router beforeLoad
 */
export interface BeforeLoadContext {
	context: {
		request: Request;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/**
 * Create a TanStack Router beforeLoad guard for admin authentication.
 *
 * Returns a function that can be used as beforeLoad in route definitions.
 * Throws a redirect Response when authentication fails.
 *
 * @example
 * ```ts
 * import { createFileRoute } from "@tanstack/react-router";
 * import { createTanStackAuthGuard } from "@questpie/admin/server/adapters/tanstack";
 * import { app } from "~/questpie/server/app";
 *
 * export const Route = createFileRoute("/admin")({
 *   beforeLoad: createTanStackAuthGuard({
 *     app,
 *     loginPath: "/admin/login",
 *     requiredRole: "admin",
 *   }),
 *   component: AdminLayout,
 * });
 * ```
 *
 * @example With custom context
 * ```ts
 * export const Route = createFileRoute("/admin")({
 *   beforeLoad: async (ctx) => {
 *     // Run auth guard
 *     await createTanStackAuthGuard({ app })(ctx);
 *
 *     // Add additional context
 *     return { user: ctx.context.user };
 *   },
 * });
 * ```
 */
export function createTanStackAuthGuard({
	app,
	loginPath = "/admin/login",
	requiredRole = "admin",
	redirectParam = "redirect",
}: TanStackAuthGuardOptions) {
	return async function beforeLoad({ context }: BeforeLoadContext) {
		const request = context.request;

		if (!request) {
			console.warn(
				"createTanStackAuthGuard: No request in context. " +
					"Make sure you're using TanStack Start with SSR enabled.",
			);
			return;
		}

		const redirect = await requireAdminAuth({
			request,
			app,
			loginPath,
			requiredRole,
			redirectParam,
		});

		if (redirect) {
			// TanStack Router expects thrown Response for redirects
			throw redirect;
		}
	};
}

/**
 * Create a TanStack Router loader that injects the admin session into context.
 *
 * Use this when you need access to the session in your components.
 *
 * @example
 * ```ts
 * import { createTanStackSessionLoader } from "@questpie/admin/server/adapters/tanstack";
 *
 * export const Route = createFileRoute("/admin")({
 *   loader: createTanStackSessionLoader({ app }),
 *   component: AdminLayout,
 * });
 *
 * function AdminLayout() {
 *   const { session } = Route.useLoaderData();
 *   return <div>Hello {session?.user?.name}</div>;
 * }
 * ```
 */
export function createTanStackSessionLoader({ app }: { app: Questpie<any> }) {
	return async function loader({ context }: BeforeLoadContext) {
		const request = context.request;

		if (!request || !app.auth) {
			return { session: null };
		}

		try {
			const session = await app.auth.api.getSession({
				headers: request.headers,
			});

			return { session: session ?? null };
		} catch {
			return { session: null };
		}
	};
}
