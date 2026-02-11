import type {
  BackendMessageKey,
  BackendTranslateFn,
} from "#questpie/server/i18n/types.js";
import { getHTTPStatusFromCode } from "./codes.js";
import type { ApiErrorCode } from "./codes.js";
import type {
  FieldError,
  ApiErrorContext,
  ApiErrorShape,
  AccessErrorContext,
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

/**
 * Base CMS Error class
 * Provides type-safe, structured errors across the entire CMS
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
      fieldErrors: this.fieldErrors,
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
        fieldErrors.push({
          path: issue.path.join("."),
          message: issue.message,
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
  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError({
      code: "UNAUTHORIZED",
      message,
      messageKey: "error.unauthorized",
    });
  }

  /**
   * Create BAD_REQUEST error
   */
  static badRequest(
    message = "Bad request",
    fieldErrors?: FieldError[],
  ): ApiError {
    const useDefaultTranslation = message === "Bad request";
    return new ApiError({
      code: "BAD_REQUEST",
      message,
      messageKey: useDefaultTranslation ? "error.badRequest" : undefined,
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
