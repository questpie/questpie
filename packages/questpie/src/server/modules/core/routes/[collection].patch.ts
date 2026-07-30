/**
 * Collection updateMany route.
 *
 * PATCH /[collection] — updateMany
 */

import { collectionUpdateMany } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.patch()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionUpdateMany(app, request, {
			collection: params.collection,
		});
	});
