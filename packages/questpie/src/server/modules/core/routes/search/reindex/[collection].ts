/**
 * Search reindex route — reindex a specific collection.
 *
 * POST /search/reindex/:collection
 */

import { searchReindex } from "#questpie/server/adapters/routes/search.js";
import type { AdapterConfig } from "#questpie/server/adapters/types.js";
import { route } from "#questpie/server/routes/define-route.js";
import {
	routeApp,
	routeHttpBindingConfig,
} from "#questpie/server/routes/route-app.js";

export default route()
	.post()
	.raw()
	.handler(async (ctx) => {
		const { request, params } = ctx;
		const app = routeApp(ctx);
		return searchReindex(
			app,
			request,
			{ collection: params.collection },
			undefined,
			routeHttpBindingConfig<AdapterConfig>(),
		);
	});
