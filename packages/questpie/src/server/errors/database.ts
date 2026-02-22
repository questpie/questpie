/**
 * Database Error Detection and Transformation
 *
 * Detects database constraint violations and transforms them into
 * proper ApiError instances with field-level error details.
 */

import { ApiError } from "./base.js";
import type { DBErrorContext, FieldError } from "./types.js";

/**
 * PostgreSQL error codes
 * See: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_CODES = {
	UNIQUE_VIOLATION: "23505",
	FOREIGN_KEY_VIOLATION: "23503",
	NOT_NULL_VIOLATION: "23502",
	CHECK_VIOLATION: "23514",
} as const;

/**
 * Unwrap error to find the root cause
 * Drizzle ORM and other libraries wrap the original error
 */
const unwrapError = (error: unknown): unknown => {
	if (!error || typeof error !== "object") return error;

	const err = error as any;

	// Try to find nested error in common properties
	if (err.cause) return unwrapError(err.cause);
	if (err.original) return unwrapError(err.original);
	if (err.originalError) return unwrapError(err.originalError);

	return error;
};

/**
 * Check if error is a database error
 */
const isDatabaseError = (error: unknown): error is any => {
	if (!error || typeof error !== "object") return false;

	const err = error as any;

	// Check if error has PostgreSQL error code
	// Different drivers use different property names:
	// - Bun's postgres: errno (preferred - contains actual PG code like "23505")
	// - node-postgres: code (contains actual PG code)
	// Try errno first because some drivers have both errno and a wrapper code
	const pgCode = err.errno || err.code;
	// PostgreSQL error codes are exactly 5 characters (e.g., "23505")
	return typeof pgCode === "string" && /^\d{5}$/.test(pgCode);
};

/**
 * Extract field name from constraint name
 * Examples:
 * - "barbers_email_unique" -> "email"
 * - "users_email_key" -> "email"
 * - "posts_author_id_fkey" -> "authorId"
 */
const extractFieldFromConstraint = (constraint: string): string | null => {
	// Remove table prefix (everything before first underscore + underscore)
	const parts = constraint.split("_");
	if (parts.length < 2) return null;

	// Remove constraint suffix (_unique, _key, _fkey, _check, etc.)
	const suffixes = ["unique", "key", "fkey", "pkey", "check"];
	const fieldParts: string[] = [];

	for (const part of parts.slice(1)) {
		if (suffixes.includes(part)) break;
		fieldParts.push(part);
	}

	if (fieldParts.length === 0) return null;

	// Convert snake_case to camelCase
	return fieldParts
		.map((part, i) => {
			if (i === 0) return part;
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join("");
};

/**
 * Extract field name from error detail message
 * Example: "Key (email)=(test@example.com) already exists."
 */
const extractFieldFromDetail = (detail: string): string | null => {
	const match = detail.match(/Key \(([^)]+)\)/);
	if (!match) return null;

	// Convert snake_case to camelCase
	const field = match[1];
	const parts = field.split("_");
	return parts
		.map((part, i) => {
			if (i === 0) return part;
			return part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join("");
};

/**
 * Extract value from error detail message
 * Example: "Key (email)=(test@example.com) already exists."
 */
const extractValueFromDetail = (detail: string): string | null => {
	const match = detail.match(/Key \([^)]+\)=\(([^)]+)\)/);
	return match ? match[1] : null;
};

/**
 * Detect and transform database constraint violations into ApiError
 * Returns null if the error is not a known database constraint violation
 */
export const parseDatabaseError = (error: unknown): ApiError | null => {
	// First unwrap to get the root cause
	const unwrapped = unwrapError(error);

	if (!isDatabaseError(unwrapped)) return null;

	const dbError = unwrapped as any;
	// Different drivers use different property names for error code
	// Try errno first (Bun), then code (node-postgres)
	const code = dbError.errno || dbError.code;
	const constraint = dbError.constraint_name || dbError.constraint;
	const detail = dbError.detail || "";
	const table = dbError.table || dbError.table_name;

	// Unique constraint violation
	if (code === PG_ERROR_CODES.UNIQUE_VIOLATION) {
		const field =
			extractFieldFromConstraint(constraint) ||
			extractFieldFromDetail(detail) ||
			"value";

		const value = extractValueFromDetail(detail);

		const fieldErrors: FieldError[] = [
			{
				path: field,
				message: `A record with this ${field} already exists`,
				value: value,
			},
		];

		const context: DBErrorContext = {
			operation: "insert",
			table: table || "unknown",
			constraint: constraint || "unique",
		};

		return new ApiError({
			code: "CONFLICT",
			message: `Duplicate ${field}: ${value || "value already exists"}`,
			messageKey: "error.database.uniqueViolation",
			messageParams: { field, value },
			fieldErrors,
			context: { db: context },
			cause: error,
		});
	}

	// Foreign key violation
	if (code === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION) {
		const field =
			extractFieldFromConstraint(constraint) ||
			extractFieldFromDetail(detail) ||
			"reference";

		const fieldErrors: FieldError[] = [
			{
				path: field,
				message: `Referenced record does not exist`,
			},
		];

		const context: DBErrorContext = {
			operation: "insert",
			table: table || "unknown",
			constraint: constraint || "foreign_key",
		};

		return new ApiError({
			code: "BAD_REQUEST",
			message: `Invalid ${field}: referenced record does not exist`,
			messageKey: "error.database.foreignKeyViolation",
			messageParams: { field },
			fieldErrors,
			context: { db: context },
			cause: error,
		});
	}

	// Not null violation
	if (code === PG_ERROR_CODES.NOT_NULL_VIOLATION) {
		const column = (error as any).column;
		const field = column || "field";

		const fieldErrors: FieldError[] = [
			{
				path: field,
				message: `${field} is required`,
			},
		];

		const context: DBErrorContext = {
			operation: "insert",
			table: table || "unknown",
		};

		return new ApiError({
			code: "VALIDATION_ERROR",
			message: `${field} is required`,
			messageKey: "error.database.notNullViolation",
			messageParams: { field },
			fieldErrors,
			context: { db: context },
			cause: error,
		});
	}

	// Check constraint violation
	if (code === PG_ERROR_CODES.CHECK_VIOLATION) {
		const field = extractFieldFromConstraint(constraint) || "field";

		const fieldErrors: FieldError[] = [
			{
				path: field,
				message: `Invalid value for ${field}`,
			},
		];

		const context: DBErrorContext = {
			operation: "insert",
			table: table || "unknown",
			constraint: constraint || "check",
		};

		return new ApiError({
			code: "VALIDATION_ERROR",
			message: `Invalid value for ${field}`,
			messageKey: "error.database.checkViolation",
			messageParams: { field },
			fieldErrors,
			context: { db: context },
			cause: error,
		});
	}

	// Not a known constraint violation
	return null;
};
