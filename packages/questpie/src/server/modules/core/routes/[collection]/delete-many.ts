/**
 * Collection delete-many route — bulk delete by filter.
 *
 * POST /[collection]/delete-many
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.deleteMany(request, { collection: params.collection });
	});
