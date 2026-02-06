/**
 * Collection CRUD -> OpenAPI paths generator.
 */

import { z } from "zod";
import type { Questpie } from "questpie";
import type { OpenApiConfig, PathOperation } from "../types.js";
import {
  jsonRequestBody,
  jsonResponse,
  listQueryParameters,
  paginatedResponseSchema,
  ref,
  singleQueryParameters,
} from "./schemas.js";

/**
 * Generate OpenAPI paths and component schemas for all collections.
 */
export function generateCollectionPaths(
  cms: Questpie<any>,
  config: OpenApiConfig,
): {
  paths: Record<string, Record<string, PathOperation>>;
  schemas: Record<string, unknown>;
  tags: Array<{ name: string; description?: string }>;
} {
  const collections = cms.getCollections();
  const basePath = config.basePath ?? "/cms";
  const excluded = new Set(config.exclude?.collections ?? []);
  const paths: Record<string, Record<string, PathOperation>> = {};
  const schemas: Record<string, unknown> = {};
  const tags: Array<{ name: string; description?: string }> = [];

  for (const [name, collection] of Object.entries(collections)) {
    if (excluded.has(name)) continue;

    const state = (collection as any).state;
    if (!state) continue;

    const tag = `Collections: ${name}`;
    tags.push({ name: tag, description: `CRUD operations for ${name}` });

    // Generate schemas from validation
    const pascalName = toPascalCase(name);
    const documentSchemaName = `${pascalName}Document`;
    const insertSchemaName = `${pascalName}Insert`;
    const updateSchemaName = `${pascalName}Update`;

    // Document schema (response shape) — from validation.insertSchema or field definitions
    if (state.validation?.insertSchema) {
      try {
        schemas[insertSchemaName] = z.toJSONSchema(
          state.validation.insertSchema,
        );
      } catch {
        schemas[insertSchemaName] = {
          type: "object",
          description: `Insert schema for ${name}`,
        };
      }
    } else {
      schemas[insertSchemaName] = {
        type: "object",
        description: `Insert schema for ${name}`,
      };
    }

    if (state.validation?.updateSchema) {
      try {
        schemas[updateSchemaName] = z.toJSONSchema(
          state.validation.updateSchema,
        );
      } catch {
        schemas[updateSchemaName] = {
          type: "object",
          description: `Update schema for ${name}`,
        };
      }
    } else {
      schemas[updateSchemaName] = {
        type: "object",
        description: `Update schema for ${name}`,
      };
    }

    // Document schema — the response shape, includes id + timestamps
    schemas[documentSchemaName] = buildDocumentSchema(
      name,
      state,
      insertSchemaName,
    );

    const prefix = `${basePath}/${name}`;

    // GET /{collection} — list
    // POST /{collection} — create
    paths[prefix] = {
      get: {
        operationId: `${name}_find`,
        summary: `List ${name}`,
        tags: [tag],
        parameters: listQueryParameters(),
        responses: jsonResponse(
          paginatedResponseSchema(ref(documentSchemaName)),
          `Paginated list of ${name}`,
        ),
      },
      post: {
        operationId: `${name}_create`,
        summary: `Create ${name}`,
        tags: [tag],
        requestBody: jsonRequestBody(ref(insertSchemaName)),
        responses: jsonResponse(
          ref(documentSchemaName),
          `Created ${name} record`,
        ),
      },
    };

    // GET /{collection}/count
    paths[`${prefix}/count`] = {
      get: {
        operationId: `${name}_count`,
        summary: `Count ${name}`,
        tags: [tag],
        parameters: [
          {
            name: "where",
            in: "query",
            schema: { type: "string" },
            description: "Filter conditions (JSON encoded)",
          },
        ],
        responses: jsonResponse(ref("CountResponse"), `Count of ${name}`),
      },
    };

    // POST /{collection}/delete-many
    paths[`${prefix}/delete-many`] = {
      post: {
        operationId: `${name}_deleteMany`,
        summary: `Delete many ${name}`,
        tags: [tag],
        requestBody: jsonRequestBody({
          type: "object",
          properties: {
            where: {
              type: "object",
              description: "Filter conditions for records to delete",
            },
          },
        }),
        responses: jsonResponse(
          ref("DeleteManyResponse"),
          `Delete multiple ${name} records`,
        ),
      },
    };

    // POST /{collection}/upload (if upload is configured)
    if (state.upload) {
      paths[`${prefix}/upload`] = {
        post: {
          operationId: `${name}_upload`,
          summary: `Upload file to ${name}`,
          tags: [tag],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: jsonResponse(
            ref(documentSchemaName),
            `Uploaded file record`,
          ),
        },
      };
    }

    // GET /{collection}/schema
    paths[`${prefix}/schema`] = {
      get: {
        operationId: `${name}_schema`,
        summary: `Get ${name} introspection schema`,
        tags: [tag],
        responses: jsonResponse(
          { type: "object", description: "Introspected collection schema" },
          `Introspection schema for ${name}`,
        ),
      },
    };

    // GET /{collection}/meta
    paths[`${prefix}/meta`] = {
      get: {
        operationId: `${name}_meta`,
        summary: `Get ${name} metadata`,
        tags: [tag],
        responses: jsonResponse(
          { type: "object", description: "Collection metadata" },
          `Metadata for ${name}`,
        ),
      },
    };

    const idParam = {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
      description: "Record ID",
    };

    // GET /{collection}/{id}
    // PATCH /{collection}/{id}
    // DELETE /{collection}/{id}
    paths[`${prefix}/{id}`] = {
      get: {
        operationId: `${name}_findOne`,
        summary: `Get ${name} by ID`,
        tags: [tag],
        parameters: [idParam, ...singleQueryParameters()],
        responses: jsonResponse(
          ref(documentSchemaName),
          `Single ${name} record`,
        ),
      },
      patch: {
        operationId: `${name}_update`,
        summary: `Update ${name}`,
        tags: [tag],
        parameters: [idParam],
        requestBody: jsonRequestBody(ref(updateSchemaName)),
        responses: jsonResponse(
          ref(documentSchemaName),
          `Updated ${name} record`,
        ),
      },
      delete: {
        operationId: `${name}_delete`,
        summary: `Delete ${name}`,
        tags: [tag],
        parameters: [idParam],
        responses: jsonResponse(
          ref("SuccessResponse"),
          `Deleted ${name} record`,
        ),
      },
    };

    // POST /{collection}/{id}/restore (if softDelete is enabled)
    if (state.options?.softDelete) {
      paths[`${prefix}/{id}/restore`] = {
        post: {
          operationId: `${name}_restore`,
          summary: `Restore deleted ${name}`,
          tags: [tag],
          parameters: [idParam],
          responses: jsonResponse(
            ref(documentSchemaName),
            `Restored ${name} record`,
          ),
        },
      };
    }
  }

  return { paths, schemas, tags };
}

/**
 * Build a document response schema that extends the insert schema with
 * standard fields (id, timestamps).
 */
function buildDocumentSchema(
  name: string,
  state: any,
  insertSchemaName: string,
) {
  const properties: Record<string, unknown> = {
    id: { type: "string" },
  };

  if (state.options?.timestamps !== false) {
    properties.createdAt = { type: "string", format: "date-time" };
    properties.updatedAt = { type: "string", format: "date-time" };
  }

  if (state.options?.softDelete) {
    properties.deletedAt = {
      type: ["string", "null"],
      format: "date-time",
    };
  }

  return {
    allOf: [
      { type: "object", properties, required: ["id"] },
      ref(insertSchemaName),
    ],
    description: `${name} document`,
  };
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}
