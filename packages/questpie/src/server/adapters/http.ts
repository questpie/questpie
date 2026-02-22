/**
 * HTTP Adapter
 *
 * Creates fetch handlers for the app HTTP API.
 */

import type { Questpie } from "../config/questpie.js";
import type { QuestpieConfig } from "../config/types.js";
import { ApiError } from "../errors/index.js";

// Re-export types
export type {
	AdapterBaseContext,
	AdapterConfig,
	AdapterContext,
	AdapterRoutes,
	FetchHandler,
	UploadFile,
} from "./types.js";

// Re-export utilities for backwards compatibility
export { createAdapterContext } from "./utils/context.js";
export { handleError } from "./utils/response.js";

import {
	createAuthRoute,
	createCollectionRoutes,
	createGlobalRoutes,
	createRealtimeRoutes,
	createRpcRoutes,
	createSearchRoutes,
	createStorageRoutes,
} from "./routes/index.js";
// Import types and utilities
import type { AdapterConfig, AdapterContext, AdapterRoutes } from "./types.js";
import { handleError, normalizeBasePath } from "./utils/index.js";

function resolveStorageAliasCollection(
	app: Questpie<any>,
	config: AdapterConfig,
): { collection?: string; error?: string } {
	const configuredCollection = config.storage?.collection;
	if (
		typeof configuredCollection === "string" &&
		configuredCollection.trim().length > 0
	) {
		return { collection: configuredCollection.trim() };
	}

	const uploadCollections = Object.entries(app.getCollections())
		.filter(([, collection]) => Boolean((collection as any)?.state?.upload))
		.map(([name]) => name);

	if (uploadCollections.length === 1) {
		return { collection: uploadCollections[0] };
	}

	if (uploadCollections.length === 0) {
		return {
			error:
				"No upload-enabled collection is registered for /storage/files alias route.",
		};
	}

	return {
		error:
			`Multiple upload-enabled collections found (${uploadCollections.join(", ")}). ` +
			"Set adapter config `storage.collection` to choose one for /storage/files.",
	};
}

/**
 * Create all adapter routes
 */
export const createAdapterRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
): AdapterRoutes => {
	const authRoute = createAuthRoute(app);
	const rpcRoutes = createRpcRoutes(app, config);
	const collectionRoutes = createCollectionRoutes(app, config);
	const globalRoutes = createGlobalRoutes(app, config);
	const storageRoutes = createStorageRoutes(app, config);
	const realtimeRoutes = createRealtimeRoutes(app, config);
	const searchRoutes = createSearchRoutes(app, config);

	return {
		auth: authRoute,
		collectionUpload: storageRoutes.collectionUpload,
		collectionServe: storageRoutes.collectionServe,
		rpc: rpcRoutes,
		realtime: realtimeRoutes,
		collections: collectionRoutes,
		globals: globalRoutes,
		search: searchRoutes,
	};
};

/**
 * Create the main fetch handler with URL routing
 */
export const createFetchHandler = (
	app: Questpie<any>,
	config: AdapterConfig = {},
) => {
	const routes = createAdapterRoutes(app, config);
	const basePath = normalizeBasePath(config.basePath ?? "/");
	const storageAliasCollection = resolveStorageAliasCollection(app, config);

	/**
	 * Helper to create error response with app context for i18n
	 */
	const errorResponse = (error: unknown, request: Request): Response => {
		return handleError(error, { request, app });
	};

	return async (
		request: Request,
		context?: AdapterContext,
	): Promise<Response | null> => {
		const url = new URL(request.url);
		const pathname = url.pathname;

		const matchesBase =
			basePath === "/"
				? true
				: pathname === basePath || pathname.startsWith(`${basePath}/`);
		if (!matchesBase) {
			return null;
		}

		const relativePath =
			basePath === "/" ? pathname : pathname.slice(basePath.length);
		let segments = relativePath.split("/").filter(Boolean);

		if (segments.length === 0) {
			return errorResponse(ApiError.notFound("Route"), request);
		}

		if (segments[0] === "questpie") {
			segments = segments.slice(1);
		}

		if (segments.length === 0) {
			return errorResponse(ApiError.notFound("Route"), request);
		}

		// Auth routes
		if (segments[0] === "auth") {
			return routes.auth(request);
		}

		// Search routes: POST /search, POST /search/reindex/:collection
		if (segments[0] === "search") {
			if (request.method === "POST") {
				// Reindex route: POST /search/reindex/:collection
				if (segments[1] === "reindex" && segments[2]) {
					return routes.search.reindex(
						request,
						{ collection: segments[2] },
						context,
					);
				}
				// Main search route: POST /search
				return routes.search.search(request, {}, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Root RPC routes
		if (segments[0] === "rpc") {
			const rpcPath = segments.slice(1);
			if (rpcPath.length === 0) {
				return errorResponse(
					ApiError.badRequest("RPC path not specified"),
					request,
				);
			}

			return routes.rpc.root(request, { path: rpcPath }, context);
		}

		// Realtime route - unified POST endpoint for multiplexed subscriptions
		if (segments[0] === "realtime") {
			return routes.realtime.subscribe(request, {}, context);
		}

		// Storage file serving
		if (segments[0] === "storage" && segments[1] === "files") {
			const key = decodeURIComponent(segments.slice(2).join("/"));
			if (!key) {
				return errorResponse(
					ApiError.badRequest("File key not specified"),
					request,
				);
			}
			if (request.method === "GET") {
				if (!storageAliasCollection.collection) {
					return errorResponse(
						ApiError.badRequest(
							storageAliasCollection.error ||
								"Storage collection alias is not configured",
						),
						request,
					);
				}

				return routes.collectionServe(
					request,
					{ collection: storageAliasCollection.collection, key },
					context,
				);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Global routes
		if (segments[0] === "globals") {
			const globalName = segments[1];
			const globalAction = segments[2];
			if (!globalName) {
				return errorResponse(
					ApiError.badRequest("Global not specified"),
					request,
				);
			}

			if (globalAction === "schema") {
				if (request.method === "GET") {
					return routes.globals.schema(
						request,
						{ global: globalName },
						context,
					);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (globalAction === "meta") {
				if (request.method === "GET") {
					return routes.globals.meta(request, { global: globalName }, context);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (globalAction === "audit") {
				if (request.method === "GET") {
					return routes.globals.audit(request, { global: globalName }, context);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (globalAction === "versions") {
				if (request.method === "GET") {
					return routes.globals.versions(
						request,
						{ global: globalName },
						context,
					);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (globalAction === "revert") {
				if (request.method === "POST") {
					return routes.globals.revert(
						request,
						{ global: globalName },
						context,
					);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (globalAction === "transition") {
				if (request.method === "POST") {
					return routes.globals.transition(
						request,
						{ global: globalName },
						context,
					);
				}
				return errorResponse(
					ApiError.badRequest("Method not allowed"),
					request,
				);
			}

			if (request.method === "GET") {
				return routes.globals.get(request, { global: globalName }, context);
			}

			if (request.method === "PATCH") {
				return routes.globals.update(request, { global: globalName }, context);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection routes
		const collection = segments[0];
		const id = segments[1];
		const action = segments[2];

		// Collection upload: POST /:collection/upload
		if (id === "upload") {
			if (request.method === "POST") {
				return routes.collectionUpload(request, { collection }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection file serving: GET /:collection/files/:key
		if (id === "files" && segments[2]) {
			// Key may contain slashes, so join remaining segments
			const key = decodeURIComponent(segments.slice(2).join("/"));
			if (request.method === "GET") {
				return routes.collectionServe(request, { collection, key }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection meta: GET /:collection/meta
		if (id === "meta") {
			if (request.method === "GET") {
				return routes.collections.meta(request, { collection }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection schema: GET /:collection/schema (introspected schema for admin UI)
		if (id === "schema") {
			if (request.method === "GET") {
				return routes.collections.schema(request, { collection }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection count: GET /:collection/count
		if (id === "count") {
			if (request.method === "GET") {
				return routes.collections.count(request, { collection }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Batch delete: POST /:collection/delete-many
		if (id === "delete-many") {
			if (request.method === "POST") {
				return routes.collections.deleteMany(request, { collection }, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection list, create, and batch update
		if (!id) {
			if (request.method === "GET") {
				return routes.collections.find(request, { collection }, context);
			}

			if (request.method === "POST") {
				return routes.collections.create(request, { collection }, context);
			}

			if (request.method === "PATCH") {
				return routes.collections.updateMany(request, { collection }, context);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection restore
		if (action === "restore") {
			if (request.method === "POST") {
				return routes.collections.restore(request, { collection, id }, context);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection audit history
		if (action === "audit") {
			if (request.method === "GET") {
				return routes.collections.audit(request, { collection, id }, context);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection versions history
		if (action === "versions") {
			if (request.method === "GET") {
				return routes.collections.versions(
					request,
					{ collection, id },
					context,
				);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection version revert
		if (action === "revert") {
			if (request.method === "POST") {
				return routes.collections.revert(request, { collection, id }, context);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection workflow transition
		if (action === "transition") {
			if (request.method === "POST") {
				return routes.collections.transition(
					request,
					{ collection, id },
					context,
				);
			}

			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// Collection single record operations
		if (request.method === "GET") {
			return routes.collections.findOne(request, { collection, id }, context);
		}

		if (request.method === "PATCH") {
			return routes.collections.update(request, { collection, id }, context);
		}

		if (request.method === "DELETE") {
			return routes.collections.remove(request, { collection, id }, context);
		}

		return errorResponse(ApiError.badRequest("Method not allowed"), request);
	};
};
