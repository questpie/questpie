/**
 * Builtin Field Factories — Barrel
 *
 * Import side effects: text.ts and number.ts patch Field.prototype
 * with chain methods (max, min, pattern, trim, etc.)
 */

// Side-effect imports: patch Field.prototype
import "./text.js";
import "./number.js";
import "./date.js";
import "./select.js";
import "./from.js";
import "./relation.js";

export {
	type BooleanFieldMeta,
	type BooleanFieldState,
	boolean,
} from "./boolean.js";
export { type DateFieldMeta, type DateFieldState, date } from "./date.js";
export {
	type DatetimeFieldMeta,
	type DatetimeFieldState,
	datetime,
} from "./datetime.js";
export { type EmailFieldMeta, type EmailFieldState, email } from "./email.js";
export { type CustomFieldState, from } from "./from.js";
export {
	type JsonFieldMeta,
	type JsonFieldState,
	type JsonValue,
	json,
} from "./json.js";
export {
	type NumberFieldMeta,
	type NumberFieldState,
	number,
} from "./number.js";
export {
	type ObjectFieldMeta,
	type ObjectFieldState,
	object,
} from "./object.js";
export {
	type RelationFieldMeta,
	type RelationFieldState,
	relation,
} from "./relation.js";
export {
	type SelectFieldMeta,
	type SelectFieldState,
	type SelectOption,
	select,
} from "./select.js";
// Named re-exports (factories + state types + meta augmentation interfaces)
export { type TextFieldMeta, type TextFieldState, text } from "./text.js";
export {
	type TextareaFieldMeta,
	type TextareaFieldState,
	textarea,
} from "./textarea.js";
export { type TimeFieldMeta, type TimeFieldState, time } from "./time.js";
export {
	type UploadFieldMeta,
	type UploadFieldState,
	upload,
} from "./upload.js";
export { type UrlFieldMeta, type UrlFieldState, url } from "./url.js";
