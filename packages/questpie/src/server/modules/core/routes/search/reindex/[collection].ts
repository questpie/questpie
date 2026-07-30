/**
 * Search reindex route — reindex a specific collection.
 *
 * POST /search/reindex/:collection
 */

import { searchReindex } from "#questpie/server/adapters/routes/search.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		// This route is the only one that fed the factory a config, so the
		// config has to be threaded explicitly rather than left to default.
		return searchReindex(
			app,
			request,
			{ collection: params.collection },
			undefined,
			(app as any)._adapterConfig,
		);
	});
