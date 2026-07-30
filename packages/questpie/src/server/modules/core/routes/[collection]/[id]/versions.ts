/**
 * Collection record versions route — version history for a record.
 *
 * GET /[collection]/[id]/versions
 */

import { collectionVersions } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.get()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return collectionVersions(app, request, {
			collection: params.collection,
			id: params.id,
		});
	});
