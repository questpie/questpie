import type {
	BackendMessageKey,
	BackendTranslateFn,
} from "#questpie/server/i18n/types.js";
import {
	createZodErrorMap,
	type ZodIssue,
} from "#questpie/shared/i18n/zod-error-map.js";

import type { ApiErrorCode } from "./codes.js";
import { getHTTPStatusFromCode } from "./codes.js";
import type {
	AccessErrorContext,
	ApiErrorContext,
	ApiErrorShape,
	FieldError,
	HookErrorContext,
} from "./types.js";

export type ApiErrorOptions = {
	code: ApiErrorCode;
	message: string;
	/** Translation key for i18n */
	messageKey?: BackendMessageKey;
	/** Parameters for translation interpolation */
	messageParams?: Record<string, unknown>;
	fieldErrors?: FieldError[];
	context?: ApiErrorContext;
	/** Original error (preserves stack trace) */
	cause?: unknown;
};

function translateFieldError(
	fieldError: FieldError,
	t?: BackendTranslateFn,
	locale?: string,
): FieldError {
	let message = fieldError.message;

	if (t && fieldError.validationIssue) {
		const translate = (key: string, params?: Record<string, unknown>) =>
			t(
				key,
				{
					field: fieldError.path,
					...fieldError.messageParams,
					...params,
				},
				locale,
			);
		message = createZodErrorMap(translate)(
			fieldError.validationIssue as ZodIssue,
		).message;
	} else if (t && fieldError.messageKey) {
		message = t(
			fieldError.messageKey,
			{
				field: fieldError.path,
				...fieldError.messageParams,
			},
			locale,
		);
	}

	return {
		path: fieldError.path,
		message,
		value: fieldError.value,
	};
}

/**
 * Base QUESTPIE Error class
 * Provides type-safe, structured errors across the entire app
 */
export class ApiError extends Error {
	public readonly code: ApiErrorCode;
	/** Translation key for i18n */
	public readonly messageKey?: BackendMessageKey;
	/** Parameters for translation interpolation */
	public readonly messageParams?: Record<string, unknown>;
	public readonly fieldErrors?: FieldError[];
	public readonly context?: ApiErrorContext;
	public readonly cause?: unknown;

	constructor(options: ApiErrorOptions) {
		super(options.message);
		this.name = "ApiError";
		this.code = options.code;
		this.messageKey = options.messageKey;
		this.messageParams = options.messageParams;
		this.fieldErrors = options.fieldErrors;
		this.context = options.context;
		this.cause = options.cause;

		// Maintain proper stack trace for debugging
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ApiError);
		}
	}

	/**
	 * Get HTTP status code for this error
	 */
	getHTTPStatus(): number {
		return getHTTPStatusFromCode(this.code);
	}

	/**
	 * Get translated error message
	 * @param t - Backend translate function
	 * @param locale - Optional locale override
	 */
	getTranslatedMessage(t: BackendTranslateFn, locale?: string): string {
		if (this.messageKey) {
			return t(this.messageKey, this.messageParams, locale);
		}
		return this.message;
	}

	/**
	 * Convert to client-safe error shape
	 * @param isDev - Include stack trace and detailed cause info
	 * @param t - Optional backend translate function for i18n
	 * @param locale - Optional locale for translation
	 */
	toJSON(
		isDev = false,
		t?: BackendTranslateFn,
		locale?: string,
	): ApiErrorShape {
		const message =
			t && this.messageKey
				? t(this.messageKey, this.messageParams, locale)
				: this.message;

		return {
			code: this.code,
			message,
			fieldErrors: this.fieldErrors?.map((fieldError) =>
				translateFieldError(fieldError, t, locale),
			),
			context: this.context,
			stack: isDev ? this.stack : undefined,
			cause: this.cause instanceof Error ? this.cause.message : undefined,
		};
	}

	/**
	 * Create validation error from Zod v4 error
	 */
	static fromZodError(zodError: any, message = "Validation failed"): ApiError {
		const fieldErrors: FieldError[] = [];

		// Zod v4 uses 'issues' property
		if (zodError.issues && Array.isArray(zodError.issues)) {
			for (const issue of zodError.issues) {
				const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
				fieldErrors.push({
					path,
					message: issue.message,
					messageParams: { field: path },
					validationIssue: issue,
					value: issue.input,
				});
			}
		}

		return new ApiError({
			code: "VALIDATION_ERROR",
			message,
			messageKey: "error.validation",
			fieldErrors,
			cause: zodError,
		});
	}

	/**
	 * Create NOT_FOUND error
	 */
	static notFound(resource: string, id?: string): ApiError {
		return new ApiError({
			code: "NOT_FOUND",
			message: id ? `${resource} not found: ${id}` : `${resource} not found`,
			messageKey: id ? "error.notFound.withId" : "error.notFound",
			messageParams: { resource, id },
		});
	}

	/**
	 * Create FORBIDDEN error with access context
	 */
	static forbidden(context: AccessErrorContext): ApiError {
		const useDefaultTranslation = context.reason === "Access denied";
		return new ApiError({
			code: "FORBIDDEN",
			message: context.reason,
			messageKey: useDefaultTranslation ? "error.forbidden" : undefined,
			messageParams: useDefaultTranslation
				? { reason: context.reason }
				: undefined,
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
	): ApiError {
		return new ApiError({
			code: "HOOK_ERROR",
			message,
			context: { hook: hookContext },
			cause,
		});
	}

	/**
	 * Create UNAUTHORIZED error
	 */
	static unauthorized(
		message = "Authentication required",
		messageKey?: BackendMessageKey,
		messageParams?: Record<string, unknown>,
	): ApiError {
		const useDefaultTranslation = message === "Authentication required";
		return new ApiError({
			code: "UNAUTHORIZED",
			message,
			messageKey:
				messageKey ??
				(useDefaultTranslation ? "error.unauthorized" : undefined),
			messageParams,
		});
	}

	/**
	 * Create BAD_REQUEST error
	 */
	static badRequest(
		message = "Bad request",
		fieldErrors?: FieldError[],
		messageKey?: BackendMessageKey,
		messageParams?: Record<string, unknown>,
	): ApiError {
		const useDefaultTranslation = message === "Bad request";
		return new ApiError({
			code: "BAD_REQUEST",
			message,
			messageKey:
				messageKey ?? (useDefaultTranslation ? "error.badRequest" : undefined),
			messageParams,
			fieldErrors,
		});
	}

	/**
	 * Create INTERNAL_SERVER_ERROR
	 */
	static internal(
		message = "Internal server error",
		cause?: unknown,
	): ApiError {
		return new ApiError({
			code: "INTERNAL_SERVER_ERROR",
			message,
			messageKey: "error.internal",
			cause,
		});
	}

	/**
	 * Create NOT_IMPLEMENTED error
	 */
	static notImplemented(feature: string): ApiError {
		return new ApiError({
			code: "NOT_IMPLEMENTED",
			message: `${feature} is not implemented or not enabled`,
			messageKey: "error.notImplemented",
			messageParams: { feature },
		});
	}

	/**
	 * Create CONFLICT error
	 */
	static conflict(message: string): ApiError {
		return new ApiError({
			code: "CONFLICT",
			message,
			messageKey: "error.conflict",
		});
	}
}
