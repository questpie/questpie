/**
 * Global versions route — version history for a global.
 *
 * GET /globals/:name/versions
 */

import { createGlobalRoutes } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createGlobalRoutes(app);
		return routes.versions(request, { global: params.name });
	});
