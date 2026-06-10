/**
 * Collection record transition route — transition a record to a different stage.
 *
 * POST /[collection]/[id]/transition
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.transition(request, {
			collection: params.collection,
			id: params.id,
		});
	});
