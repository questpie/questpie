/**
 * Collection list route.
 *
 * GET /[collection] — find (list)
 */

import { collectionFind } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionFind(app, request, { collection: params.collection });
	});
