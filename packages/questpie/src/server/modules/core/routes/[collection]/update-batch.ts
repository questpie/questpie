/**
 * Collection update-batch route — heterogeneous bulk update by ID.
 *
 * POST /[collection]/update-batch
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.updateBatch(request, { collection: params.collection });
	});
