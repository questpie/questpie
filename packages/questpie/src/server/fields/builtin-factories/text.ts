/**
 * Text Field Factory (V2)
 */

import { text as pgText, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { stringOps } from "../operators/builtin.js";
import { createField, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";

export type TextFieldState = DefaultFieldState & {
	type: "text";
	data: string;
};

/**
 * Create a text field.
 *
 * @param maxLength - Max character length (default: 255). Use `{ mode: "text" }` for unlimited.
 *
 * @example
 * ```ts
 * name: f.text(255).required()
 * bio: f.text({ mode: "text" })
 * ```
 */
export function text(maxLength?: number): Field<TextFieldState>;
export function text(config: { mode: "text" }): Field<TextFieldState>;
export function text(arg?: number | { mode: "text" }): Field<TextFieldState> {
	const isTextMode = typeof arg === "object" && arg?.mode === "text";
	const maxLen = typeof arg === "number" ? arg : isTextMode ? undefined : 255;

	return createField<TextFieldState>({
		type: "text",
		columnFactory: (name) =>
			isTextMode ? pgText(name) : varchar(name, { length: maxLen }),
		schemaFactory: () => {
			let s = z.string();
			if (maxLen !== undefined) s = s.max(maxLen);
			return s;
		},
		operatorSet: stringOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		maxLength: maxLen,
	});
}

/**
 * Add text-specific chain methods to Field.
 * These are on the prototype so they're available after text() is called.
 *
 * NOTE: min/max are declared in number.ts which handles both text and number fields.
 */
declare module "../field-class.js" {
	interface Field<TState> {
		/** Set regex pattern (text fields). */
		pattern(re: RegExp): Field<TState>;
		/** Trim whitespace (text fields). */
		trim(): Field<TState>;
		/** Convert to lowercase (text fields). */
		lowercase(): Field<TState>;
		/** Convert to uppercase (text fields). */
		uppercase(): Field<TState>;
	}
}

// Patch prototype with text-specific methods
Field.prototype.pattern = function (re: RegExp) {
	return new Field({ ...this._state, pattern: re });
};

Field.prototype.trim = function () {
	return new Field({ ...this._state, trim: true });
};

Field.prototype.lowercase = function () {
	return new Field({ ...this._state, lowercase: true });
};

Field.prototype.uppercase = function () {
	return new Field({ ...this._state, uppercase: true });
};
