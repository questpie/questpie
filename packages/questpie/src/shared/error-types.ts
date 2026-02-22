/**
 * Shared error types for both server and client
 * These types are safe to use on the client-side
 */

export type { ApiErrorCode } from "../server/errors/codes.js";
export { CMS_ERROR_CODES } from "../server/errors/codes.js";
// Re-export types that client needs
export type {
	AccessErrorContext,
	ApiErrorContext,
	ApiErrorShape,
	DBErrorContext,
	FieldError,
	HookErrorContext,
} from "../server/errors/types.js";
