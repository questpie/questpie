import { ApiError } from "#questpie/server/errors/index.js";
import { routeApp } from "#questpie/server/routes/route-app.js";
import type { RawRouteHandlerArgs } from "#questpie/server/routes/types.js";

import { handleError } from "../../../../adapters/utils/response.js";

export async function handleAuthRoute(ctx: RawRouteHandlerArgs) {
	const { request } = ctx;
	const app = routeApp(ctx);
	if (!app.auth) {
		return handleError(ApiError.notImplemented("Authentication"), {
			request,
			app,
		});
	}
	return app.auth.handler(request);
}
