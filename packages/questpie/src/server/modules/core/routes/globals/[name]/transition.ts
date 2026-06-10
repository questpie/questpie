/**
 * Global transition route — transition a global to a different stage.
 *
 * POST /globals/:name/transition
 */

import { createGlobalRoutes } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createGlobalRoutes(app);
		return routes.transition(request, { global: params.name });
	});
