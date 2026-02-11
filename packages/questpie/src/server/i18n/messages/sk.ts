/**
 * Slovak Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Záznam nebol nájdený",
	"error.notFound.withId": "{{resource}} nebol nájdený: {{id}}",
	"error.forbidden": "Prístup zamietnutý",
	"error.unauthorized": "Vyžaduje sa autentifikácia",
	"error.validation": "Validácia zlyhala",
	"error.internal": "Interná chyba servera",
	"error.badRequest": "Nesprávna požiadavka",
	"error.conflict": "Konflikt zdrojov",
	"error.notImplemented": "{{feature}} nie je implementované",
	"error.timeout": "Vypršanie požiadavky",

	// CRUD errors
	"crud.create.forbidden": "Nemáte oprávnenie vytvoriť {{resource}}",
	"crud.read.forbidden": "Nemáte oprávnenie čítať {{resource}}",
	"crud.update.forbidden": "Nemáte oprávnenie upraviť {{resource}}",
	"crud.delete.forbidden": "Nemáte oprávnenie vymazať {{resource}}",
	"crud.notFound": "{{resource}} nebol nájdený",

	// Auth errors
	"auth.invalidCredentials": "Neplatný email alebo heslo",
	"auth.sessionExpired": "Vaša relácia vypršala",
	"auth.tokenInvalid": "Neplatný token",
	"auth.tokenExpired": "Tokenu vypršala platnosť",
	"auth.accountLocked": "Účet je uzamknutý",
	"auth.emailNotVerified": "Email nie je overený",
	"auth.userNotFound": "Používateľ nebol nájdený",
	"auth.userAlreadyExists": "Používateľ už existuje",

	// Upload errors
	"upload.tooLarge": "Súbor prekračuje maximálnu veľkosť {{maxSize}}",
	"upload.invalidType": "Typ súboru {{type}} nie je povolený",
	"upload.failed": "Nahratie súboru zlyhalo",

	// Hook errors
	"hook.beforeCreate.failed": "Pred-vytvorenie validácia zlyhala",
	"hook.afterCreate.failed": "Po-vytvorenie spracovanie zlyhalo",
	"hook.beforeUpdate.failed": "Pred-aktualizácia validácia zlyhala",
	"hook.afterUpdate.failed": "Po-aktualizácia spracovanie zlyhalo",
	"hook.beforeDelete.failed": "Pred-vymazanie validácia zlyhala",
	"hook.afterDelete.failed": "Po-vymazanie spracovanie zlyhalo",
	"hook.validate.failed": "Vlastná validácia zlyhala",

	// Access errors
	"access.denied": "Prístup zamietnutý",
	"access.fieldDenied": "Prístup k poľu {{field}} zamietnutý",
	"access.operationDenied": "Operácia {{operation}} nie je povolená",

	// Database errors
	"error.database.uniqueViolation": "Duplicitné {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"Neplatné {{field}}: odkazovaný záznam neexistuje",
	"error.database.notNullViolation": "{{field}} je povinné",
	"error.database.checkViolation": "Neplatná hodnota pre {{field}}",
} as const;
