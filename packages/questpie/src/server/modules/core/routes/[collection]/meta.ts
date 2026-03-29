/**
 * Collection meta route — collection metadata.
 *
 * GET /[collection]/meta
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.meta(request, { collection: params.collection });
	});
