/**
 * Auth catch-all route — delegates to Better Auth handler.
 *
 * ALL /auth/* → app.auth.handler(request)
 */

import { ApiError } from "#questpie/server/errors/index.js";
import { route } from "#questpie/server/routes/define-route.js";

import { handleError } from "../../../../adapters/utils/response.js";

export default route()
	.get()
	.post()
	.raw()
	.access(true)
	.handler(async ({ app, request }) => {
		if (!app.auth) {
			return handleError(ApiError.notImplemented("Authentication"), {
				request,
				app,
			});
		}
		return app.auth.handler(request);
	});
