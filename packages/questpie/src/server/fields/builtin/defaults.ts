/**
 * Builtin Field Definitions
 *
 * Provides a map of all built-in field definitions for use with QuestpieBuilder.fields().
 */

import { arrayField } from "./array.js";
import { booleanField } from "./boolean.js";
import { dateField } from "./date.js";
import { datetimeField } from "./datetime.js";
import { emailField } from "./email.js";
import { jsonField } from "./json.js";
import { numberField } from "./number.js";
import { objectField } from "./object.js";
import { relationField } from "./relation.js";
import { selectField } from "./select.js";
import { textField } from "./text.js";
import { textareaField } from "./textarea.js";
import { timeField } from "./time.js";
import { uploadField } from "./upload.js";
import { urlField } from "./url.js";

/**
 * Built-in field definitions map.
 * Use this with QuestpieBuilder.fields() to register all built-in fields.
 *
 * @example
 * ```ts
 * import { questpie, builtinFields } from "questpie";
 *
 * const q = questpie({ name: "app" })
 *   .fields(builtinFields);
 *
 * // Now use q to define collections:
 * const posts = q.collection("posts")
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     content: f.textarea({ required: true }),
 *     publishedAt: f.datetime(),
 *   }));
 * ```
 */
export const builtinFields = {
  // Text-based
  text: textField,
  textarea: textareaField,
  email: emailField,
  url: urlField,

  // Numeric
  number: numberField,

  // Boolean
  boolean: booleanField,

  // Date/Time
  date: dateField,
  datetime: datetimeField,
  time: timeField,

  // Selection
  select: selectField,

  // Upload
  upload: uploadField,

  // Relations
  relation: relationField,

  // Complex types
  object: objectField,
  array: arrayField,
  json: jsonField,
} as const;

/**
 * Type for the builtin fields map.
 */
export type BuiltinFields = typeof builtinFields;

/**
 * @deprecated Use `builtinFields` instead
 */
export const defaultFields = builtinFields;

/**
 * @deprecated Use `BuiltinFields` instead
 */
export type DefaultFields = BuiltinFields;
