/**
 * Global update route.
 *
 * PATCH /globals/[name] — update global value
 */

import { globalUpdate } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.patch()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalUpdate(app, request, { global: params.name });
	});
