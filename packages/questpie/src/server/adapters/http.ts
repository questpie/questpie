/**
 * HTTP Adapter
 *
 * Creates fetch handlers for the CMS HTTP API.
 */

import type { Questpie } from "../config/cms.js";
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
	cms: Questpie<any>,
	config: AdapterConfig,
): { collection?: string; error?: string } {
	const configuredCollection = config.storage?.collection;
	if (
		typeof configuredCollection === "string" &&
		configuredCollection.trim().length > 0
	) {
		return { collection: configuredCollection.trim() };
	}

	const uploadCollections = Object.entries(cms.getCollections())
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
	cms: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
): AdapterRoutes => {
	const authRoute = createAuthRoute(cms);
	const rpcRoutes = createRpcRoutes(cms, config);
	const collectionRoutes = createCollectionRoutes(cms, config);
	const globalRoutes = createGlobalRoutes(cms, config);
	const storageRoutes = createStorageRoutes(cms, config);
	const realtimeRoutes = createRealtimeRoutes(cms, config);
	const searchRoutes = createSearchRoutes(cms, config);

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
	cms: Questpie<any>,
	config: AdapterConfig = {},
) => {
	const routes = createAdapterRoutes(cms, config);
	const basePath = normalizeBasePath(config.basePath ?? "/cms");
	const storageAliasCollection = resolveStorageAliasCollection(cms, config);

	/**
	 * Helper to create error response with CMS context for i18n
	 */
	const errorResponse = (error: unknown, request: Request): Response => {
		return handleError(error, { request, cms });
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

		if (segments[0] === "cms") {
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

		// Collection RPC routes
		if (segments[0] === "collections" && segments[2] === "rpc") {
			const collectionName = segments[1];
			const functionName = segments[3];
			if (!collectionName) {
				return errorResponse(
					ApiError.badRequest("Collection not specified"),
					request,
				);
			}
			if (!functionName) {
				return errorResponse(
					ApiError.badRequest("Function not specified"),
					request,
				);
			}

			return routes.rpc.collection(
				request,
				{ collection: collectionName, name: functionName },
				context,
			);
		}

		// Global RPC routes
		if (segments[0] === "globals" && segments[2] === "rpc") {
			const globalName = segments[1];
			const functionName = segments[3];
			if (!globalName) {
				return errorResponse(
					ApiError.badRequest("Global not specified"),
					request,
				);
			}
			if (!functionName) {
				return errorResponse(
					ApiError.badRequest("Function not specified"),
					request,
				);
			}

			return routes.rpc.global(
				request,
				{ global: globalName, name: functionName },
				context,
			);
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
