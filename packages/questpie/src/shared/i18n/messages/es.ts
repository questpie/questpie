/**
 * Spanish Validation Messages
 */
export const validationMessagesES = {
	// General
	"validation.required": "Este campo es obligatorio",
	"validation.invalidType": "Se esperaba {{expected}}, se recibió {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Debe tener al menos {{min}} caracteres",
	"validation.string.max": "Debe tener como máximo {{max}} caracteres",
	"validation.string.length": "Debe tener exactamente {{length}} caracteres",
	"validation.string.email": "Dirección de correo electrónico no válida",
	"validation.string.url": "URL no válida",
	"validation.string.uuid": "UUID no válido",
	"validation.string.regex": "Formato no válido",
	"validation.string.startsWith": "Debe empezar por {{prefix}}",
	"validation.string.endsWith": "Debe terminar en {{suffix}}",
	"validation.string.includes": "Debe incluir {{substring}}",
	"validation.string.datetime": "Formato de fecha/hora no válido",
	"validation.string.ip": "Dirección IP no válida",
	"validation.string.base64": "Cadena base64 no válida",

	// Number
	"validation.number.min": "Debe ser al menos {{min}}",
	"validation.number.max": "Debe ser como máximo {{max}}",
	"validation.number.int": "Debe ser un número entero",
	"validation.number.positive": "Debe ser un número positivo",
	"validation.number.negative": "Debe ser un número negativo",
	"validation.number.nonpositive": "Debe ser cero o negativo",
	"validation.number.nonnegative": "Debe ser cero o positivo",
	"validation.number.multipleOf": "Debe ser un múltiplo de {{value}}",
	"validation.number.finite": "Debe ser un número finito",

	// Array
	"validation.array.min": {
		one: "Debe tener al menos {{min}} elemento",
		other: "Debe tener al menos {{min}} elementos",
	},
	"validation.array.max": {
		one: "Debe tener como máximo {{max}} elemento",
		other: "Debe tener como máximo {{max}} elementos",
	},
	"validation.array.length": {
		one: "Debe tener exactamente {{length}} elemento",
		other: "Debe tener exactamente {{length}} elementos",
	},
	"validation.array.nonempty": "Debe tener al menos un elemento",

	// Date
	"validation.date.invalid": "Fecha no válida",
	"validation.date.min": "La fecha debe ser posterior a {{min}}",
	"validation.date.max": "La fecha debe ser anterior a {{max}}",
	"validation.time.invalid": "Formato de hora no válido",

	// Other
	"validation.boolean.invalid": "Debe ser true o false",
	"validation.object.invalid": "Objeto no válido",
	"validation.object.unrecognizedKeys": "Claves no reconocidas: {{keys}}",
	"validation.enum.invalid":
		"Opción no válida. Se esperaba una de: {{options}}",
	"validation.union.invalid": "Entrada no válida",
	"validation.file.tooLarge": "El archivo debe ser menor que {{max}}",
	"validation.file.invalidType":
		"Tipo de archivo no válido. Permitidos: {{types}}",
} as const;
