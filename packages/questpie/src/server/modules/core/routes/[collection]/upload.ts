/**
 * Collection upload route — file upload for upload-enabled collections.
 *
 * POST /[collection]/upload
 */

import { storageCollectionUpload } from "#questpie/server/adapters/routes/storage.js";
import type { AdapterContext } from "#questpie/server/adapters/types.js";
import { route } from "#questpie/server/routes/define-route.js";

type StorageRouteHandlerContext = AdapterContext["appContext"] &
	Pick<
		AdapterContext,
		"locale" | "session" | "localeFallback" | "stage" | "requestId" | "traceId"
	>;

export default route()
	.post()
	.raw()
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

		return storageCollectionUpload(
			ctx.app,
			ctx.request,
			{
				collection: ctx.params.collection,
			},
			adapterContext,
		);
	});
