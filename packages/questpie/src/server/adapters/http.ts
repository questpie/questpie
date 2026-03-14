/**
 * HTTP Adapter
 *
 * Creates fetch handlers for the app HTTP API.
 * All custom routes are served at flat URLs (no /rpc/ or /routes/ prefixes).
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import { extractAppServices } from "../config/app-context.js";
import type { Questpie } from "../config/questpie.js";
import type { QuestpieConfig } from "../config/types.js";
import { ApiError } from "../errors/index.js";
import {
	evaluateRouteAccess,
	executeJsonRoute,
	executeRawRoute,
} from "../routes/execute.js";
import { isJsonRoute, type RouteDefinition } from "../routes/types.js";

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

// Import types and utilities
import {
	createAuthRoute,
	createCollectionRoutes,
	createGlobalRoutes,
	createRealtimeRoutes,
	createSearchRoutes,
	createStorageRoutes,
} from "./routes/index.js";
import type { AdapterConfig, AdapterContext, AdapterRoutes } from "./types.js";
import { resolveContext } from "./utils/context.js";
import { handleError, normalizeBasePath } from "./utils/index.js";
import { parseRouteBody } from "./utils/request.js";
import { smartResponse } from "./utils/response.js";

// ============================================================================
// Reserved path prefixes — custom routes cannot use these
// ============================================================================

const RESERVED_PREFIXES = new Set([
	"auth",
	"search",
	"realtime",
	"storage",
	"globals",
	"health",
]);

// ============================================================================
// Route lookup map (built once at startup)
// ============================================================================

type RouteMapEntry = Map<string, RouteDefinition>;

/**
 * Build a lookup map from flat route keys to `Map<path, Map<method, RouteDefinition>>`.
 *
 * Route key formats:
 * - `"admin/stats"` → path = `admin/stats`, method from definition
 * - `"admin/stats:GET"` → path = `admin/stats`, method = `GET` (override)
 */
/**
 * Convert camelCase key segments to kebab-case for URL paths.
 * e.g. "admin/getStats" → "admin/get-stats", "createBooking" → "create-booking"
 */
function camelToKebab(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function buildRouteMap(
	routes: Record<string, RouteDefinition> | undefined,
): Map<string, RouteMapEntry> | null {
	if (!routes || Object.keys(routes).length === 0) return null;

	const map = new Map<string, RouteMapEntry>();

	for (const [key, def] of Object.entries(routes)) {
		let path: string;
		let method: string;

		const colonIdx = key.lastIndexOf(":");
		if (colonIdx > 0) {
			path = key.slice(0, colonIdx);
			method = key.slice(colonIdx + 1).toUpperCase();
		} else {
			path = key;
			method = def.method;
		}

		// Convert camelCase segments to kebab-case for URL paths
		path = path.split("/").map(camelToKebab).join("/");

		let methodMap = map.get(path);
		if (!methodMap) {
			methodMap = new Map();
			map.set(path, methodMap);
		}
		methodMap.set(method, def);
	}

	return map;
}

// ============================================================================
// Unified route dispatch
// ============================================================================

/**
 * Handle custom route dispatch for unified routes.
 * Routes are matched by path against the route map, then by HTTP method.
 *
 * URL: `/api/admin/stats` with GET → looks up path `admin/stats`, method `GET`
 *
 * Returns `null` if no route matches (allows fallback to collection CRUD).
 */
async function handleRouteDispatch<
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig>,
	routeMap: Map<string, RouteMapEntry>,
	request: Request,
	segments: string[],
	context?: AdapterContext,
): Promise<Response | null> {
	// Try progressively longer paths: "a", "a/b", "a/b/c" etc.
	const path = segments.join("/");
	const methodMap = routeMap.get(path);
	if (!methodMap) return null;

	const def = methodMap.get(request.method);
	if (!def) {
		// Path exists but method doesn't match → 405
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: Array.from(methodMap.keys()).join(", ") },
		});
	}

	// Resolve context
	const resolved = await resolveContext(app, request, config, context);
	const locale = resolved.appContext.locale ?? "en";

	// Check access
	const services = extractAppServices(app, {
		db: resolved.appContext.db ?? app.db,
		session: resolved.appContext.session,
	});

	const hasAccess = await evaluateRouteAccess(def.access, {
		...services,
		locale,
		request,
	});

	if (!hasAccess) {
		return handleError(
			ApiError.forbidden({
				operation: "read",
				resource: "route",
				reason: "Access denied",
			}),
			{ request, app, locale },
		);
	}

	try {
		if (isJsonRoute(def)) {
			const body = await parseRouteBody(request);
			if (body === null) {
				return handleError(ApiError.badRequest("Invalid JSON body"), {
					request,
					app,
					locale,
				});
			}
			const result = await executeJsonRoute(
				app,
				def,
				body,
				resolved.appContext,
			);
			return smartResponse(result, request);
		}

		// Raw route
		return await executeRawRoute(app, def, request, resolved.appContext);
	} catch (error) {
		return handleError(error, { request, app, locale });
	}
}

// ============================================================================
// Storage alias resolution
// ============================================================================

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

// ============================================================================
// Adapter route creation
// ============================================================================

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
	const collectionRoutes = createCollectionRoutes(app, config);
	const globalRoutes = createGlobalRoutes(app, config);
	const storageRoutes = createStorageRoutes(app, config);
	const realtimeRoutes = createRealtimeRoutes(app, config);
	const searchRoutes = createSearchRoutes(app, config);

	return {
		auth: authRoute,
		collectionUpload: storageRoutes.collectionUpload,
		collectionServe: storageRoutes.collectionServe,
		realtime: realtimeRoutes,
		collections: collectionRoutes,
		globals: globalRoutes,
		search: searchRoutes,
	};
};

// ============================================================================
// Main fetch handler
// ============================================================================

/**
 * Create the main fetch handler with URL routing.
 *
 * Dispatch order:
 * 1. `/health` → health check
 * 2. `/auth/*` → Better Auth
 * 3. `/search/*` → search
 * 4. `/realtime` → SSE
 * 5. `/storage/files/*` → file serving
 * 6. `/globals/:name/*` → global CRUD
 * 7. **Custom routes** → lookup from route map
 * 8. `/:collection/*` → collection CRUD (fallback)
 */
export const createFetchHandler = (
	app: unknown,
	config: AdapterConfig = {},
) => {
	const _app = app as Questpie<any>;
	const routes = createAdapterRoutes(_app, config);
	const basePath = normalizeBasePath(config.basePath ?? "/");
	const storageAliasCollection = resolveStorageAliasCollection(_app, config);

	// Build route map once at startup
	const routeMap = buildRouteMap(
		_app.config.routes as Record<string, RouteDefinition> | undefined,
	);

	const errorResponse = (error: unknown, request: Request): Response => {
		return handleError(error, { request, app: _app });
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

		// 1. Health check — public endpoint, no auth required
		if (segments[0] === "health") {
			return Response.json({
				status: "ok",
				timestamp: new Date().toISOString(),
			});
		}

		// 2. Auth routes
		if (segments[0] === "auth") {
			return routes.auth(request);
		}

		// 3. Search routes: POST /search, POST /search/reindex/:collection
		if (segments[0] === "search") {
			if (request.method === "POST") {
				if (segments[1] === "reindex" && segments[2]) {
					return routes.search.reindex(
						request,
						{ collection: segments[2] },
						context,
					);
				}
				return routes.search.search(request, {}, context);
			}
			return errorResponse(ApiError.badRequest("Method not allowed"), request);
		}

		// 4. Realtime route
		if (segments[0] === "realtime") {
			return routes.realtime.subscribe(request, {}, context);
		}

		// 5. Storage file serving
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

		// 6. Global routes
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

		// 7. Custom routes — matched before collection CRUD
		if (routeMap) {
			const routeResponse = await handleRouteDispatch(
				_app,
				config,
				routeMap,
				request,
				segments,
				context,
			);
			if (routeResponse !== null) {
				return routeResponse;
			}
		}

		// 8. Collection routes (fallback)
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

		// Collection schema: GET /:collection/schema
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
