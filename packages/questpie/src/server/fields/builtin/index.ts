/**
 * Built-in Field Types
 *
 * Re-exports all built-in field type definitions and factories.
 * Import this module to register all built-in fields with the default registry.
 *
 * NOTE: Module augmentation is no longer used.
 * Field types are now derived from questpie.state.fields at compile time.
 * DefaultFieldTypeMap is a type alias to DefaultFields in builder.ts.
 */

export {
  type ArrayFieldConfig,
  type ArrayFieldMeta,
  arrayField,
} from "./array.js";
// Boolean field
export {
  type BooleanFieldConfig,
  type BooleanFieldMeta,
  booleanField,
} from "./boolean.js";
// Date/Time fields
export { type DateFieldConfig, type DateFieldMeta, dateField } from "./date.js";
export {
  type DatetimeFieldConfig,
  type DatetimeFieldMeta,
  datetimeField,
} from "./datetime.js";
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
export { type DefaultFields, defaultFields } from "./defaults.js";
export {
  type EmailFieldConfig,
  type EmailFieldMeta,
  emailField,
} from "./email.js";
export {
  type JsonFieldConfig,
  type JsonFieldMeta,
  type JsonValue,
  jsonField,
} from "./json.js";
// Numeric fields
export {
  type NumberFieldConfig,
  type NumberFieldMeta,
  numberField,
} from "./number.js";
// Complex fields
export {
  type ObjectFieldConfig,
  type ObjectFieldMeta,
  objectField,
} from "./object.js";
// Relation fields
// Note: RelationFieldMetadata is exported from ../types.ts to avoid duplicate exports
// which cause TS4023 errors during declaration generation
export {
  type InferredRelationType,
  type InferredRelationType as RelationType, // Alias for backwards compatibility
  inferRelationType,
  type ReferentialAction,
  type RelationFieldConfig,
  type RelationFieldMeta,
  type RelationTarget,
  relationField,
} from "./relation.js";
// Select/Enum field
export {
  type SelectFieldConfig,
  type SelectFieldMeta,
  type SelectOption,
  selectField,
} from "./select.js";
// Text-based fields
export { type TextFieldConfig, type TextFieldMeta, textField } from "./text.js";
export {
  type TextareaFieldConfig,
  type TextareaFieldMeta,
  textareaField,
} from "./textarea.js";
export { type TimeFieldConfig, type TimeFieldMeta, timeField } from "./time.js";
// Upload field
export {
  type UploadFieldConfig,
  type UploadFieldMeta,
  uploadField,
} from "./upload.js";
export { type UrlFieldConfig, type UrlFieldMeta, urlField } from "./url.js";
