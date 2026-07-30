/**
 * Global transition route — transition a global to a different stage.
 *
 * POST /globals/:name/transition
 */

import { globalTransition } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalTransition(app, request, { global: params.name });
	});
