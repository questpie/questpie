/**
 * Collection remove route.
 *
 * DELETE /[collection]/[id] — remove
 */

import { collectionRemove } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.delete()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionRemove(app, request, {
			collection: params.collection,
			id: params.id,
		});
	});
