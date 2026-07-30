/**
 * Global revert route — revert a global to a previous version.
 *
 * POST /globals/:name/revert
 */

import { globalRevert } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalRevert(app, request, { global: params.name });
	});
