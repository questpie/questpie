/**
 * Spanish Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Recurso no encontrado",
	"error.notFound.withId": "{{resource}} no encontrado: {{id}}",
	"error.forbidden": "Acceso denegado",
	"error.unauthorized": "Autenticación requerida",
	"error.validation": "Validación fallida",
	"error.internal": "Error interno del servidor",
	"error.badRequest": "Solicitud incorrecta",
	"error.invalidJsonBody": "Cuerpo JSON no válido",
	"error.methodNotAllowed": "Método no permitido",
	"error.methodNotAllowed.useMethod": "Método no permitido. Use {{method}}.",
	"error.missingRequiredField": "Falta el campo obligatorio: {{field}}",
	"error.invalidDateField": "Fecha no válida para {{field}}",
	"error.updatesMustBeArray": "updates debe ser un arreglo",
	"error.versionRequired": "Se requiere version o versionId",
	"error.conflict": "Conflicto de recursos",
	"error.notImplemented": "{{feature}} no está implementado",
	"error.timeout": "Tiempo de solicitud agotado",

	// CRUD errors
	"crud.create.forbidden": "No tiene permiso para crear {{resource}}",
	"crud.read.forbidden": "No tiene permiso para leer {{resource}}",
	"crud.update.forbidden": "No tiene permiso para actualizar {{resource}}",
	"crud.delete.forbidden": "No tiene permiso para eliminar {{resource}}",
	"crud.notFound": "{{resource}} no encontrado",

	// Auth errors
	"auth.invalidCredentials": "Correo electrónico o contraseña inválidos",
	"auth.sessionExpired": "Su sesión ha expirado",
	"auth.tokenInvalid": "Token inválido",
	"auth.tokenExpired": "El token ha expirado",
	"auth.accountLocked": "La cuenta está bloqueada",
	"auth.emailNotVerified": "Correo electrónico no verificado",
	"auth.userNotFound": "Usuario no encontrado",
	"auth.userAlreadyExists": "El usuario ya existe",

	// Upload errors
	"upload.tooLarge": "El archivo excede el tamaño máximo de {{maxSize}}",
	"upload.invalidType": "El tipo de archivo {{type}} no está permitido",
	"upload.failed": "Error al cargar el archivo",
	"upload.noFileUploaded":
		"No se subió ningún archivo. Envíe 'file' en form-data.",
	"upload.collectionNotSupported":
		'La colección "{{collection}}" no admite cargas de archivos. Use .upload() para habilitarlas.',
	"upload.collectionServeNotSupported":
		'La colección "{{collection}}" no admite servir archivos. Use .upload() para habilitarlo.',
	"upload.methodNotAvailable":
		'Método de carga no disponible para la colección "{{collection}}"',
	"upload.tokenRequired": "Se requiere token para archivos privados",
	"upload.tokenInvalid": "Token inválido o vencido",
	"upload.tokenMismatch": "El token no coincide con el archivo solicitado",
	"upload.fileKeyNotSpecified": "No se especificó la clave del archivo",
	"upload.extensionNotAllowed":
		'La extensión de archivo "{{extension}}" no está permitida',

	// Search errors
	"search.serviceNotConfigured": "El servicio de búsqueda no está configurado",
	"search.reindexAccessDenied":
		"Acceso de reindexación denegado por la política",

	// Realtime errors
	"realtime.topicsRequired":
		"El arreglo topics es obligatorio y no debe estar vacío",
	"realtime.topicIdRequired": "El ID del tema es obligatorio",
	"realtime.resourceRequired": "resourceType y resource son obligatorios",
	"realtime.collectionNotFound": 'Colección "{{collection}}" no encontrada',
	"realtime.globalNotFound": 'Global "{{global}}" no encontrado',
	"realtime.invalidResourceType": 'resourceType "{{resourceType}}" inválido',
	"realtime.noValidTopics":
		"No se proporcionaron temas válidos. Errores: {{errors}}",

	// Hook errors
	"hook.beforeCreate.failed": "Validación pre-creación fallida",
	"hook.afterCreate.failed": "Procesamiento post-creación fallido",
	"hook.beforeUpdate.failed": "Validación pre-actualización fallida",
	"hook.afterUpdate.failed": "Procesamiento post-actualización fallido",
	"hook.beforeDelete.failed": "Validación pre-eliminación fallida",
	"hook.afterDelete.failed": "Procesamiento post-eliminación fallido",
	"hook.validate.failed": "Validación personalizada fallida",

	// Access errors
	"access.denied": "Acceso denegado",
	"access.fieldDenied": "Acceso denegado al campo {{field}}",
	"access.operationDenied": "La operación {{operation}} no está permitida",

	// Database errors
	"error.database.uniqueViolation": "Duplicado {{field}}: {{value}}",
	"error.database.uniqueViolation.field":
		"Ya existe un registro con este {{field}}",
	"error.database.foreignKeyViolation":
		"{{field}} inválido: el registro referenciado no existe",
	"error.database.foreignKeyViolation.field":
		"El registro referenciado no existe",
	"error.database.notNullViolation": "{{field}} es obligatorio",
	"error.database.notNullViolation.field": "{{field}} es obligatorio",
	"error.database.checkViolation": "Valor inválido para {{field}}",
	"error.database.checkViolation.field": "Valor inválido para {{field}}",
} as const;
