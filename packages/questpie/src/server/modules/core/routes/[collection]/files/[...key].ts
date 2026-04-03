/**
 * Collection file serve route — serve files from a specific collection.
 *
 * GET /[collection]/files/:key
 */

import { createStorageRoutes } from "#questpie/server/adapters/routes/storage.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.access(true)
	.handler(async ({ app, request, params }) => {
		const routes = createStorageRoutes(app);
		return routes.collectionServe(request, {
			collection: params.collection,
			key: params.key,
		});
	});
