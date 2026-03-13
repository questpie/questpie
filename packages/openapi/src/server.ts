/**
 * @questpie/openapi
 *
 * Auto-generate OpenAPI 3.1 spec from QUESTPIE runtime metadata
 * and serve interactive docs via Scalar UI.
 *
 * @example
 * ```ts
 * // questpie/server/modules.ts
 * import { adminModule } from "@questpie/admin/server";
 * import { openApiModule } from "@questpie/openapi";
 *
 * export default [
 *   adminModule,
 *   openApiModule({
 *     info: { title: "My API", version: "1.0.0" },
 *   }),
 * ] as const;
 * ```
 */

import type { Questpie } from "questpie";
import { module, route } from "questpie";
import { generateOpenApiSpec as generate } from "./generator/index.js";
import { serveScalarUI } from "./scalar.js";
import type {
	OpenApiConfig,
	OpenApiModuleConfig,
	OpenApiSpec,
	ScalarConfig,
} from "./types.js";

export type {
	OpenApiConfig,
	OpenApiModuleConfig,
	OpenApiSpec,
	ScalarConfig,
} from "./types.js";

// ============================================================================
// Spec generation utility
// ============================================================================

/**
 * Generate a complete OpenAPI 3.1 spec from a QuestPie app instance.
 * Routes are read from `app.config.routes` automatically.
 *
 * @example
 * ```ts
 * import { generateOpenApiSpec } from "@questpie/openapi";
 *
 * const spec = generateOpenApiSpec(app, {
 *   info: { title: "My API", version: "1.0.0" },
 * });
 * ```
 */
export function generateOpenApiSpec(
	app: unknown,
	config?: OpenApiConfig,
): OpenApiSpec {
	const routes = (app as any).config?.routes;
	return generate(app as any, routes, config);
}

// ============================================================================
// Lazy-cached spec — generated once per app instance, served with ETag
// ============================================================================

const specCache = new WeakMap<object, { json: string; etag: string }>();

function getCachedSpec(app: unknown, config: OpenApiConfig | undefined) {
	const appObj = app as object;
	let cached = specCache.get(appObj);
	if (!cached) {
		const spec = generateOpenApiSpec(app, config);
		const json = JSON.stringify(spec);
		// Simple hash for ETag — deterministic per spec content
		let hash = 0;
		for (let i = 0; i < json.length; i++) {
			hash = ((hash << 5) - hash + json.charCodeAt(i)) | 0;
		}
		const etag = `"oapi-${(hash >>> 0).toString(36)}"`;
		cached = { json, etag };
		specCache.set(appObj, cached);
	}
	return cached;
}

// ============================================================================
// Route factories — for file convention usage
// ============================================================================

/**
 * Create a route that serves the OpenAPI 3.1 JSON spec.
 * Place in your `routes/` directory for automatic discovery.
 *
 * Spec is lazy-generated on first request and cached with ETag.
 *
 * @example
 * ```ts title="routes/openapi-spec.ts"
 * import { openApiRoute } from "@questpie/openapi";
 *
 * export default openApiRoute({
 *   info: { title: "My API", version: "1.0.0" },
 * });
 * ```
 */
export function openApiRoute(config?: OpenApiConfig) {
	return route()
		.get()
		.raw()
		.handler(async (ctx) => {
			const app = (ctx as any).app as Questpie<any>;
			const { json, etag } = getCachedSpec(app, config);

			if (ctx.request.headers.get("if-none-match") === etag) {
				return new Response(null, { status: 304 });
			}

			return new Response(json, {
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "public, max-age=3600, stale-while-revalidate=43200",
					ETag: etag,
					"Access-Control-Allow-Origin": "*",
				},
			});
		});
}

/**
 * Create a route that serves the Scalar interactive API docs.
 * Place in your `routes/` directory for automatic discovery.
 *
 * @example
 * ```ts title="routes/docs.ts"
 * import { docsRoute } from "@questpie/openapi";
 *
 * export default docsRoute({ scalar: { theme: "purple" } });
 * ```
 */
export function docsRoute(config?: OpenApiConfig & { scalar?: ScalarConfig }) {
	const { scalar: scalarConfig, ...openApiConfig } = config ?? {};
	return route()
		.get()
		.raw()
		.handler(async (ctx) => {
			const app = (ctx as any).app as Questpie<any>;
			const spec = generateOpenApiSpec(app, openApiConfig);
			return serveScalarUI(spec, scalarConfig);
		});
}

// ============================================================================
// Module — register in modules.ts for zero-config setup
// ============================================================================

/**
 * Create an OpenAPI module that registers spec + docs routes.
 *
 * Routes are served as:
 * - `GET /api/{specPath}` — OpenAPI 3.1 JSON spec (default: `openapi.json`)
 * - `GET /api/{docsPath}` — Scalar interactive API reference (default: `docs`)
 *
 * @example
 * ```ts title="questpie/server/modules.ts"
 * import { adminModule } from "@questpie/admin/server";
 * import { openApiModule } from "@questpie/openapi";
 *
 * export default [
 *   adminModule,
 *   openApiModule({
 *     info: { title: "My API", version: "1.0.0" },
 *     scalar: { theme: "purple" },
 *   }),
 * ] as const;
 * ```
 */
export function openApiModule(config?: OpenApiModuleConfig) {
	const specKey = config?.specPath ?? "openapi.json";
	const docsKey = config?.docsPath ?? "docs";
	const { specPath: _, docsPath: __, scalar, ...openApiConfig } = config ?? {};

	return module({
		name: "questpie-openapi" as const,
		routes: {
			[specKey]: openApiRoute(openApiConfig),
			[docsKey]: docsRoute({ ...openApiConfig, scalar }),
		},
	});
}
