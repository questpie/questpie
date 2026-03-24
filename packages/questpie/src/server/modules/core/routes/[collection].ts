/**
 * Collection list + create + updateMany routes.
 *
 * GET   /[collection] — find (list)
 * POST  /[collection] — create
 * PATCH /[collection] — updateMany
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export const GET = route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.find(request, { collection: params.collection });
	});

export const POST = route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.create(request, { collection: params.collection });
	});

export const PATCH = route()
	.patch()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.updateMany(request, { collection: params.collection });
	});
