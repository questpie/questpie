/**
 * Builtin Field Factories — Barrel
 *
 * Each factory returns a Proxy-wrapped Field via wrapFieldComplete.
 * Type-specific chain methods come from the Proxy, not prototype patches.
 */

export {
	type BooleanFieldMeta,
	type BooleanFieldState,
	boolean,
} from "./boolean.js";
export { type DateFieldMeta, type DateFieldMethods, type DateFieldState, date } from "./date.js";
export {
	type DatetimeFieldMeta,
	type DatetimeFieldMethods,
	type DatetimeFieldState,
	datetime,
} from "./datetime.js";
export { type EmailFieldMeta, type EmailFieldMethods, type EmailFieldState, email } from "./email.js";
export { type CustomFieldState, type CustomFieldMethods, from } from "./from.js";
export {
	type JsonFieldMeta,
	type JsonFieldState,
	type JsonValue,
	json,
} from "./json.js";
export {
	type NumberFieldMeta,
	type NumberFieldMethods,
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
	type RelationFieldMethods,
	type RelationFieldState,
	relation,
} from "./relation.js";
export {
	type SelectFieldMeta,
	type SelectFieldMethods,
	type SelectFieldState,
	type SelectOption,
	select,
} from "./select.js";
// Named re-exports (factories + state types + meta augmentation interfaces)
export { type TextFieldMeta, type TextFieldMethods, type TextFieldState, text } from "./text.js";
export {
	type TextareaFieldMeta,
	type TextareaFieldMethods,
	type TextareaFieldState,
	textarea,
} from "./textarea.js";
export { type TimeFieldMeta, type TimeFieldState, time } from "./time.js";
export {
	type UploadFieldMeta,
	type UploadFieldMethods,
	type UploadFieldState,
	upload,
} from "./upload.js";
export { type UrlFieldMeta, type UrlFieldMethods, type UrlFieldState, url } from "./url.js";

// ============================================================================
// Builtin Fields Map
// ============================================================================

import { boolean } from "./boolean.js";
import { date } from "./date.js";
import { datetime } from "./datetime.js";
import { email } from "./email.js";
import { from } from "./from.js";
import { json } from "./json.js";
import { number } from "./number.js";
import { object } from "./object.js";
import { relation } from "./relation.js";
import { select } from "./select.js";
import { text } from "./text.js";
import { textarea } from "./textarea.js";
import { time } from "./time.js";
import { upload } from "./upload.js";
import { url } from "./url.js";

/**
 * All builtin field factories as a single map.
 * Used by codegen-generated factories and the field builder proxy.
 */
export const builtinFields = {
	text,
	textarea,
	email,
	url,
	number,
	boolean,
	date,
	datetime,
	time,
	select,
	upload,
	relation,
	object,
	json,
	from,
} as const;

/**
 * Type for the builtin fields map.
 */
export type BuiltinFields = typeof builtinFields;
