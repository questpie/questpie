/**
 * HTTP Adapter — Thin Dispatcher
 *
 * All routes (auth, search, realtime, storage, globals, collections, custom)
 * are compiled into a single trie-based matcher at startup.
 * Dispatch: parse URL → match → resolve context → execute → respond.
 *
 * @see QUE-273 (route migration to core module)
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import type { Questpie } from "../config/questpie.js";
import type { QuestpieConfig } from "../config/types.js";
import { ApiError } from "../errors/index.js";
import {
	executeJsonRoute,
	executeRawRoute,
} from "../routes/execute.js";
import { filePathToRoutePattern } from "../routes/file-path-convention.js";
import { compileMatcher, type RouteMatcher } from "../routes/route-matcher.js";
import { isJsonRoute, type RouteDefinition } from "../routes/types.js";

// Re-export types for backwards compatibility
export type {
	AdapterBaseContext,
	AdapterConfig,
	AdapterContext,
	AdapterRoutes,
	FetchHandler,
	UploadFile,
} from "./types.js";
export { createAdapterContext } from "./utils/context.js";
export { handleError } from "./utils/response.js";
export { createAdapterRoutes } from "./compat.js";

import type { AdapterConfig, AdapterContext } from "./types.js";
import { resolveContext } from "./utils/context.js";
import { handleError, normalizeBasePath } from "./utils/index.js";
import { parseRouteBody } from "./utils/request.js";
import { smartResponse } from "./utils/response.js";

// ============================================================================
// Route compilation
// ============================================================================

/**
 * Convert camelCase key segments to kebab-case for URL paths.
 */
function camelToKebab(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Compile all route definitions into a trie-based matcher.
 * Supports [param] and [...slug] file-path conventions.
 * Groups multiple methods on the same path pattern.
 */
function compileRoutes(
	routes: Record<string, RouteDefinition> | undefined,
): RouteMatcher<RouteDefinition> | null {
	if (!routes || Object.keys(routes).length === 0) return null;

	const entries: [string, string, RouteDefinition][] = [];

	for (const [key, def] of Object.entries(routes)) {
		let path: string;
		let methods: string[];

		const colonIdx = key.lastIndexOf(":");
		if (colonIdx > 0) {
			path = key.slice(0, colonIdx);
			methods = [key.slice(colonIdx + 1).toUpperCase()];
		} else {
			path = key;
			methods = Array.isArray(def.method) ? def.method : [def.method];
		}

		// camelCase → kebab-case, file-path convention → route pattern
		path = path.split("/").map(camelToKebab).join("/");
		const pattern = filePathToRoutePattern(path);

		for (const method of methods) {
			entries.push([pattern, method, def]);
		}
	}

	try {
		return compileMatcher(entries);
	} catch (err) {
		console.error("[HTTP] Route compilation failed:", err);
		return null;
	}
}

// ============================================================================
// Main fetch handler
// ============================================================================

/**
 * Create the main fetch handler.
 *
 * All routes (built-in + custom) are dispatched through a single
 * trie-based matcher. No hardcoded if/else chains.
 */
export const createFetchHandler = (
	app: unknown,
	config: AdapterConfig = {},
) => {
	const _app = app as Questpie<any>;
	const basePath = normalizeBasePath(config.basePath ?? "/");

	// Store adapter config on app so route handlers can access it
	// (e.g., search.reindexAccess, storage.collection)
	(_app as any)._adapterConfig = config;

	// Compile ALL routes (core module + custom module routes) into one matcher
	const matcher = compileRoutes(
		_app.config.routes as Record<string, RouteDefinition> | undefined,
	);

	return async (
		request: Request,
		context?: AdapterContext,
	): Promise<Response | null> => {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// Base path check
		const matchesBase =
			basePath === "/"
				? true
				: pathname === basePath || pathname.startsWith(`${basePath}/`);
		if (!matchesBase) return null;

		const relativePath =
			basePath === "/" ? pathname : pathname.slice(basePath.length);
		let segments = relativePath.split("/").filter(Boolean);

		// Legacy /questpie/ prefix stripping
		if (segments[0] === "questpie") {
			segments = segments.slice(1);
		}

		if (segments.length === 0) {
			return handleError(ApiError.notFound("Route"), {
				request,
				app: _app,
			});
		}

		// Match against compiled trie
		if (matcher) {
			const path = segments.join("/");
			const match = matcher.match(path);

			if (match) {
				const def = match.methods.get(request.method);

				if (!def) {
					// Path matches but method doesn't → 405
					return new Response("Method Not Allowed", {
						status: 405,
						headers: {
							Allow: Array.from(match.methods.keys()).join(", "),
						},
					});
				}

				// Resolve session, locale, and create app context
				const resolved = await resolveContext(
					_app,
					request,
					config,
					context,
				);

				try {
					if (isJsonRoute(def)) {
						const body = await parseRouteBody(request);
						if (body === null) {
							return handleError(
								ApiError.badRequest("Invalid JSON body"),
								{ request, app: _app },
							);
						}
						const result = await executeJsonRoute(
							_app,
							def,
							body,
							resolved.appContext,
						);
						return smartResponse(result, request);
					}

					// Raw route — pass matched params through
					return await executeRawRoute(
						_app,
						def,
						request,
						resolved.appContext,
						match.params,
					);
				} catch (error) {
					return handleError(error, {
						request,
						app: _app,
						locale: resolved.appContext.locale,
					});
				}
			}
		}

		// No route matched → 404
		return handleError(ApiError.notFound("Route"), {
			request,
			app: _app,
		});
	};
};
