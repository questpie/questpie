/**
 * Shared error types for both server and client
 * These types are safe to use on the client-side
 */

// Re-export types that client needs
export type {
	CMSErrorShape,
	FieldError,
	CMSErrorContext,
	HookErrorContext,
	AccessErrorContext,
	DBErrorContext,
} from "../server/errors/types";

export type { CMSErrorCode } from "../server/errors/codes";

export { CMS_ERROR_CODES } from "../server/errors/codes";
