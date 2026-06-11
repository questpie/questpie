/**
 * Collection update route.
 *
 * PATCH /[collection]/[id] — update
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.patch()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		const routes = createCollectionRoutes(app);
		return routes.update(request, {
			collection: params.collection,
			id: params.id,
		});
	});
