/**
 * Collection upload route — file upload for upload-enabled collections.
 *
 * POST /[collection]/upload
 */

import { createStorageRoutes } from "#questpie/server/adapters/routes/storage.js";
import { route } from "#questpie/server/routes/define-route.js";

export default route()
	.post()
	.raw()
	.handler(async ({ app, request, params }) => {
		const routes = createStorageRoutes(app);
		return routes.collectionUpload(request, {
			collection: params.collection,
		});
	});
