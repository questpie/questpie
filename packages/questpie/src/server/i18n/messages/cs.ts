/**
 * Czech Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Zdroj nenalezen",
	"error.notFound.withId": "{{resource}} nenalezen: {{id}}",
	"error.forbidden": "Přístup zamítnut",
	"error.unauthorized": "Vyžadována autentizace",
	"error.validation": "Validace selhala",
	"error.internal": "Vnitřní chyba serveru",
	"error.badRequest": "Neplatný požadavek",
	"error.conflict": "Konflikt zdrojů",
	"error.notImplemented": "{{feature}} není implementováno",
	"error.timeout": "Vypršel čas požadavku",

	// CRUD errors
	"crud.create.forbidden": "Nemáte oprávnění vytvořit {{resource}}",
	"crud.read.forbidden": "Nemáte oprávnění číst {{resource}}",
	"crud.update.forbidden": "Nemáte oprávnění upravit {{resource}}",
	"crud.delete.forbidden": "Nemáte oprávnění smazat {{resource}}",
	"crud.notFound": "{{resource}} nenalezen",

	// Auth errors
	"auth.invalidCredentials": "Neplatný e-mail nebo heslo",
	"auth.sessionExpired": "Vaše relace vypršela",
	"auth.tokenInvalid": "Neplatný token",
	"auth.tokenExpired": "Token vypršel",
	"auth.accountLocked": "Účet je uzamčen",
	"auth.emailNotVerified": "E-mail není ověřen",
	"auth.userNotFound": "Uživatel nenalezen",
	"auth.userAlreadyExists": "Uživatel již existuje",

	// Upload errors
	"upload.tooLarge": "Soubor překračuje maximální velikost {{maxSize}}",
	"upload.invalidType": "Typ souboru {{type}} není povolen",
	"upload.failed": "Nahrání souboru selhalo",

	// Hook errors
	"hook.beforeCreate.failed": "Před-vytvořovací validace selhala",
	"hook.afterCreate.failed": "Po-vytvořovací zpracování selhalo",
	"hook.beforeUpdate.failed": "Před-aktualizační validace selhala",
	"hook.afterUpdate.failed": "Po-aktualizační zpracování selhalo",
	"hook.beforeDelete.failed": "Před-mazací validace selhala",
	"hook.afterDelete.failed": "Po-mazací zpracování selhalo",
	"hook.validate.failed": "Vlastní validace selhala",

	// Access errors
	"access.denied": "Přístup zamítnut",
	"access.fieldDenied": "Přístup zamítnut k poli {{field}}",
	"access.operationDenied": "Operace {{operation}} není povolena",

	// Database errors
	"error.database.uniqueViolation": "Duplicitní {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"Neplatné {{field}}: odkazovaný záznam neexistuje",
	"error.database.notNullViolation": "{{field}} je povinné",
	"error.database.checkViolation": "Neplatná hodnota pro {{field}}",
} as const;
