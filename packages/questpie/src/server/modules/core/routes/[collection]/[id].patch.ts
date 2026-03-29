/**
 * Collection update route.
 *
 * PATCH /[collection]/[id] — update
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.patch()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.update(request, {
			collection: params.collection,
			id: params.id,
		});
	});
