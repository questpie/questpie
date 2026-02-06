/**
 * Core Backend Messages
 *
 * Default translations for all built-in error messages and system messages.
 * These are included automatically when using the starterModule.
 *
 * Users can override any message by providing their own translations
 * via .messages() after .use(starterModule).
 */

export const coreBackendMessages = {
  en: {
    // General errors
    "error.notFound": "Resource not found",
    "error.notFound.withId": "{{resource}} with ID {{id}} not found",
    "error.forbidden": "Access forbidden",
    "error.unauthorized": "Unauthorized",
    "error.validation": "Validation failed",
    "error.internal": "Internal server error",
    "error.badRequest": "Bad request",
    "error.conflict": "Resource conflict",
    "error.notImplemented": "Not implemented",
    "error.timeout": "Request timeout",

    // CRUD errors
    "crud.create.forbidden":
      "You don't have permission to create this resource",
    "crud.read.forbidden": "You don't have permission to read this resource",
    "crud.update.forbidden":
      "You don't have permission to update this resource",
    "crud.delete.forbidden":
      "You don't have permission to delete this resource",
    "crud.notFound": "{{resource}} not found",

    // Validation errors
    "validation.required": "{{field}} is required",
    "validation.invalidType": "{{field}} must be a {{expected}}",
    "validation.string.tooSmall":
      "{{field}} must be at least {{min}} characters",
    "validation.string.tooBig": "{{field}} must be at most {{max}} characters",
    "validation.string.email": "{{field}} must be a valid email",
    "validation.string.url": "{{field}} must be a valid URL",
    "validation.string.uuid": "{{field}} must be a valid UUID",
    "validation.string.regex": "{{field}} has invalid format",
    "validation.number.tooSmall": "{{field}} must be at least {{min}}",
    "validation.number.tooBig": "{{field}} must be at most {{max}}",
    "validation.number.notInteger": "{{field}} must be an integer",
    "validation.number.notPositive": "{{field}} must be positive",
    "validation.number.notNegative": "{{field}} must be negative",
    "validation.array.tooSmall": "{{field}} must have at least {{min}} items",
    "validation.array.tooBig": "{{field}} must have at most {{max}} items",
    "validation.date.invalid": "{{field}} must be a valid date",
    "validation.date.tooEarly": "{{field}} must be after {{min}}",
    "validation.date.tooLate": "{{field}} must be before {{max}}",

    // Auth errors
    "auth.invalidCredentials": "Invalid credentials",
    "auth.sessionExpired": "Session expired",
    "auth.tokenInvalid": "Invalid token",
    "auth.tokenExpired": "Token expired",
    "auth.accountLocked": "Account locked",
    "auth.emailNotVerified": "Email not verified",
    "auth.userNotFound": "User not found",
    "auth.userAlreadyExists": "User already exists",

    // Upload errors
    "upload.tooLarge": "File too large (max {{max}})",
    "upload.invalidType": "Invalid file type. Allowed: {{allowed}}",
    "upload.failed": "Upload failed",

    // Hook errors
    "hook.beforeCreate.failed": "Pre-create validation failed",
    "hook.afterCreate.failed": "Post-create processing failed",
    "hook.beforeUpdate.failed": "Pre-update validation failed",
    "hook.afterUpdate.failed": "Post-update processing failed",
    "hook.beforeDelete.failed": "Pre-delete validation failed",
    "hook.afterDelete.failed": "Post-delete processing failed",
    "hook.validate.failed": "Validation hook failed",

    // Access errors
    "access.denied": "Access denied",
    "access.fieldDenied": "Access to field {{field}} denied",
    "access.operationDenied": "Operation {{operation}} not allowed",

    // Database constraint errors
    "error.database.uniqueViolation": "{{field}} already exists",
    "error.database.foreignKeyViolation":
      "Referenced {{resource}} does not exist",
    "error.database.notNullViolation": "{{field}} cannot be null",
    "error.database.checkViolation": "{{field}} violates check constraint",
  },
} as const;

/**
 * Type representing the core message keys
 */
export type CoreMessageKey = keyof (typeof coreBackendMessages)["en"];
