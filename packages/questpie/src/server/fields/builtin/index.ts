/**
 * Built-in Field Types — Barrel
 *
 * Re-exports field factories and the builtinFields map.
 */

// Factories + meta augmentation interfaces
export {
	type BooleanFieldMeta,
	type BooleanFieldState,
	boolean,
	type CustomFieldState,
	type DateFieldMeta,
	type DateFieldState,
	type DatetimeFieldMeta,
	type DatetimeFieldState,
	date,
	datetime,
	type EmailFieldMeta,
	type EmailFieldState,
	email,
	from,
	type JsonFieldMeta,
	type JsonFieldState,
	type JsonValue,
	json,
	type NumberFieldMeta,
	type NumberFieldState,
	number,
	type ObjectFieldMeta,
	type ObjectFieldState,
	object,
	type RelationFieldMeta,
	type RelationFieldState,
	relation,
	type SelectFieldMeta,
	type SelectFieldState,
	type SelectOption,
	select,
	type TextareaFieldMeta,
	type TextareaFieldState,
	type TextFieldMeta,
	type TextFieldState,
	type TimeFieldMeta,
	type TimeFieldState,
	text,
	textarea,
	time,
	type UploadFieldMeta,
	type UploadFieldState,
	type UrlFieldMeta,
	type UrlFieldState,
	upload,
	url,
} from "../builtin-factories/index.js";

// Array field meta (.array() chain method, no separate factory)
export type { ArrayFieldMeta } from "../field-class-types.js";
// Re-export types from types.ts
export type {
	InferredRelationType,
	ReferentialAction,
	RelationFieldMetadata,
	SelectFieldMetadata,
} from "../types.js";
// Builtin fields map
export { type BuiltinFields, builtinFields } from "./defaults.js";
