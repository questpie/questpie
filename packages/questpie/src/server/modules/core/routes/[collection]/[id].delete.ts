/**
 * Collection remove route.
 *
 * DELETE /[collection]/[id] — remove
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.delete()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.remove(request, {
			collection: params.collection,
			id: params.id,
		});
	});
