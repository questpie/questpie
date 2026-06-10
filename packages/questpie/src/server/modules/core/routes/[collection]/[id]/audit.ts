/**
 * Collection record audit route — audit log entries for a record.
 *
 * GET /[collection]/[id]/audit
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.audit(request, {
			collection: params.collection,
			id: params.id,
		});
	});
