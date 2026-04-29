/**
 * Portuguese Validation Messages
 */
export const validationMessagesPT = {
	// General
	"validation.required": "Este campo é obrigatório",
	"validation.invalidType": "Esperado {{expected}}, recebido {{received}}",
	"validation.custom": "{{message}}",

	// String
	"validation.string.min": "Deve ter pelo menos {{min}} caracteres",
	"validation.string.max": "Deve ter no máximo {{max}} caracteres",
	"validation.string.length": "Deve ter exatamente {{length}} caracteres",
	"validation.string.email": "Endereço de e-mail inválido",
	"validation.string.url": "URL inválida",
	"validation.string.uuid": "UUID inválido",
	"validation.string.regex": "Formato inválido",
	"validation.string.startsWith": "Deve começar com {{prefix}}",
	"validation.string.endsWith": "Deve terminar com {{suffix}}",
	"validation.string.includes": "Deve incluir {{substring}}",
	"validation.string.datetime": "Formato de data/hora inválido",
	"validation.string.ip": "Endereço IP inválido",
	"validation.string.base64": "String base64 inválida",

	// Number
	"validation.number.min": "Deve ser pelo menos {{min}}",
	"validation.number.max": "Deve ser no máximo {{max}}",
	"validation.number.int": "Deve ser um número inteiro",
	"validation.number.positive": "Deve ser um número positivo",
	"validation.number.negative": "Deve ser um número negativo",
	"validation.number.nonpositive": "Deve ser zero ou negativo",
	"validation.number.nonnegative": "Deve ser zero ou positivo",
	"validation.number.multipleOf": "Deve ser um múltiplo de {{value}}",
	"validation.number.finite": "Deve ser um número finito",

	// Array
	"validation.array.min": {
		one: "Deve ter pelo menos {{min}} item",
		other: "Deve ter pelo menos {{min}} itens",
	},
	"validation.array.max": {
		one: "Deve ter no máximo {{max}} item",
		other: "Deve ter no máximo {{max}} itens",
	},
	"validation.array.length": {
		one: "Deve ter exatamente {{length}} item",
		other: "Deve ter exatamente {{length}} itens",
	},
	"validation.array.nonempty": "Deve ter pelo menos um item",

	// Date
	"validation.date.invalid": "Data inválida",
	"validation.date.min": "A data deve ser posterior a {{min}}",
	"validation.date.max": "A data deve ser anterior a {{max}}",
	"validation.time.invalid": "Formato de hora inválido",

	// Other
	"validation.boolean.invalid": "Deve ser true ou false",
	"validation.object.invalid": "Objeto inválido",
	"validation.object.unrecognizedKeys": "Chaves não reconhecidas: {{keys}}",
	"validation.enum.invalid": "Opção inválida. Esperado um de: {{options}}",
	"validation.union.invalid": "Entrada inválida",
	"validation.file.tooLarge": "O arquivo deve ser menor que {{max}}",
	"validation.file.invalidType":
		"Tipo de arquivo inválido. Permitidos: {{types}}",
} as const;
