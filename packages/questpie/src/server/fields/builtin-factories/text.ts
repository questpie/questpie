/**
 * Text Field Factory
 */

import {
	type PgVarcharBuilder,
	text as pgText,
	varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { field, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { stringOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface TextFieldMeta {}
	}
}

export interface TextFieldMeta extends Questpie.TextFieldMeta {
	_?: never;
}

export type TextFieldState = DefaultFieldState & {
	type: "text";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof stringOps;
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

	return field<TextFieldState>({
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
