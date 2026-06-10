/**
 * Global schema route — introspected schema with fields, access, validation.
 *
 * GET /globals/:name/schema
 */

import { createGlobalRoutes } from "#questpie/server/adapters/routes/globals.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.get()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createGlobalRoutes(app);
		return routes.schema(request, { global: params.name });
	});
