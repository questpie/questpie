/**
 * V2 Builtin Field Factories — Barrel
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

// Named re-exports
export { text, type TextFieldState } from "./text.js";
export { textarea, type TextareaFieldState } from "./textarea.js";
export { email, type EmailFieldState } from "./email.js";
export { url, type UrlFieldState } from "./url.js";
export { number, type NumberFieldState } from "./number.js";
export { boolean, type BooleanFieldState } from "./boolean.js";
export { date, type DateFieldState } from "./date.js";
export { datetime, type DatetimeFieldState } from "./datetime.js";
export { time, type TimeFieldState } from "./time.js";
export { select, type SelectOption, type SelectFieldState } from "./select.js";
export { json, type JsonFieldState, type JsonValue } from "./json.js";
export { object, type ObjectFieldState } from "./object.js";
export { from, type CustomFieldState } from "./from.js";
