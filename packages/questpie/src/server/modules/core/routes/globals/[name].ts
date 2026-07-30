/**
 * Global get route.
 *
 * GET /globals/[name] — get global value
 */

import { globalGet } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalGet(app, request, { global: params.name });
	});
