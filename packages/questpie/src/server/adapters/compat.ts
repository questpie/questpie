/**
 * Backward-compatibility shim for createAdapterRoutes.
 * @deprecated Use route() definitions in core module instead.
 */
import {
	createAuthRoute,
	createCollectionRoutes,
	createGlobalRoutes,
	createRealtimeRoutes,
	createSearchRoutes,
	storageCollectionServe,
	storageCollectionUpload,
} from "./routes/index.js";
import type { AdapterConfig, AdapterRoutes } from "./types.js";

/**
 * @deprecated Routes are now defined in modules/core/routes/.
 * This function is kept for backward compatibility with tests.
 */
export const createAdapterRoutes = (
	app: any,
	config: AdapterConfig = {},
): AdapterRoutes => {
	const authRoute = createAuthRoute(app);
	const collectionRoutes = createCollectionRoutes(app, config);
	const globalRoutes = createGlobalRoutes(app, config);
	const realtimeRoutes = createRealtimeRoutes(app, config);
	const searchRoutes = createSearchRoutes(app, config);

	return {
		auth: authRoute,
		collectionUpload: (request, params, context, file) =>
			storageCollectionUpload(app, request, params, context, config, file),
		collectionServe: (request, params, context) =>
			storageCollectionServe(app, request, params, context, config),
		realtime: realtimeRoutes,
		collections: collectionRoutes,
		globals: globalRoutes,
		search: searchRoutes,
	};
};
