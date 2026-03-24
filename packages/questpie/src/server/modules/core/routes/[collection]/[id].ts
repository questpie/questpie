/**
 * Collection single-record routes.
 *
 * GET    /[collection]/[id] — findOne
 * PATCH  /[collection]/[id] — update
 * DELETE /[collection]/[id] — remove
 */

import { createCollectionRoutes } from "#questpie/server/adapters/routes/collections.js";
import { route } from "#questpie/server/routes/define-route.js";

export const GET = route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.findOne(request, {
			collection: params.collection,
			id: params.id,
		});
	});

export const PATCH = route()
	.patch()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.update(request, {
			collection: params.collection,
			id: params.id,
		});
	});

export const DELETE = route()
	.delete()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createCollectionRoutes(app);
		return routes.remove(request, {
			collection: params.collection,
			id: params.id,
		});
	});
