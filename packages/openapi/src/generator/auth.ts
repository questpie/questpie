/**
 * Auth routes -> OpenAPI paths generator.
 * Documents common Better Auth endpoints.
 */

import type { OpenApiConfig, PathOperation } from "../types.js";
import { jsonRequestBody, jsonResponse } from "./schemas.js";

/**
 * Generate OpenAPI paths for Better Auth endpoints.
 */
export function generateAuthPaths(config: OpenApiConfig): {
  paths: Record<string, Record<string, PathOperation>>;
  tags: Array<{ name: string; description?: string }>;
} {
  if (config.auth === false) {
    return { paths: {}, tags: [] };
  }

  const basePath = config.basePath ?? "/cms";
  const tag = "Auth";
  const paths: Record<string, Record<string, PathOperation>> = {};

  // POST /auth/sign-in/email
  paths[`${basePath}/auth/sign-in/email`] = {
    post: {
      operationId: "auth_signInEmail",
      summary: "Sign in with email and password",
      tags: [tag],
      requestBody: jsonRequestBody({
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
        required: ["email", "password"],
      }),
      responses: jsonResponse(
        {
          type: "object",
          properties: {
            user: { type: "object" },
            session: { type: "object" },
          },
        },
        "Authentication successful",
      ),
    },
  };

  // POST /auth/sign-up/email
  paths[`${basePath}/auth/sign-up/email`] = {
    post: {
      operationId: "auth_signUpEmail",
      summary: "Sign up with email and password",
      tags: [tag],
      requestBody: jsonRequestBody({
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
          name: { type: "string" },
        },
        required: ["email", "password", "name"],
      }),
      responses: jsonResponse(
        {
          type: "object",
          properties: {
            user: { type: "object" },
            session: { type: "object" },
          },
        },
        "Registration successful",
      ),
    },
  };

  // GET /auth/get-session
  paths[`${basePath}/auth/get-session`] = {
    get: {
      operationId: "auth_getSession",
      summary: "Get current session",
      tags: [tag],
      responses: jsonResponse(
        {
          type: "object",
          properties: {
            user: { type: "object" },
            session: { type: "object" },
          },
        },
        "Current session",
      ),
    },
  };

  // POST /auth/sign-out
  paths[`${basePath}/auth/sign-out`] = {
    post: {
      operationId: "auth_signOut",
      summary: "Sign out",
      tags: [tag],
      responses: jsonResponse(
        { type: "object", properties: { success: { type: "boolean" } } },
        "Signed out",
      ),
    },
  };

  return {
    paths,
    tags: [
      { name: tag, description: "Authentication endpoints (Better Auth)" },
    ],
  };
}
