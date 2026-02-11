/**
 * German Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Ressource nicht gefunden",
	"error.notFound.withId": "{{resource}} nicht gefunden: {{id}}",
	"error.forbidden": "Zugriff verweigert",
	"error.unauthorized": "Authentifizierung erforderlich",
	"error.validation": "Validierung fehlgeschlagen",
	"error.internal": "Interner Serverfehler",
	"error.badRequest": "Ungültige Anfrage",
	"error.conflict": "Ressourcenkonflikt",
	"error.notImplemented": "{{feature}} ist nicht implementiert",
	"error.timeout": "Zeitüberschreitung der Anfrage",

	// CRUD errors
	"crud.create.forbidden":
		"Sie haben keine Berechtigung, {{resource}} zu erstellen",
	"crud.read.forbidden": "Sie haben keine Berechtigung, {{resource}} zu lesen",
	"crud.update.forbidden":
		"Sie haben keine Berechtigung, {{resource}} zu aktualisieren",
	"crud.delete.forbidden":
		"Sie haben keine Berechtigung, {{resource}} zu löschen",
	"crud.notFound": "{{resource}} nicht gefunden",

	// Auth errors
	"auth.invalidCredentials": "Ungültige E-Mail oder Passwort",
	"auth.sessionExpired": "Ihre Sitzung ist abgelaufen",
	"auth.tokenInvalid": "Ungültiger Token",
	"auth.tokenExpired": "Token ist abgelaufen",
	"auth.accountLocked": "Konto ist gesperrt",
	"auth.emailNotVerified": "E-Mail nicht verifiziert",
	"auth.userNotFound": "Benutzer nicht gefunden",
	"auth.userAlreadyExists": "Benutzer existiert bereits",

	// Upload errors
	"upload.tooLarge": "Datei überschreitet maximale Größe von {{maxSize}}",
	"upload.invalidType": "Dateityp {{type}} ist nicht erlaubt",
	"upload.failed": "Datei-Upload fehlgeschlagen",

	// Hook errors
	"hook.beforeCreate.failed": "Pre-Create-Validierung fehlgeschlagen",
	"hook.afterCreate.failed": "Post-Create-Verarbeitung fehlgeschlagen",
	"hook.beforeUpdate.failed": "Pre-Update-Validierung fehlgeschlagen",
	"hook.afterUpdate.failed": "Post-Update-Verarbeitung fehlgeschlagen",
	"hook.beforeDelete.failed": "Pre-Delete-Validierung fehlgeschlagen",
	"hook.afterDelete.failed": "Post-Delete-Verarbeitung fehlgeschlagen",
	"hook.validate.failed": "Benutzerdefinierte Validierung fehlgeschlagen",

	// Access errors
	"access.denied": "Zugriff verweigert",
	"access.fieldDenied": "Zugriff auf Feld {{field}} verweigert",
	"access.operationDenied": "Operation {{operation}} ist nicht erlaubt",

	// Database errors
	"error.database.uniqueViolation": "Duplikat {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"Ungültiges {{field}}: Referenzierter Datensatz existiert nicht",
	"error.database.notNullViolation": "{{field}} ist erforderlich",
	"error.database.checkViolation": "Ungültiger Wert für {{field}}",
} as const;
