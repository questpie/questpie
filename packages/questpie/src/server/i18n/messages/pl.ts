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
	"error.invalidJsonBody": "Nieprawidłowe ciało JSON",
	"error.methodNotAllowed": "Metoda niedozwolona",
	"error.methodNotAllowed.useMethod": "Metoda niedozwolona. Użyj {{method}}.",
	"error.missingRequiredField": "Brak wymaganego pola: {{field}}",
	"error.invalidDateField": "Nieprawidłowa data w polu {{field}}",
	"error.updatesMustBeArray": "updates musi być tablicą",
	"error.versionRequired": "Wymagane jest version lub versionId",
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
	"upload.noFileUploaded": "Nie przesłano pliku. Wyślij 'file' jako form-data.",
	"upload.collectionNotSupported":
		'Kolekcja "{{collection}}" nie obsługuje przesyłania plików. Włącz je za pomocą .upload().',
	"upload.collectionServeNotSupported":
		'Kolekcja "{{collection}}" nie obsługuje udostępniania plików. Włącz je za pomocą .upload().',
	"upload.methodNotAvailable":
		'Metoda przesyłania dla kolekcji "{{collection}}" jest niedostępna',
	"upload.tokenRequired": "Token jest wymagany dla plików prywatnych",
	"upload.tokenInvalid": "Nieprawidłowy lub wygasły token",
	"upload.tokenMismatch": "Token nie pasuje do żądanego pliku",
	"upload.fileKeyNotSpecified": "Nie podano klucza pliku",
	"upload.extensionNotAllowed":
		'Rozszerzenie pliku "{{extension}}" jest niedozwolone',

	// Search errors
	"search.serviceNotConfigured": "Usługa wyszukiwania nie jest skonfigurowana",
	"search.reindexAccessDenied":
		"Dostęp do reindeksowania odrzucony przez politykę",

	// Realtime errors
	"realtime.topicsRequired":
		"Tablica topics jest wymagana i nie może być pusta",
	"realtime.topicIdRequired": "ID tematu jest wymagane",
	"realtime.resourceRequired": "resourceType i resource są wymagane",
	"realtime.collectionNotFound": 'Kolekcja "{{collection}}" nie znaleziona',
	"realtime.globalNotFound": 'Global "{{global}}" nie znaleziony',
	"realtime.invalidResourceType":
		'Nieprawidłowy resourceType "{{resourceType}}"',
	"realtime.noValidTopics":
		"Nie podano żadnych prawidłowych tematów. Błędy: {{errors}}",

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
	"error.database.uniqueViolation.field": "Rekord z tym {{field}} już istnieje",
	"error.database.foreignKeyViolation":
		"Nieprawidłowe {{field}}: odwoływany rekord nie istnieje",
	"error.database.foreignKeyViolation.field": "Odwoływany rekord nie istnieje",
	"error.database.notNullViolation": "{{field}} jest wymagane",
	"error.database.notNullViolation.field": "{{field}} jest wymagane",
	"error.database.checkViolation": "Nieprawidłowa wartość dla {{field}}",
	"error.database.checkViolation.field": "Nieprawidłowa wartość dla {{field}}",
} as const;
