import type { ApiErrorCode } from "./codes.js";

/**
 * Field-level validation error with path support
 */
export type FieldError = {
	/** Field path (e.g., 'email', 'posts.0.title', 'settings.notifications.email') */
	path: string;
	/** Error message */
	message: string;
	/** The invalid value (optional) */
	value?: unknown;
};

/**
 * Hook execution context
 */
export type HookErrorContext = {
	hook:
		| "beforeChange"
		| "afterChange"
		| "beforeRead"
		| "afterRead"
		| "beforeValidate"
		| "beforeDelete"
		| "afterDelete"
		| "beforeOperation";
	operation: "create" | "read" | "update" | "delete";
	collection?: string;
	global?: string;
	recordId?: string;
	/** Which field triggered the error */
	fieldPath?: string;
};

/**
 * Access control error context
 */
export type AccessErrorContext = {
	operation: "create" | "read" | "update" | "delete";
	/** Collection or global name */
	resource: string;
	/** Human-readable reason */
	reason: string;
	requiredRole?: string;
	userRole?: string;
	/** For field-level access errors */
	fieldPath?: string;
};

/**
 * Database operation error context
 */
export type DBErrorContext = {
	operation: "select" | "insert" | "update" | "delete";
	table: string;
	/** FK constraint, unique constraint, etc. */
	constraint?: string;
};

/**
 * Complete error context (one of these will be set)
 */
export type ApiErrorContext = {
	hook?: HookErrorContext;
	access?: AccessErrorContext;
	db?: DBErrorContext;
	custom?: Record<string, unknown>;
};

/**
 * Error shape sent to client
 * This is the JSON structure returned in HTTP responses
 */
export type ApiErrorShape = {
	code: ApiErrorCode;
	message: string;
	fieldErrors?: FieldError[];
	context?: ApiErrorContext;
	/** Only in dev mode */
	stack?: string;
	/** Original error message (if any) */
	cause?: string;
};
