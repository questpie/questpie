/**
 * Error Codes
 * Inspired by tRPC error handling
 */
export const CMS_ERROR_CODES = {
  // Client errors (4xx)
  BAD_REQUEST: "BAD_REQUEST", // 400 - Validation, malformed input
  UNAUTHORIZED: "UNAUTHORIZED", // 401 - Missing auth
  FORBIDDEN: "FORBIDDEN", // 403 - No permission
  NOT_FOUND: "NOT_FOUND", // 404 - Resource not found
  CONFLICT: "CONFLICT", // 409 - Resource conflict
  UNPROCESSABLE_CONTENT: "UNPROCESSABLE_CONTENT", // 422 - Valid but can't process

  // Server errors (5xx)
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR", // 500 - Unspecified
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED", // 501 - Feature not enabled

  // App-specific codes
  HOOK_ERROR: "HOOK_ERROR", // 500 - Hook execution failed
  VALIDATION_ERROR: "VALIDATION_ERROR", // 400 - Field validation failed
} as const;

export type ApiErrorCode =
  (typeof CMS_ERROR_CODES)[keyof typeof CMS_ERROR_CODES];

/**
 * HTTP status mapping for error codes
 */
export const ERROR_CODE_TO_HTTP_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_CONTENT: 422,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  HOOK_ERROR: 500,
  VALIDATION_ERROR: 400,
};

/**
 * Get HTTP status code for an error code
 */
export function getHTTPStatusFromCode(code: ApiErrorCode): number {
  return ERROR_CODE_TO_HTTP_STATUS[code] || 500;
}
