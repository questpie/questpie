/**
 * Collection count route.
 *
 * GET /[collection]/count
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.count(request, { collection: params.collection });
	});
