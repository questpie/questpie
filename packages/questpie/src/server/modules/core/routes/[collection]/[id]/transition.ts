/**
 * Collection record transition route — transition a record to a different stage.
 *
 * POST /[collection]/[id]/transition
 */

import { collectionTransition } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionTransition(app, request, {
			collection: params.collection,
			id: params.id,
		});
	});
