/**
 * English Backend Messages (Default)
 */
export default {
	// General errors
	"error.notFound": "Resource not found",
	"error.notFound.withId": "{{resource}} not found: {{id}}",
	"error.forbidden": "Access denied",
	"error.unauthorized": "Authentication required",
	"error.validation": "Validation failed",
	"error.internal": "Internal server error",
	"error.badRequest": "Bad request",
	"error.conflict": "Resource conflict",
	"error.notImplemented": "{{feature}} is not implemented",
	"error.timeout": "Request timeout",

	// CRUD errors
	"crud.create.forbidden": "You don't have permission to create {{resource}}",
	"crud.read.forbidden": "You don't have permission to read {{resource}}",
	"crud.update.forbidden": "You don't have permission to update {{resource}}",
	"crud.delete.forbidden": "You don't have permission to delete {{resource}}",
	"crud.notFound": "{{resource}} not found",

	// Auth errors
	"auth.invalidCredentials": "Invalid email or password",
	"auth.sessionExpired": "Your session has expired",
	"auth.tokenInvalid": "Invalid token",
	"auth.tokenExpired": "Token has expired",
	"auth.accountLocked": "Account is locked",
	"auth.emailNotVerified": "Email not verified",
	"auth.userNotFound": "User not found",
	"auth.userAlreadyExists": "User already exists",

	// Upload errors
	"upload.tooLarge": "File exceeds maximum size of {{maxSize}}",
	"upload.invalidType": "File type {{type}} is not allowed",
	"upload.failed": "File upload failed",

	// Hook errors
	"hook.beforeCreate.failed": "Pre-create validation failed",
	"hook.afterCreate.failed": "Post-create processing failed",
	"hook.beforeUpdate.failed": "Pre-update validation failed",
	"hook.afterUpdate.failed": "Post-update processing failed",
	"hook.beforeDelete.failed": "Pre-delete validation failed",
	"hook.afterDelete.failed": "Post-delete processing failed",
	"hook.validate.failed": "Custom validation failed",

	// Access errors
	"access.denied": "Access denied",
	"access.fieldDenied": "Access denied to field {{field}}",
	"access.operationDenied": "Operation {{operation}} is not allowed",

	// Database errors
	"error.database.uniqueViolation": "Duplicate {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"Invalid {{field}}: referenced record does not exist",
	"error.database.notNullViolation": "{{field}} is required",
	"error.database.checkViolation": "Invalid value for {{field}}",
} as const;
