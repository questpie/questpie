/**
 * Global get + update routes.
 *
 * GET  /globals/:name — get global value
 * PATCH /globals/:name — update global value
 */

import { createGlobalRoutes } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";

export const GET = route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createGlobalRoutes(app);
		return routes.get(request, { global: params.name });
	});

export const PATCH = route()
	.patch()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createGlobalRoutes(app);
		return routes.update(request, { global: params.name });
	});
