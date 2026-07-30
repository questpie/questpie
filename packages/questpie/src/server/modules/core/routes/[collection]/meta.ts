/**
 * Collection meta route — collection metadata.
 *
 * GET /[collection]/meta
 */

import { collectionMeta } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionMeta(app, request, { collection: params.collection });
	});
