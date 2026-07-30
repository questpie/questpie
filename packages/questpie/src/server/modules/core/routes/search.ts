/**
 * Search route — POST search across collections.
 *
 * POST /search
 */

import { searchSearch } from "#questpie/server/adapters/routes/search.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request } = ctx;
		const app = routeApp(ctx);
		return searchSearch(app, request, {} as Record<string, never>);
	});
