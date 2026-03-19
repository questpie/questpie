/**
 * @questpie/openapi
 *
 * Auto-generate OpenAPI 3.1 spec from QUESTPIE runtime metadata
 * and serve interactive docs via Scalar UI.
 *
 * @example
 * ```ts
 * // questpie/server/modules.ts
 * import { openApiModule } from "@questpie/openapi";
 *
 * export default [
 *   openApiModule,
 * ] as const;
 * ```
 *
 * Then configure in `config/openapi.ts`:
 * ```ts
 * import { openApiConfig } from "@questpie/openapi";
 *
 * export default openApiConfig({
 *   info: { title: "My API", version: "1.0.0" },
 * });
 * ```
 */

import type { Questpie } from "questpie";
import { module, route } from "questpie";

import { openApiPlugin } from "./plugin.js";
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
// Config factory
// ============================================================================

/**
 * Identity factory for `config/openapi.ts` — provides type inference.
 *
 * @example
 * ```ts
 * // config/openapi.ts
 * import { openApiConfig } from "@questpie/openapi";
 *
 * export default openApiConfig({
 *   info: { title: "My API", version: "1.0.0" },
 *   scalar: { theme: "purple" },
 * });
 * ```
 */
export function openApiConfig(
	config: OpenApiModuleConfig,
): OpenApiModuleConfig {
	return config;
}

// ============================================================================
// Spec generation utility
// ============================================================================

/**
 * Generate a complete OpenAPI 3.1 spec from a QUESTPIE app instance.
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

/**
 * Read OpenAPI config from `app.state.config.openapi` (set via config/openapi.ts).
 * Falls back to explicit config parameter if provided.
 */
function resolveOpenApiConfig(
	app: Questpie<any>,
	explicitConfig?: OpenApiConfig,
): OpenApiModuleConfig | undefined {
	if (explicitConfig) return explicitConfig;
	return (app.state?.config as any)?.openapi as
		| OpenApiModuleConfig
		| undefined;
}

// ============================================================================
// Route factories — for file convention usage
// ============================================================================

/**
 * Create a route that serves the OpenAPI 3.1 JSON spec.
 * Place in your `routes/` directory for automatic discovery.
 *
 * Spec is lazy-generated on first request and cached with ETag.
 * Config is read from `config/openapi.ts` at request time, or from
 * explicit parameter if provided.
 *
 * @example
 * ```ts title="routes/openapi-spec.ts"
 * import { openApiRoute } from "@questpie/openapi";
 *
 * export default openApiRoute();
 * ```
 */
export function openApiRoute(config?: OpenApiConfig) {
	return route()
		.get()
		.raw()
		.handler(async (ctx) => {
			const app = (ctx as any).app as Questpie<any>;
			const resolved = resolveOpenApiConfig(app, config);
			const { json, etag } = getCachedSpec(app, resolved);

			if (ctx.request.headers.get("if-none-match") === etag) {
				return new Response(null, { status: 304 });
			}

			return new Response(json, {
				headers: {
					"Content-Type": "application/json",
					"Cache-Control":
						"public, max-age=3600, stale-while-revalidate=43200",
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
 * export default docsRoute();
 * ```
 */
export function docsRoute(config?: OpenApiConfig & { scalar?: ScalarConfig }) {
	const { scalar: scalarConfig, ...openApiConfig } = config ?? {};
	return route()
		.get()
		.raw()
		.handler(async (ctx) => {
			const app = (ctx as any).app as Questpie<any>;
			const resolved = resolveOpenApiConfig(app, openApiConfig);
			const scalarOpts =
				scalarConfig ?? (resolved as OpenApiModuleConfig)?.scalar;
			const spec = generateOpenApiSpec(app, resolved);
			return serveScalarUI(spec, scalarOpts);
		});
}

// ============================================================================
// Module — static plain object, register in modules.ts
// ============================================================================

/**
 * OpenAPI module — registers spec + docs routes.
 *
 * Routes are served as:
 * - `GET /api/openapi.json` — OpenAPI 3.1 JSON spec
 * - `GET /api/docs` — Scalar interactive API reference
 *
 * Configure via `config/openapi.ts`:
 * ```ts
 * import { openApiConfig } from "@questpie/openapi";
 * export default openApiConfig({ info: { title: "My API", version: "1.0.0" } });
 * ```
 *
 * Or pass config directly for backward compatibility:
 * ```ts
 * openApiModule({ info: { title: "My API" } })
 * ```
 *
 * @example Static (reads config from config/openapi.ts):
 * ```ts title="questpie/server/modules.ts"
 * import { openApiModule } from "@questpie/openapi";
 * export default [openApiModule] as const;
 * ```
 */
export const openApiModule = module({
	name: "questpie-openapi" as const,
	plugin: openApiPlugin(),
	routes: {
		"openapi.json": openApiRoute(),
		docs: docsRoute(),
	},
});

export default openApiModule;
