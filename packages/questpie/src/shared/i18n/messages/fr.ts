/**
 * French Validation Messages
 */
export const validationMessagesFR = {
	// General
	"validation.required": "Ce champ est obligatoire",
	"validation.invalidType": "Type attendu {{expected}}, reçu {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Doit contenir au moins {{min}} caractères",
	"validation.string.max": "Doit contenir au plus {{max}} caractères",
	"validation.string.length": "Doit contenir exactement {{length}} caractères",
	"validation.string.email": "Adresse e-mail invalide",
	"validation.string.url": "URL invalide",
	"validation.string.uuid": "UUID invalide",
	"validation.string.regex": "Format invalide",
	"validation.string.startsWith": "Doit commencer par {{prefix}}",
	"validation.string.endsWith": "Doit se terminer par {{suffix}}",
	"validation.string.includes": "Doit inclure {{substring}}",
	"validation.string.datetime": "Format de date/heure invalide",
	"validation.string.ip": "Adresse IP invalide",
	"validation.string.base64": "Chaîne base64 invalide",

	// Number
	"validation.number.min": "Doit être au moins {{min}}",
	"validation.number.max": "Doit être au plus {{max}}",
	"validation.number.int": "Doit être un entier",
	"validation.number.positive": "Doit être un nombre positif",
	"validation.number.negative": "Doit être un nombre négatif",
	"validation.number.nonpositive": "Doit être zéro ou négatif",
	"validation.number.nonnegative": "Doit être zéro ou positif",
	"validation.number.multipleOf": "Doit être un multiple de {{value}}",
	"validation.number.finite": "Doit être un nombre fini",

	// Array
	"validation.array.min": {
		one: "Doit contenir au moins {{min}} élément",
		other: "Doit contenir au moins {{min}} éléments",
	},
	"validation.array.max": {
		one: "Doit contenir au plus {{max}} élément",
		other: "Doit contenir au plus {{max}} éléments",
	},
	"validation.array.length": {
		one: "Doit contenir exactement {{length}} élément",
		other: "Doit contenir exactement {{length}} éléments",
	},
	"validation.array.nonempty": "Doit contenir au moins un élément",

	// Date
	"validation.date.invalid": "Date invalide",
	"validation.date.min": "La date doit être après {{min}}",
	"validation.date.max": "La date doit être avant {{max}}",
	"validation.time.invalid": "Format d'heure invalide",

	// Other
	"validation.boolean.invalid": "Doit être true ou false",
	"validation.object.invalid": "Objet invalide",
	"validation.object.unrecognizedKeys": "Clés non reconnues : {{keys}}",
	"validation.enum.invalid": "Option invalide. Attendu une de : {{options}}",
	"validation.union.invalid": "Entrée invalide",
	"validation.file.tooLarge": "Le fichier doit être inférieur à {{max}}",
	"validation.file.invalidType":
		"Type de fichier invalide. Autorisés : {{types}}",
} as const;
