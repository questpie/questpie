/**
 * Slovak Validation Messages
 */
export const validationMessagesSK = {
  // General
  "validation.required": "Toto pole je povinné",
  "validation.invalidType": "Očakávaný typ {{expected}}, prijatý {{received}}",
  "validation.custom": "{{message}}",

  // String
  "validation.string.min": "Minimálne {{min}} znakov",
  "validation.string.max": "Maximálne {{max}} znakov",
  "validation.string.length": "Presne {{length}} znakov",
  "validation.string.email": "Neplatná emailová adresa",
  "validation.string.url": "Neplatná URL adresa",
  "validation.string.uuid": "Neplatné UUID",
  "validation.string.regex": "Neplatný formát",
  "validation.string.startsWith": "Musí začínať na {{prefix}}",
  "validation.string.endsWith": "Musí končiť na {{suffix}}",
  "validation.string.includes": "Musí obsahovať {{substring}}",
  "validation.string.datetime": "Neplatný formát dátumu/času",
  "validation.string.ip": "Neplatná IP adresa",
  "validation.string.base64": "Neplatný base64 reťazec",

  // Number
  "validation.number.min": "Minimálne {{min}}",
  "validation.number.max": "Maximálne {{max}}",
  "validation.number.int": "Musí byť celé číslo",
  "validation.number.positive": "Musí byť kladné číslo",
  "validation.number.negative": "Musí byť záporné číslo",
  "validation.number.nonpositive": "Musí byť nula alebo záporné",
  "validation.number.nonnegative": "Musí byť nula alebo kladné",
  "validation.number.multipleOf": "Musí byť násobok {{value}}",
  "validation.number.finite": "Musí byť konečné číslo",

  // Array
  "validation.array.min": {
    one: "Minimálne {{min}} položka",
    few: "Minimálne {{min}} položky",
    other: "Minimálne {{min}} položiek",
  },
  "validation.array.max": {
    one: "Maximálne {{max}} položka",
    few: "Maximálne {{max}} položky",
    other: "Maximálne {{max}} položiek",
  },
  "validation.array.length": {
    one: "Presne {{length}} položka",
    few: "Presne {{length}} položky",
    other: "Presne {{length}} položiek",
  },
  "validation.array.nonempty": "Musí mať aspoň jednu položku",

  // Date
  "validation.date.invalid": "Neplatný dátum",
  "validation.date.min": "Dátum musí byť po {{min}}",
  "validation.date.max": "Dátum musí byť pred {{max}}",
  "validation.time.invalid": "Neplatný formát času",

  // Other
  "validation.boolean.invalid": "Musí byť true alebo false",
  "validation.object.invalid": "Neplatný objekt",
  "validation.object.unrecognizedKeys": "Neznáme kľúče: {{keys}}",
  "validation.enum.invalid": "Neplatná možnosť. Očakávané: {{options}}",
  "validation.union.invalid": "Neplatný vstup",
  "validation.file.tooLarge": "Súbor musí byť menší ako {{max}}",
  "validation.file.invalidType": "Neplatný typ súboru. Povolené: {{types}}",
} as const;
