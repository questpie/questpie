/**
 * Default Field Factories
 *
 * Provides a map of all built-in field factories for use with QuestpieBuilder.fields().
 */

import { textField } from "./text.js";
import { textareaField } from "./textarea.js";
import { emailField } from "./email.js";
import { urlField } from "./url.js";
import { numberField } from "./number.js";
import { booleanField } from "./boolean.js";
import { dateField } from "./date.js";
import { datetimeField } from "./datetime.js";
import { timeField } from "./time.js";
import { selectField } from "./select.js";
import { uploadField } from "./upload.js";
import { relationField } from "./relation.js";
import { polymorphicRelationField } from "./polymorphic-relation.js";
import { objectField } from "./object.js";
import { arrayField } from "./array.js";
import { jsonField } from "./json.js";

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
 *
 * // Now use q to define collections:
 * const posts = collection("posts")
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     content: f.textarea({ required: true }),
 *     publishedAt: f.datetime(),
 *   }));
 *
 * q.collections({ posts }).build({ ... });
 * ```
 */
export const defaultFields = {
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
	polymorphicRelation: polymorphicRelationField,

	// Complex types
	object: objectField,
	array: arrayField,
	json: jsonField,
} as const;

/**
 * Type for the default fields map.
 */
export type DefaultFields = typeof defaultFields;
