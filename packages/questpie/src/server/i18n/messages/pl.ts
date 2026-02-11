/**
 * Polish Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Zasób nie znaleziony",
	"error.notFound.withId": "{{resource}} nie znaleziony: {{id}}",
	"error.forbidden": "Dostęp zabroniony",
	"error.unauthorized": "Wymagana autoryzacja",
	"error.validation": "Walidacja nie powiodła się",
	"error.internal": "Wewnętrzny błąd serwera",
	"error.badRequest": "Nieprawidłowe żądanie",
	"error.conflict": "Konflikt zasobów",
	"error.notImplemented": "{{feature}} nie jest zaimplementowane",
	"error.timeout": "Przekroczono czas żądania",

	// CRUD errors
	"crud.create.forbidden": "Nie masz uprawnień do utworzenia {{resource}}",
	"crud.read.forbidden": "Nie masz uprawnień do odczytania {{resource}}",
	"crud.update.forbidden": "Nie masz uprawnień do aktualizacji {{resource}}",
	"crud.delete.forbidden": "Nie masz uprawnień do usunięcia {{resource}}",
	"crud.notFound": "{{resource}} nie znaleziony",

	// Auth errors
	"auth.invalidCredentials": "Nieprawidłowy e-mail lub hasło",
	"auth.sessionExpired": "Twoja sesja wygasła",
	"auth.tokenInvalid": "Nieprawidłowy token",
	"auth.tokenExpired": "Token wygasł",
	"auth.accountLocked": "Konto jest zablokowane",
	"auth.emailNotVerified": "E-mail nie zweryfikowany",
	"auth.userNotFound": "Użytkownik nie znaleziony",
	"auth.userAlreadyExists": "Użytkownik już istnieje",

	// Upload errors
	"upload.tooLarge": "Plik przekracza maksymalny rozmiar {{maxSize}}",
	"upload.invalidType": "Typ pliku {{type}} nie jest dozwolony",
	"upload.failed": "Przesyłanie pliku nie powiodło się",

	// Hook errors
	"hook.beforeCreate.failed": "Walidacja pre-create nie powiodła się",
	"hook.afterCreate.failed": "Przetwarzanie post-create nie powiodło się",
	"hook.beforeUpdate.failed": "Walidacja pre-update nie powiodła się",
	"hook.afterUpdate.failed": "Przetwarzanie post-update nie powiodło się",
	"hook.beforeDelete.failed": "Walidacja pre-delete nie powiodła się",
	"hook.afterDelete.failed": "Przetwarzanie post-delete nie powiodło się",
	"hook.validate.failed": "Walidacja niestandardowa nie powiodła się",

	// Access errors
	"access.denied": "Dostęp zabroniony",
	"access.fieldDenied": "Dostęp zabroniony do pola {{field}}",
	"access.operationDenied": "Operacja {{operation}} nie jest dozwolona",

	// Database errors
	"error.database.uniqueViolation": "Duplikat {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"Nieprawidłowe {{field}}: odwoływany rekord nie istnieje",
	"error.database.notNullViolation": "{{field}} jest wymagane",
	"error.database.checkViolation": "Nieprawidłowa wartość dla {{field}}",
} as const;
