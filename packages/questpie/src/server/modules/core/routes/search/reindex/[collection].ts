/**
 * Search reindex route — reindex a specific collection.
 *
 * POST /search/reindex/:collection
 */

import { createSearchRoutes } from "#questpie/server/adapters/routes/search.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		const routes = createSearchRoutes(app, (app as any)._adapterConfig);
		return routes.reindex(request, {
			collection: params.collection,
		});
	});
