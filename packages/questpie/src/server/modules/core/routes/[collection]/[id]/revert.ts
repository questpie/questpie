/**
 * Collection record revert route — revert a record to a previous version.
 *
 * POST /[collection]/[id]/revert
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		const routes = createCollectionRoutes(app);
		return routes.revert(request, {
			collection: params.collection,
			id: params.id,
		});
	});
