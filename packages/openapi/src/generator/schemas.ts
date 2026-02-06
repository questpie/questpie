/**
 * Shared schema helpers for OpenAPI spec generation.
 * Provides $ref utilities, common schemas (pagination, errors), and Zod conversion helpers.
 */

import { z } from "zod";

/**
 * Create a $ref pointer to a component schema.
 */
export function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

/**
 * Standard error response schema.
 */
export function errorResponseSchema() {
  return {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {},
        },
        required: ["code", "message"],
      },
    },
    required: ["error"],
  };
}

/**
 * Paginated response wrapper for a given item schema.
 */
export function paginatedResponseSchema(itemRef: { $ref: string }) {
  return {
    type: "object",
    properties: {
      docs: {
        type: "array",
        items: itemRef,
      },
      totalDocs: { type: "integer" },
      limit: { type: "integer" },
      page: { type: "integer" },
      totalPages: { type: "integer" },
      hasNextPage: { type: "boolean" },
      hasPrevPage: { type: "boolean" },
      nextPage: { type: ["integer", "null"] },
      prevPage: { type: ["integer", "null"] },
    },
    required: ["docs", "totalDocs", "limit", "page", "totalPages"],
  };
}

/**
 * Common query parameters for collection list endpoints.
 */
export function listQueryParameters() {
  return [
    {
      name: "limit",
      in: "query",
      schema: { type: "integer", default: 10 },
      description: "Number of records to return",
    },
    {
      name: "page",
      in: "query",
      schema: { type: "integer", default: 1 },
      description: "Page number",
    },
    {
      name: "offset",
      in: "query",
      schema: { type: "integer" },
      description: "Number of records to skip",
    },
    {
      name: "where",
      in: "query",
      schema: { type: "string" },
      description: "Filter conditions (JSON encoded)",
    },
    {
      name: "orderBy",
      in: "query",
      schema: { type: "string" },
      description: "Sort configuration (JSON encoded)",
    },
    {
      name: "locale",
      in: "query",
      schema: { type: "string" },
      description: "Content locale",
    },
  ];
}

/**
 * Common query parameters for single-record endpoints.
 */
export function singleQueryParameters() {
  return [
    {
      name: "locale",
      in: "query",
      schema: { type: "string" },
      description: "Content locale",
    },
  ];
}

/**
 * Standard JSON responses helper.
 */
export function jsonResponse(
  schema: unknown,
  description = "Successful response",
) {
  return {
    "200": {
      description,
      content: { "application/json": { schema } },
    },
    "400": {
      description: "Bad request",
      content: { "application/json": { schema: ref("ErrorResponse") } },
    },
    "401": {
      description: "Unauthorized",
      content: { "application/json": { schema: ref("ErrorResponse") } },
    },
    "404": {
      description: "Not found",
      content: { "application/json": { schema: ref("ErrorResponse") } },
    },
  };
}

/**
 * JSON request body helper.
 */
export function jsonRequestBody(schema: unknown, description?: string) {
  return {
    description,
    required: true,
    content: { "application/json": { schema } },
  };
}

/**
 * Safely convert a Zod schema to JSON Schema.
 * Falls back to a permissive object schema on failure.
 */
export function zodToJsonSchema(schema: unknown): unknown {
  try {
    if (schema && typeof schema === "object" && "_def" in schema) {
      return z.toJSONSchema(schema as z.ZodType);
    }
  } catch {
    // Zod schema couldn't be converted (e.g. transforms, refinements)
  }
  return { type: "object", description: "Schema could not be generated" };
}

/**
 * Build the base component schemas shared across all endpoints.
 */
export function baseComponentSchemas() {
  return {
    ErrorResponse: errorResponseSchema(),
    SuccessResponse: {
      type: "object",
      properties: {
        success: { type: "boolean" },
      },
      required: ["success"],
    },
    CountResponse: {
      type: "object",
      properties: {
        count: { type: "integer" },
      },
      required: ["count"],
    },
    DeleteManyResponse: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        count: { type: "integer" },
      },
      required: ["success"],
    },
  };
}
