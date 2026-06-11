/**
 * Collection file serve route — serve files from a specific collection.
 *
 * GET /[collection]/files/:key
 */

import { storageCollectionServe } from "#questpie/server/adapters/routes/storage.js";
import type { AdapterContext } from "#questpie/server/adapters/types.js";
import { route } from "#questpie/server/routes/define-route.js";
import { routeApp } from "#questpie/server/routes/route-app.js";

type StorageRouteHandlerContext = AdapterContext["appContext"] &
	Pick<
		AdapterContext,
		"locale" | "session" | "localeFallback" | "stage" | "requestId" | "traceId"
	>;

export default route()
	.get()
	.raw()
	.access(true)
	.handler(async (ctx) => {
		const routeContext = ctx as unknown as StorageRouteHandlerContext;
		const adapterContext: AdapterContext = {
			appContext: routeContext,
			locale: routeContext.locale,
			session: routeContext.session,
			localeFallback: routeContext.localeFallback,
			stage: routeContext.stage,
			requestId: routeContext.requestId,
			traceId: routeContext.traceId,
		};

		return storageCollectionServe(
			routeApp(ctx),
			ctx.request,
			{
				collection: ctx.params.collection,
				key: ctx.params.key,
			},
			adapterContext,
		);
	});
