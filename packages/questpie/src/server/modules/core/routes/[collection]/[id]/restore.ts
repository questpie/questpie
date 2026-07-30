/**
 * Collection record restore route — restore a soft-deleted record.
 *
 * POST /[collection]/[id]/restore
 */

import { collectionRestore } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionRestore(app, request, {
			collection: params.collection,
			id: params.id,
		});
	});
