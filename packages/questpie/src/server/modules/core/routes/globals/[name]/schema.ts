/**
 * Global schema route — introspected schema with fields, access, validation.
 *
 * GET /globals/:name/schema
 */

import { createGlobalRoutes } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		const routes = createGlobalRoutes(app);
		return routes.schema(request, { global: params.name });
	});
