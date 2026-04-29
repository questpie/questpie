/**
 * Polish Validation Messages
 */
export const validationMessagesPL = {
	// General
	"validation.required": "To pole jest wymagane",
	"validation.invalidType": "Oczekiwano {{expected}}, otrzymano {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Musi mieć co najmniej {{min}} znaków",
	"validation.string.max": "Musi mieć co najwyżej {{max}} znaków",
	"validation.string.length": "Musi mieć dokładnie {{length}} znaków",
	"validation.string.email": "Nieprawidłowy adres e-mail",
	"validation.string.url": "Nieprawidłowy URL",
	"validation.string.uuid": "Nieprawidłowy UUID",
	"validation.string.regex": "Nieprawidłowy format",
	"validation.string.startsWith": "Musi zaczynać się od {{prefix}}",
	"validation.string.endsWith": "Musi kończyć się na {{suffix}}",
	"validation.string.includes": "Musi zawierać {{substring}}",
	"validation.string.datetime": "Nieprawidłowy format daty/czasu",
	"validation.string.ip": "Nieprawidłowy adres IP",
	"validation.string.base64": "Nieprawidłowy ciąg base64",

	// Number
	"validation.number.min": "Musi być co najmniej {{min}}",
	"validation.number.max": "Musi być co najwyżej {{max}}",
	"validation.number.int": "Musi być liczbą całkowitą",
	"validation.number.positive": "Musi być liczbą dodatnią",
	"validation.number.negative": "Musi być liczbą ujemną",
	"validation.number.nonpositive": "Musi być zerem lub liczbą ujemną",
	"validation.number.nonnegative": "Musi być zerem lub liczbą dodatnią",
	"validation.number.multipleOf": "Musi być wielokrotnością {{value}}",
	"validation.number.finite": "Musi być liczbą skończoną",

	// Array
	"validation.array.min": {
		one: "Musi zawierać co najmniej {{min}} element",
		few: "Musi zawierać co najmniej {{min}} elementy",
		many: "Musi zawierać co najmniej {{min}} elementów",
		other: "Musi zawierać co najmniej {{min}} elementu",
	},
	"validation.array.max": {
		one: "Musi zawierać co najwyżej {{max}} element",
		few: "Musi zawierać co najwyżej {{max}} elementy",
		many: "Musi zawierać co najwyżej {{max}} elementów",
		other: "Musi zawierać co najwyżej {{max}} elementu",
	},
	"validation.array.length": {
		one: "Musi zawierać dokładnie {{length}} element",
		few: "Musi zawierać dokładnie {{length}} elementy",
		many: "Musi zawierać dokładnie {{length}} elementów",
		other: "Musi zawierać dokładnie {{length}} elementu",
	},
	"validation.array.nonempty": "Musi zawierać co najmniej jeden element",

	// Date
	"validation.date.invalid": "Nieprawidłowa data",
	"validation.date.min": "Data musi być po {{min}}",
	"validation.date.max": "Data musi być przed {{max}}",
	"validation.time.invalid": "Nieprawidłowy format czasu",

	// Other
	"validation.boolean.invalid": "Musi być true albo false",
	"validation.object.invalid": "Nieprawidłowy obiekt",
	"validation.object.unrecognizedKeys": "Nierozpoznane klucze: {{keys}}",
	"validation.enum.invalid":
		"Nieprawidłowa opcja. Oczekiwano jednej z: {{options}}",
	"validation.union.invalid": "Nieprawidłowe dane wejściowe",
	"validation.file.tooLarge": "Plik musi być mniejszy niż {{max}}",
	"validation.file.invalidType":
		"Nieprawidłowy typ pliku. Dozwolone: {{types}}",
} as const;
