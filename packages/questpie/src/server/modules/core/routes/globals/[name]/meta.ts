/**
 * Global meta route — timestamps, versioning, localized fields.
 *
 * GET /globals/:name/meta
 */

import { globalMeta } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return globalMeta(app, request, { global: params.name });
	});
