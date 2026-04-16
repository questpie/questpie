/**
 * Route Factory
 *
 * Entry point for defining routes. Returns a builder.
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import { RouteBuilder } from "./route-builder.js";
import type { JsonRouteParams } from "./types.js";

/**
 * Define a route.
 *
 * @example
 * ```ts
 * export default route()
 *   .post()
 *   .schema(z.object({ name: z.string() }))
 *   .handler(({ input }) => ({ ok: true }));
 * ```
 */
export function route<TParams extends JsonRouteParams = JsonRouteParams>(): RouteBuilder<TParams> {
	return new RouteBuilder();
}
