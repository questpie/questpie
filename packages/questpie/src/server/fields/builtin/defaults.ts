/**
 * Builtin Field Factories
 *
 * Maps field type names to V2 factory functions.
 * Each factory returns a Field<TState> instance with chain methods.
 *
 * @example
 * ```ts
 * collection("posts").fields(({ f }) => ({
 *   title: f.text(255).required(),
 *   content: f.textarea().localized(),
 *   publishedAt: f.datetime(),
 * }))
 * ```
 */

import {
	boolean,
	date,
	datetime,
	email,
	from,
	json,
	number,
	object,
	relation,
	select,
	text,
	textarea,
	time,
	upload,
	url,
} from "../builtin-factories/index.js";

export const builtinFields = {
	// Text-based
	text,
	textarea,
	email,
	url,

	// Numeric
	number,

	// Boolean
	boolean,

	// Date/Time
	date,
	datetime,
	time,

	// Selection
	select,

	// Upload
	upload,

	// Relations
	relation,

	// Complex types
	object,
	json,

	// Custom
	from,
} as const;

/**
 * Type for the builtin fields map.
 */
export type BuiltinFields = typeof builtinFields;
