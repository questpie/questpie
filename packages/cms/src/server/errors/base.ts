import { getHTTPStatusFromCode } from "./codes";
import type { CMSErrorCode } from "./codes";
import type {
	FieldError,
	CMSErrorContext,
	CMSErrorShape,
	AccessErrorContext,
	HookErrorContext,
} from "./types";

export type CMSErrorOptions = {
	code: CMSErrorCode;
	message: string;
	fieldErrors?: FieldError[];
	context?: CMSErrorContext;
	/** Original error (preserves stack trace) */
	cause?: unknown;
};

/**
 * Base CMS Error class
 * Provides type-safe, structured errors across the entire CMS
 */
export class CMSError extends Error {
	public readonly code: CMSErrorCode;
	public readonly fieldErrors?: FieldError[];
	public readonly context?: CMSErrorContext;
	public readonly cause?: unknown;

	constructor(options: CMSErrorOptions) {
		super(options.message);
		this.name = "CMSError";
		this.code = options.code;
		this.fieldErrors = options.fieldErrors;
		this.context = options.context;
		this.cause = options.cause;

		// Maintain proper stack trace for debugging
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, CMSError);
		}
	}

	/**
	 * Get HTTP status code for this error
	 */
	getHTTPStatus(): number {
		return getHTTPStatusFromCode(this.code);
	}

	/**
	 * Convert to client-safe error shape
	 * @param isDev - Include stack trace and detailed cause info
	 */
	toJSON(isDev = false): CMSErrorShape {
		return {
			code: this.code,
			message: this.message,
			fieldErrors: this.fieldErrors,
			context: this.context,
			stack: isDev ? this.stack : undefined,
			cause: this.cause instanceof Error ? this.cause.message : undefined,
		};
	}

	/**
	 * Create validation error from Zod error
	 */
	static fromZodError(zodError: any, message = "Validation failed"): CMSError {
		const fieldErrors: FieldError[] = [];

		if (zodError.errors && Array.isArray(zodError.errors)) {
			for (const err of zodError.errors) {
				fieldErrors.push({
					path: err.path.join("."),
					message: err.message,
					value: err.received,
				});
			}
		}

		return new CMSError({
			code: "VALIDATION_ERROR",
			message,
			fieldErrors,
			cause: zodError,
		});
	}

	/**
	 * Create NOT_FOUND error
	 */
	static notFound(resource: string, id?: string): CMSError {
		return new CMSError({
			code: "NOT_FOUND",
			message: id ? `${resource} not found: ${id}` : `${resource} not found`,
		});
	}

	/**
	 * Create FORBIDDEN error with access context
	 */
	static forbidden(context: AccessErrorContext): CMSError {
		return new CMSError({
			code: "FORBIDDEN",
			message: context.reason,
			context: { access: context },
		});
	}

	/**
	 * Create HOOK_ERROR with hook context
	 */
	static hookError(
		hookContext: HookErrorContext,
		message: string,
		cause?: unknown,
	): CMSError {
		return new CMSError({
			code: "HOOK_ERROR",
			message,
			context: { hook: hookContext },
			cause,
		});
	}

	/**
	 * Create UNAUTHORIZED error
	 */
	static unauthorized(message = "Authentication required"): CMSError {
		return new CMSError({
			code: "UNAUTHORIZED",
			message,
		});
	}

	/**
	 * Create BAD_REQUEST error
	 */
	static badRequest(message: string, fieldErrors?: FieldError[]): CMSError {
		return new CMSError({
			code: "BAD_REQUEST",
			message,
			fieldErrors,
		});
	}

	/**
	 * Create INTERNAL_SERVER_ERROR
	 */
	static internal(
		message = "Internal server error",
		cause?: unknown,
	): CMSError {
		return new CMSError({
			code: "INTERNAL_SERVER_ERROR",
			message,
			cause,
		});
	}

	/**
	 * Create NOT_IMPLEMENTED error
	 */
	static notImplemented(feature: string): CMSError {
		return new CMSError({
			code: "NOT_IMPLEMENTED",
			message: `${feature} is not implemented or not enabled`,
		});
	}

	/**
	 * Create CONFLICT error
	 */
	static conflict(message: string): CMSError {
		return new CMSError({
			code: "CONFLICT",
			message,
		});
	}
}
