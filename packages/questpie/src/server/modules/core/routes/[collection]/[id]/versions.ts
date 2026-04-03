/**
 * Collection record versions route — version history for a record.
 *
 * GET /[collection]/[id]/versions
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.versions(request, {
			collection: params.collection,
			id: params.id,
		});
	});
