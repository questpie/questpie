/**
 * Collection count route.
 *
 * GET /[collection]/count
 */

import { collectionCount } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionCount(app, request, { collection: params.collection });
	});
