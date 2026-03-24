/**
 * Storage file serve route — alias for serving files from the default upload collection.
 *
 * GET /storage/files/:key
 */

import { createStorageRoutes } from "#questpie/server/adapters/routes/storage.js";
import { ApiError } from "#questpie/server/errors/index.js";
import { route } from "#questpie/server/routes/define-route.js";

import { handleError } from "../../../../../adapters/utils/response.js";

/**
 * Resolve the default upload collection for the storage alias route.
 */
function resolveStorageCollection(app: any): {
	collection?: string;
	error?: string;
} {
	const configuredCollection = app.config?.storage?.collection;
	if (configuredCollection) {
		return { collection: configuredCollection };
	}

	const allCollections = app.getCollections();
	const uploadCollections = Object.entries(allCollections)
		.filter(([, collection]) =>
			Boolean((collection as any)?.state?.upload),
		)
		.map(([name]) => name);

	if (uploadCollections.length === 1) {
		return { collection: uploadCollections[0] };
	}

	if (uploadCollections.length === 0) {
		return {
			error: "No upload-enabled collection is registered for /storage/files alias route.",
		};
	}

	return {
		error:
			`Multiple upload-enabled collections found (${uploadCollections.join(", ")}). ` +
			"Set adapter config `storage.collection` to choose one for /storage/files.",
	};
}

export default route()
	.get()
	.raw()
	.access(true)
	.handler(async ({ app, request, params }) => {
		const key = params.key;
		if (!key) {
			return handleError(
				ApiError.badRequest("File key not specified"),
				{ request, app },
			);
		}

		const storageAlias = resolveStorageCollection(app);
		if (!storageAlias.collection) {
			return handleError(
				ApiError.badRequest(
					storageAlias.error || "Storage collection alias is not configured",
				),
				{ request, app },
			);
		}

		const routes = createStorageRoutes(app);
		return routes.collectionServe(request, {
			collection: storageAlias.collection,
			key,
		});
	});
