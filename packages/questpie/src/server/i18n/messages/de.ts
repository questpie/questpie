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
	"error.invalidJsonBody": "Ungültiger JSON-Body",
	"error.methodNotAllowed": "Methode nicht erlaubt",
	"error.methodNotAllowed.useMethod":
		"Methode nicht erlaubt. Verwenden Sie {{method}}.",
	"error.missingRequiredField": "Pflichtfeld fehlt: {{field}}",
	"error.invalidDateField": "Ungültiges Datum für {{field}}",
	"error.updatesMustBeArray": "updates muss ein Array sein",
	"error.versionRequired": "Version oder versionId erforderlich",
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
	"upload.noFileUploaded":
		"Keine Datei hochgeladen. Senden Sie 'file' als form-data.",
	"upload.collectionNotSupported":
		'Collection "{{collection}}" unterstützt keine Datei-Uploads. Aktivieren Sie dies mit .upload().',
	"upload.collectionServeNotSupported":
		'Collection "{{collection}}" unterstützt keine Dateiauslieferung. Aktivieren Sie dies mit .upload().',
	"upload.methodNotAvailable":
		'Upload-Methode für Collection "{{collection}}" nicht verfügbar',
	"upload.tokenRequired": "Token für private Dateien erforderlich",
	"upload.tokenInvalid": "Ungültiger oder abgelaufener Token",
	"upload.tokenMismatch": "Token passt nicht zur angeforderten Datei",
	"upload.fileKeyNotSpecified": "Dateischlüssel nicht angegeben",
	"upload.extensionNotAllowed":
		'Dateierweiterung "{{extension}}" ist nicht erlaubt',

	// Search errors
	"search.serviceNotConfigured": "Suchdienst ist nicht konfiguriert",
	"search.reindexAccessDenied": "Reindex-Zugriff durch Richtlinie verweigert",

	// Realtime errors
	"realtime.topicsRequired":
		"Topics-Array ist erforderlich und darf nicht leer sein",
	"realtime.topicIdRequired": "Topic-ID ist erforderlich",
	"realtime.resourceRequired": "resourceType und resource sind erforderlich",
	"realtime.collectionNotFound": 'Collection "{{collection}}" nicht gefunden',
	"realtime.globalNotFound": 'Global "{{global}}" nicht gefunden',
	"realtime.invalidResourceType": 'Ungültiger resourceType "{{resourceType}}"',
	"realtime.noValidTopics":
		"Keine gültigen Topics angegeben. Fehler: {{errors}}",

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
	"error.database.uniqueViolation.field":
		"Ein Datensatz mit diesem {{field}} existiert bereits",
	"error.database.foreignKeyViolation":
		"Ungültiges {{field}}: Referenzierter Datensatz existiert nicht",
	"error.database.foreignKeyViolation.field":
		"Referenzierter Datensatz existiert nicht",
	"error.database.notNullViolation": "{{field}} ist erforderlich",
	"error.database.notNullViolation.field": "{{field}} ist erforderlich",
	"error.database.checkViolation": "Ungültiger Wert für {{field}}",
	"error.database.checkViolation.field": "Ungültiger Wert für {{field}}",
} as const;
