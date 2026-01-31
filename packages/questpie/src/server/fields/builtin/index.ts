/**
 * Built-in Field Types
 *
 * Re-exports all built-in field type definitions and factories.
 * Import this module to register all built-in fields with the default registry.
 */

// Text-based fields
export { textField, type TextFieldConfig } from "./text.js";
export { textareaField, type TextareaFieldConfig } from "./textarea.js";
export { emailField, type EmailFieldConfig } from "./email.js";
export { urlField, type UrlFieldConfig } from "./url.js";

// Numeric fields
export { numberField, type NumberFieldConfig } from "./number.js";

// Boolean field
export { booleanField, type BooleanFieldConfig } from "./boolean.js";

// Date/Time fields
export { dateField, type DateFieldConfig } from "./date.js";
export { datetimeField, type DatetimeFieldConfig } from "./datetime.js";
export { timeField, type TimeFieldConfig } from "./time.js";

// Select/Enum field
export { selectField, type SelectFieldConfig, type SelectOption } from "./select.js";

// Upload field
export { uploadField, type UploadFieldConfig } from "./upload.js";

// Relation fields
export {
	relationField,
	type RelationFieldConfig,
	type RelationType,
	type ReferentialAction,
} from "./relation.js";
export {
	polymorphicRelationField,
	type PolymorphicRelationConfig,
	type PolymorphicReference,
} from "./polymorphic-relation.js";

// Complex fields
export { objectField, type ObjectFieldConfig } from "./object.js";
export { arrayField, type ArrayFieldConfig } from "./array.js";
export { jsonField, type JsonFieldConfig, type JsonValue } from "./json.js";

/**
 * Default field factories map.
 * Use this with QuestpieBuilder.fields() to register all built-in fields.
 *
 * @example
 * ```ts
 * import { questpie, defaultFields } from "@questpie/server";
 *
 * const q = questpie({ name: "app" })
 *   .fields(defaultFields);
 * ```
 */
export { defaultFields } from "./defaults.js";
