import type { Questpie, RpcRouterTree } from "questpie";

/**
 * Configuration for OpenAPI spec generation.
 */
export interface OpenApiConfig {
  /** OpenAPI info object */
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  /** Server definitions */
  servers?: Array<{ url: string; description?: string }>;
  /** Base path for CMS routes (must match your adapter basePath) */
  basePath?: string;
  /** Exclude specific collections or globals from the spec */
  exclude?: {
    collections?: string[];
    globals?: string[];
  };
  /** Include auth endpoints in the spec */
  auth?: boolean;
  /** Include search endpoints in the spec */
  search?: boolean;
}

/**
 * Scalar UI configuration options.
 */
export interface ScalarConfig {
  /** Theme for Scalar UI */
  theme?: string;
  /** Page title override */
  title?: string;
  /** Custom CSS */
  customCss?: string;
  /** Hide the "Download OpenAPI Spec" button */
  hideDownloadButton?: boolean;
  /** Default HTTP client for code samples */
  defaultHttpClient?: {
    targetKey: string;
    clientKey: string;
  };
}

/**
 * Configuration for withOpenApi() handler wrapper.
 */
export interface WithOpenApiConfig extends OpenApiConfig {
  /** CMS instance */
  cms: Questpie<any>;
  /** RPC router tree (same one passed to createFetchHandler) */
  rpc?: RpcRouterTree<any>;
  /** Scalar UI options */
  scalar?: ScalarConfig;
  /** Path for the JSON spec (relative to basePath, default: "openapi.json") */
  specPath?: string;
  /** Path for the Scalar UI docs (relative to basePath, default: "docs") */
  docsPath?: string;
}

/**
 * OpenAPI 3.1 spec (simplified type — full spec is a plain object).
 */
export type OpenApiSpec = {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, PathOperation>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
};

export interface PathOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
}
