/**
 * Collection update-batch route — heterogeneous bulk update by ID.
 *
 * POST /[collection]/update-batch
 */

import { collectionUpdateBatch } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionUpdateBatch(app, request, {
			collection: params.collection,
		});
	});
