/**
 * English Validation Messages (Default)
 */
export const validationMessagesEN = {
  // General
  "validation.required": "This field is required",
  "validation.invalidType": "Expected {{expected}}, received {{received}}",
  "validation.custom": "{{message}}",

  // String
  "validation.string.min": "Must be at least {{min}} characters",
  "validation.string.max": "Must be at most {{max}} characters",
  "validation.string.length": "Must be exactly {{length}} characters",
  "validation.string.email": "Invalid email address",
  "validation.string.url": "Invalid URL",
  "validation.string.uuid": "Invalid UUID",
  "validation.string.regex": "Invalid format",
  "validation.string.startsWith": "Must start with {{prefix}}",
  "validation.string.endsWith": "Must end with {{suffix}}",
  "validation.string.includes": "Must include {{substring}}",
  "validation.string.datetime": "Invalid date/time format",
  "validation.string.ip": "Invalid IP address",
  "validation.string.base64": "Invalid base64 string",

  // Number
  "validation.number.min": "Must be at least {{min}}",
  "validation.number.max": "Must be at most {{max}}",
  "validation.number.int": "Must be an integer",
  "validation.number.positive": "Must be a positive number",
  "validation.number.negative": "Must be a negative number",
  "validation.number.nonpositive": "Must be zero or negative",
  "validation.number.nonnegative": "Must be zero or positive",
  "validation.number.multipleOf": "Must be a multiple of {{value}}",
  "validation.number.finite": "Must be a finite number",

  // Array
  "validation.array.min": {
    one: "Must have at least {{min}} item",
    other: "Must have at least {{min}} items",
  },
  "validation.array.max": {
    one: "Must have at most {{max}} item",
    other: "Must have at most {{max}} items",
  },
  "validation.array.length": {
    one: "Must have exactly {{length}} item",
    other: "Must have exactly {{length}} items",
  },
  "validation.array.nonempty": "Must have at least one item",

  // Date
  "validation.date.invalid": "Invalid date",
  "validation.date.min": "Date must be after {{min}}",
  "validation.date.max": "Date must be before {{max}}",
  "validation.time.invalid": "Invalid time format",

  // Other
  "validation.boolean.invalid": "Must be true or false",
  "validation.object.invalid": "Invalid object",
  "validation.object.unrecognizedKeys": "Unrecognized keys: {{keys}}",
  "validation.enum.invalid": "Invalid option. Expected one of: {{options}}",
  "validation.union.invalid": "Invalid input",
  "validation.file.tooLarge": "File must be smaller than {{max}}",
  "validation.file.invalidType": "Invalid file type. Allowed: {{types}}",
} as const;
