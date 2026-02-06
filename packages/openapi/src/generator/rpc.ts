/**
 * RPC tree -> OpenAPI paths generator.
 */

import type { RpcRouterTree } from "questpie";
import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse, zodToJsonSchema } from "./schemas.js";

interface FlatRpcEntry {
  path: string;
  segments: string[];
  definition: any;
}

/**
 * Flatten an RPC router tree into a list of { path, definition }.
 */
function flattenRpcTree(
  tree: RpcRouterTree,
  prefix: string[] = [],
): FlatRpcEntry[] {
  const entries: FlatRpcEntry[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const segments = [...prefix, key];
    if (
      value &&
      typeof value === "object" &&
      "handler" in value &&
      typeof (value as any).handler === "function"
    ) {
      entries.push({
        path: segments.join("/"),
        segments,
        definition: value,
      });
    } else if (value && typeof value === "object") {
      entries.push(...flattenRpcTree(value as RpcRouterTree, segments));
    }
  }

  return entries;
}

/**
 * Generate OpenAPI paths for all RPC functions in the router tree.
 */
export function generateRpcPaths(
  rpc: RpcRouterTree | undefined,
  config: OpenApiConfig,
): {
  paths: Record<string, Record<string, PathOperation>>;
  schemas: Record<string, unknown>;
  tags: Array<{ name: string; description?: string }>;
} {
  const paths: Record<string, Record<string, PathOperation>> = {};
  const schemas: Record<string, unknown> = {};
  const tags: Array<{ name: string; description?: string }> = [];

  if (!rpc) return { paths, schemas, tags };

  const basePath = config.basePath ?? "/cms";
  const entries = flattenRpcTree(rpc);

  // Group by top-level key for tags
  const tagSet = new Set<string>();

  for (const entry of entries) {
    const def = entry.definition;
    const isRaw = def.mode === "raw";
    const topLevel = entry.segments[0] ?? "rpc";

    if (!tagSet.has(topLevel)) {
      tagSet.add(topLevel);
      tags.push({
        name: `RPC: ${topLevel}`,
        description: `RPC functions under ${topLevel}`,
      });
    }

    const operationId = `rpc_${entry.segments.join("_")}`;
    const routePath = `${basePath}/rpc/${entry.path}`;

    const operation: PathOperation = {
      operationId,
      summary: entry.path,
      tags: [`RPC: ${topLevel}`],
      responses: {},
    };

    if (isRaw) {
      // Raw functions take a raw request and return a raw response
      operation.description =
        "Raw RPC function — accepts any request body and returns a raw response.";
      operation.requestBody = {
        content: {
          "application/json": { schema: {} },
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      };
      operation.responses = {
        "200": { description: "Raw response" },
        "401": {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      };
    } else {
      // JSON functions — extract input/output schemas
      let inputSchema: unknown = {};
      let outputSchema: unknown = { type: "object" };

      if (def.schema) {
        const schemaName = `${operationId}_Input`;
        const converted = zodToJsonSchema(def.schema);
        schemas[schemaName] = converted;
        inputSchema = { $ref: `#/components/schemas/${schemaName}` };
      }

      if (def.outputSchema) {
        const schemaName = `${operationId}_Output`;
        const converted = zodToJsonSchema(def.outputSchema);
        schemas[schemaName] = converted;
        outputSchema = { $ref: `#/components/schemas/${schemaName}` };
      }

      operation.requestBody = jsonRequestBody(
        inputSchema,
        "RPC function input",
      );
      operation.responses = jsonResponse(outputSchema, "RPC function output");
    }

    paths[routePath] = { post: operation };
  }

  return { paths, schemas, tags };
}
