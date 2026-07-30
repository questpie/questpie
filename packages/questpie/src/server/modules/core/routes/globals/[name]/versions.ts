/**
 * Global versions route — version history for a global.
 *
 * GET /globals/:name/versions
 */

import { globalVersions } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalVersions(app, request, { global: params.name });
	});
