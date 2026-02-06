/**
 * HTTP Response Utilities
 *
 * Utilities for creating HTTP responses with proper serialization.
 */

import superjson from "superjson";
import { ZodError } from "zod";
import type { Questpie } from "../../config/cms.js";
import { ApiError, parseDatabaseError } from "../../errors/index.js";

export const jsonHeaders = {
  "Content-Type": "application/json",
};

export const superjsonHeaders = {
  "Content-Type": "application/superjson+json",
};

export const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Detect if client supports SuperJSON serialization
 */
export const supportsSuperJSON = (request: Request): boolean => {
  const xSuperJSON = request.headers.get("X-SuperJSON");
  const accept = request.headers.get("Accept");
  const contentType = request.headers.get("Content-Type");

  return (
    xSuperJSON === "1" ||
    accept?.includes("application/superjson+json") ||
    contentType?.includes("application/superjson+json") ||
    false
  );
};

/**
 * Smart response that uses SuperJSON when client supports it
 */
export const smartResponse = (
  data: unknown,
  request: Request,
  status = 200,
) => {
  const useSuperJSON = supportsSuperJSON(request);

  const body = useSuperJSON ? superjson.stringify(data) : JSON.stringify(data);
  const headers = useSuperJSON ? superjsonHeaders : jsonHeaders;

  return new Response(body, { status, headers });
};

/**
 * Detect if we're in development mode
 */
export const isDevelopment = () => {
  try {
    return process?.env?.NODE_ENV === "development";
  } catch {
    return false;
  }
};

/**
 * Options for handleError function
 */
export type HandleErrorOptions = {
  request?: Request;
  isDev?: boolean;
  cms?: Questpie<any>;
  locale?: string;
};

/**
 * Handle errors and convert to HTTP Response
 * Supports ApiError, ZodError, and generic Error
 * Optionally translates error messages when cms and locale are provided
 */
export const handleError = (
  error: unknown,
  options: HandleErrorOptions = {},
): Response => {
  const { request, isDev = isDevelopment(), cms, locale } = options;
  const translator = cms?.t;

  // If it's our ApiError, use it directly
  if (error instanceof ApiError) {
    const errorData = { error: error.toJSON(isDev, translator, locale) };
    if (request && supportsSuperJSON(request)) {
      return new Response(superjson.stringify(errorData), {
        status: error.getHTTPStatus(),
        headers: superjsonHeaders,
      });
    }
    return new Response(JSON.stringify(errorData), {
      status: error.getHTTPStatus(),
      headers: jsonHeaders,
    });
  }

  // If it's ZodError, convert to ApiError
  if (error instanceof ZodError) {
    const cmsError = ApiError.fromZodError(error);
    const errorData = { error: cmsError.toJSON(isDev, translator, locale) };
    if (request && supportsSuperJSON(request)) {
      return new Response(superjson.stringify(errorData), {
        status: cmsError.getHTTPStatus(),
        headers: superjsonHeaders,
      });
    }
    return new Response(JSON.stringify(errorData), {
      status: cmsError.getHTTPStatus(),
      headers: jsonHeaders,
    });
  }

  // Check if it's a database constraint violation
  const dbError = parseDatabaseError(error);
  if (dbError) {
    const errorData = { error: dbError.toJSON(isDev, translator, locale) };
    if (request && supportsSuperJSON(request)) {
      return new Response(superjson.stringify(errorData), {
        status: dbError.getHTTPStatus(),
        headers: superjsonHeaders,
      });
    }
    return new Response(JSON.stringify(errorData), {
      status: dbError.getHTTPStatus(),
      headers: jsonHeaders,
    });
  }

  // Unknown error - wrap it as INTERNAL_SERVER_ERROR
  const message = error instanceof Error ? error.message : "Unknown error";
  const wrappedError = ApiError.internal(message, error);
  const errorData = { error: wrappedError.toJSON(isDev, translator, locale) };

  if (request && supportsSuperJSON(request)) {
    return new Response(superjson.stringify(errorData), {
      status: wrappedError.getHTTPStatus(),
      headers: superjsonHeaders,
    });
  }
  return new Response(JSON.stringify(errorData), {
    status: wrappedError.getHTTPStatus(),
    headers: jsonHeaders,
  });
};
