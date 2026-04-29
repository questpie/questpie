/**
 * German Validation Messages
 */
export const validationMessagesDE = {
	// General
	"validation.required": "Dieses Feld ist erforderlich",
	"validation.invalidType": "Erwartet {{expected}}, erhalten {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Muss mindestens {{min}} Zeichen lang sein",
	"validation.string.max": "Darf höchstens {{max}} Zeichen lang sein",
	"validation.string.length": "Muss genau {{length}} Zeichen lang sein",
	"validation.string.email": "Ungültige E-Mail-Adresse",
	"validation.string.url": "Ungültige URL",
	"validation.string.uuid": "Ungültige UUID",
	"validation.string.regex": "Ungültiges Format",
	"validation.string.startsWith": "Muss mit {{prefix}} beginnen",
	"validation.string.endsWith": "Muss mit {{suffix}} enden",
	"validation.string.includes": "Muss {{substring}} enthalten",
	"validation.string.datetime": "Ungültiges Datums-/Uhrzeitformat",
	"validation.string.ip": "Ungültige IP-Adresse",
	"validation.string.base64": "Ungültige Base64-Zeichenfolge",

	// Number
	"validation.number.min": "Muss mindestens {{min}} sein",
	"validation.number.max": "Darf höchstens {{max}} sein",
	"validation.number.int": "Muss eine Ganzzahl sein",
	"validation.number.positive": "Muss eine positive Zahl sein",
	"validation.number.negative": "Muss eine negative Zahl sein",
	"validation.number.nonpositive": "Muss null oder negativ sein",
	"validation.number.nonnegative": "Muss null oder positiv sein",
	"validation.number.multipleOf": "Muss ein Vielfaches von {{value}} sein",
	"validation.number.finite": "Muss eine endliche Zahl sein",

	// Array
	"validation.array.min": {
		one: "Muss mindestens {{min}} Element enthalten",
		other: "Muss mindestens {{min}} Elemente enthalten",
	},
	"validation.array.max": {
		one: "Darf höchstens {{max}} Element enthalten",
		other: "Darf höchstens {{max}} Elemente enthalten",
	},
	"validation.array.length": {
		one: "Muss genau {{length}} Element enthalten",
		other: "Muss genau {{length}} Elemente enthalten",
	},
	"validation.array.nonempty": "Muss mindestens ein Element enthalten",

	// Date
	"validation.date.invalid": "Ungültiges Datum",
	"validation.date.min": "Datum muss nach {{min}} liegen",
	"validation.date.max": "Datum muss vor {{max}} liegen",
	"validation.time.invalid": "Ungültiges Uhrzeitformat",

	// Other
	"validation.boolean.invalid": "Muss true oder false sein",
	"validation.object.invalid": "Ungültiges Objekt",
	"validation.object.unrecognizedKeys": "Unbekannte Schlüssel: {{keys}}",
	"validation.enum.invalid": "Ungültige Option. Erwartet eine von: {{options}}",
	"validation.union.invalid": "Ungültige Eingabe",
	"validation.file.tooLarge": "Datei muss kleiner als {{max}} sein",
	"validation.file.invalidType": "Ungültiger Dateityp. Erlaubt: {{types}}",
} as const;
