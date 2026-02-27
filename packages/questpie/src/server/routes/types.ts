/**
 * Route Types
 *
 * Types for the `routes/` file convention — raw HTTP handlers for
 * webhooks, payment callbacks, OAuth redirects, and custom API endpoints.
 *
 * @see RFC-MODULE-ARCHITECTURE §5 (Routes — Raw HTTP Handlers)
 */

import type { AppContext } from "#questpie/server/config/app-context.js";

// ============================================================================
// HTTP Method
// ============================================================================

/**
 * HTTP methods supported by route handlers.
 */
export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

// ============================================================================
// Route Handler Args
// ============================================================================

/**
 * Context passed to route handlers.
 * Provides access to the raw request, session, and flat service properties.
 *
 * @see RFC-MODULE-ARCHITECTURE §5.4 (Route Handler Args)
 */
export interface RouteHandlerArgs extends AppContext {
	/** Raw incoming request. */
	request: Request;
	/** Current locale. */
	locale: string;
	/** URL path parameters (if pattern-matched). */
	params: Record<string, string>;
}

// ============================================================================
// Route Definition
// ============================================================================

/**
 * Route definition for raw HTTP handlers.
 *
 * Routes are discovered from the `routes/` directory by codegen.
 * Each file exports a route definition that maps to a URL path:
 * - `routes/health.ts` → `/api/routes/health`
 * - `routes/webhooks/stripe.ts` → `/api/routes/webhooks/stripe`
 *
 * @example
 * ```ts
 * // routes/webhooks/stripe.ts
 * import { route } from "questpie";
 *
 * export default route({
 *   method: "POST",
 *   handler: async ({ request }) => {
 *     const body = await request.text();
 *     const sig = request.headers.get("stripe-signature");
 *     // verify webhook...
 *     return new Response("ok", { status: 200 });
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // routes/health.ts — all methods (default)
 * import { route } from "questpie";
 *
 * export default route({
 *   handler: async () => {
 *     return new Response(JSON.stringify({ status: "ok" }), {
 *       headers: { "content-type": "application/json" },
 *     });
 *   },
 * });
 * ```
 *
 * @see RFC-MODULE-ARCHITECTURE §5.3 (Route Definition)
 */
export interface RouteDefinition {
	/**
	 * HTTP method(s) this route handles.
	 * - Single method: `"POST"`
	 * - Multiple methods: `["GET", "POST"]`
	 * - All methods: omit (default)
	 */
	method?: HttpMethod | HttpMethod[];

	/**
	 * Route handler — receives the raw request and returns a Response.
	 */
	handler: (args: RouteHandlerArgs) => Response | Promise<Response>;
}
