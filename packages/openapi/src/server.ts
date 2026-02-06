/**
 * @questpie/openapi
 *
 * Auto-generate OpenAPI 3.1 spec from QuestPie CMS runtime metadata
 * and serve interactive docs via Scalar UI.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from 'questpie'
 * import { withOpenApi } from '@questpie/openapi'
 * import { cms, appRpc } from './cms'
 *
 * // Wrap the CMS fetch handler — adds /openapi.json and /docs routes
 * const handler = withOpenApi(
 *   createFetchHandler(cms, { basePath: '/api/cms', rpc: appRpc }),
 *   {
 *     cms,
 *     rpc: appRpc,
 *     basePath: '/api/cms',
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
 * Generate a complete OpenAPI 3.1 spec from a CMS instance and optional RPC router.
 */
export function generateOpenApiSpec(
  cms: Questpie<any>,
  rpc?: RpcRouterTree<any>,
  config?: OpenApiConfig,
): OpenApiSpec {
  return generate(cms, rpc, config);
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
 * Wrap a CMS fetch handler to add OpenAPI spec and Scalar UI routes.
 *
 * Intercepts requests to `{basePath}/{specPath}` and `{basePath}/{docsPath}`
 * before they reach the CMS handler. Everything else passes through unchanged.
 *
 * @example
 * ```ts
 * const handler = withOpenApi(
 *   createFetchHandler(cms, { basePath: '/api/cms', rpc: appRpc }),
 *   {
 *     cms,
 *     rpc: appRpc,
 *     basePath: '/api/cms',
 *     info: { title: 'My API', version: '1.0.0' },
 *     scalar: { theme: 'purple' },
 *   }
 * )
 * // GET /api/cms/openapi.json → spec JSON
 * // GET /api/cms/docs          → Scalar UI
 * // Everything else            → CMS handler
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
    cms,
    rpc,
    scalar,
    specPath = "openapi.json",
    docsPath = "docs",
    ...openApiConfig
  } = config;

  const spec = generate(cms, rpc, openApiConfig);
  const { specHandler, scalarHandler } = createOpenApiHandlers(spec, {
    scalar,
  });

  const basePath = normalizeBasePath(openApiConfig.basePath ?? "/cms");
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
