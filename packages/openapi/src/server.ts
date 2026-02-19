/**
 * @questpie/openapi
 *
 * Auto-generate OpenAPI 3.1 spec from QUESTPIE runtime metadata
 * and serve interactive docs via Scalar UI.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from 'questpie'
 * import { withOpenApi } from '@questpie/openapi'
 * import { app, appRpc } from './app'
 *
 * // Wrap the fetch handler — adds /openapi.json and /docs routes
 * const handler = withOpenApi(
 *   createFetchHandler(app, { basePath: '/api', rpc: appRpc }),
 *   {
 *     app,
 *     rpc: appRpc,
 *     basePath: '/api',
 *     info: { title: 'My API', version: '1.0.0' },
 *   }
 * )
 * ```
 */

import type { Questpie, RpcRouterTree } from "questpie";
import { generateOpenApiSpec as generate } from "./generator/index.js";
import { serveScalarUI } from "./scalar.js";
import type {
	OpenApiConfig,
	OpenApiSpec,
	ScalarConfig,
	WithOpenApiConfig,
} from "./types.js";

export type {
	OpenApiConfig,
	OpenApiSpec,
	ScalarConfig,
	WithOpenApiConfig,
} from "./types.js";

/**
 * Generate a complete OpenAPI 3.1 spec from a QuestPie instance and optional RPC router.
 */
export function generateOpenApiSpec(
	app: Questpie<any>,
	rpc?: RpcRouterTree<any>,
	config?: OpenApiConfig,
): OpenApiSpec {
	return generate(app, rpc, config);
}

/**
 * Create request handlers for serving the OpenAPI spec and Scalar UI.
 */
export function createOpenApiHandlers(
	spec: OpenApiSpec,
	options?: { scalar?: ScalarConfig },
) {
	return {
		/** Returns the OpenAPI spec as JSON */
		specHandler: () =>
			new Response(JSON.stringify(spec), {
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				},
			}),

		/** Returns the Scalar UI HTML page */
		scalarHandler: () => serveScalarUI(spec, options?.scalar),
	};
}

/**
 * Wrap a QuestPie fetch handler to add OpenAPI spec and Scalar UI routes.
 *
 * Intercepts requests to `{basePath}/{specPath}` and `{basePath}/{docsPath}`
 * before they reach the handler. Everything else passes through unchanged.
 *
 * @example
 * ```ts
 * const handler = withOpenApi(
 *   createFetchHandler(app, { basePath: '/api', rpc: appRpc }),
 *   {
 *     app,
 *     rpc: appRpc,
 *     basePath: '/api',
 *     info: { title: 'My API', version: '1.0.0' },
 *     scalar: { theme: 'purple' },
 *   }
 * )
 * // GET /api/openapi.json → spec JSON
 * // GET /api/docs          → Scalar UI
 * // Everything else        → handler
 * ```
 */
export function withOpenApi(
	handler: (
		request: Request,
		context?: any,
	) => Promise<Response | null> | Response | null,
	config: WithOpenApiConfig,
): (
	request: Request,
	context?: any,
) => Promise<Response | null> | Response | null {
	const {
		app,
		rpc,
		scalar,
		specPath = "openapi.json",
		docsPath = "docs",
		...openApiConfig
	} = config;

	const spec = generate(app, rpc, openApiConfig);
	const { specHandler, scalarHandler } = createOpenApiHandlers(spec, {
		scalar,
	});

	const basePath = normalizeBasePath(openApiConfig.basePath ?? "/");
	const specRoute = `${basePath}/${specPath}`;
	const docsRoute = `${basePath}/${docsPath}`;

	return (request: Request, context?: any) => {
		const url = new URL(request.url);
		const pathname = url.pathname;

		if (request.method === "GET") {
			if (pathname === specRoute) return specHandler();
			if (pathname === docsRoute) return scalarHandler();
		}

		return handler(request, context);
	};
}

function normalizeBasePath(path: string): string {
	// Remove trailing slash but keep leading slash
	return path.endsWith("/") ? path.slice(0, -1) : path;
}
