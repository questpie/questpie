/**
 * Route Factory
 *
 * Identity function for defining raw HTTP route handlers with type safety.
 *
 * @see RFC-MODULE-ARCHITECTURE §5.3 (Route Definition)
 */

import type { RouteDefinition } from "./types.js";

/**
 * Define a raw HTTP route handler.
 *
 * Routes are discovered from the `routes/` directory by codegen and mapped
 * to URL paths based on the file path:
 * - `routes/health.ts` → `GET /api/routes/health`
 * - `routes/webhooks/stripe.ts` → `POST /api/routes/webhooks/stripe`
 *
 * @example
 * ```ts
 * // routes/webhooks/stripe.ts
 * import { route } from "questpie";
 *
 * export default route({
 *   method: "POST",
 *   handler: async ({ request, app }) => {
 *     const body = await request.text();
 *     return new Response("ok", { status: 200 });
 *   },
 * });
 * ```
 *
 * @see RFC-MODULE-ARCHITECTURE §5.3 (Route Definition)
 */
export function route<T extends RouteDefinition>(definition: T): T {
	return definition;
}
