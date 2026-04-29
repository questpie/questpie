/**
 * Czech Validation Messages
 */
export const validationMessagesCS = {
	// General
	"validation.required": "Toto pole je povinné",
	"validation.invalidType": "Očekáván typ {{expected}}, přijat {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Musí mít alespoň {{min}} znaků",
	"validation.string.max": "Musí mít nejvýše {{max}} znaků",
	"validation.string.length": "Musí mít přesně {{length}} znaků",
	"validation.string.email": "Neplatná e-mailová adresa",
	"validation.string.url": "Neplatná URL adresa",
	"validation.string.uuid": "Neplatné UUID",
	"validation.string.regex": "Neplatný formát",
	"validation.string.startsWith": "Musí začínat na {{prefix}}",
	"validation.string.endsWith": "Musí končit na {{suffix}}",
	"validation.string.includes": "Musí obsahovat {{substring}}",
	"validation.string.datetime": "Neplatný formát data/času",
	"validation.string.ip": "Neplatná IP adresa",
	"validation.string.base64": "Neplatný řetězec base64",

	// Number
	"validation.number.min": "Musí být alespoň {{min}}",
	"validation.number.max": "Musí být nejvýše {{max}}",
	"validation.number.int": "Musí být celé číslo",
	"validation.number.positive": "Musí být kladné číslo",
	"validation.number.negative": "Musí být záporné číslo",
	"validation.number.nonpositive": "Musí být nula nebo záporné",
	"validation.number.nonnegative": "Musí být nula nebo kladné",
	"validation.number.multipleOf": "Musí být násobkem {{value}}",
	"validation.number.finite": "Musí být konečné číslo",

	// Array
	"validation.array.min": {
		one: "Musí obsahovat alespoň {{min}} položku",
		few: "Musí obsahovat alespoň {{min}} položky",
		other: "Musí obsahovat alespoň {{min}} položek",
	},
	"validation.array.max": {
		one: "Musí obsahovat nejvýše {{max}} položku",
		few: "Musí obsahovat nejvýše {{max}} položky",
		other: "Musí obsahovat nejvýše {{max}} položek",
	},
	"validation.array.length": {
		one: "Musí obsahovat přesně {{length}} položku",
		few: "Musí obsahovat přesně {{length}} položky",
		other: "Musí obsahovat přesně {{length}} položek",
	},
	"validation.array.nonempty": "Musí obsahovat alespoň jednu položku",

	// Date
	"validation.date.invalid": "Neplatné datum",
	"validation.date.min": "Datum musí být po {{min}}",
	"validation.date.max": "Datum musí být před {{max}}",
	"validation.time.invalid": "Neplatný formát času",

	// Other
	"validation.boolean.invalid": "Musí být true nebo false",
	"validation.object.invalid": "Neplatný objekt",
	"validation.object.unrecognizedKeys": "Neznámé klíče: {{keys}}",
	"validation.enum.invalid": "Neplatná možnost. Očekáváno jedno z: {{options}}",
	"validation.union.invalid": "Neplatný vstup",
	"validation.file.tooLarge": "Soubor musí být menší než {{max}}",
	"validation.file.invalidType": "Neplatný typ souboru. Povolené: {{types}}",
} as const;
