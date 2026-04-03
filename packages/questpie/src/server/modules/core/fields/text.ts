/**
 * Text Field Factory
 */

import {
	type PgVarcharBuilder,
	text as pgText,
	varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field, Field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { stringOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
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

export interface TextFieldMethods {
	pattern(re: RegExp): any;
	trim(): any;
	lowercase(): any;
	uppercase(): any;
	min(n: number): any;
	max(n: number): any;
}

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
export function text(maxLength?: number): FieldWithMethods<TextFieldState, TextFieldMethods>;
export function text(config: { mode: "text" }): FieldWithMethods<TextFieldState, TextFieldMethods>;
export function text(arg?: number | { mode: "text" }): FieldWithMethods<TextFieldState, TextFieldMethods> {
	const isTextMode = typeof arg === "object" && arg?.mode === "text";
	const maxLen = typeof arg === "number" ? arg : isTextMode ? undefined : 255;

	return wrapFieldComplete(field<TextFieldState>({
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
	}), textFieldType.methods, {}) as any;
}

// ---- fieldType() definition (QUE-265) ----

export const textFieldType = fieldType("text", {
	create: (maxLength: number = 255) => ({
		type: "text",
		columnFactory: (name: string) => varchar(name, { length: maxLength }),
		schemaFactory: () => {
			let s = z.string();
			if (maxLength !== undefined) s = s.max(maxLength);
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
		maxLength,
	}),
	methods: {
		pattern: (f: Field<any>, re: RegExp) => f.derive({ pattern: re }),
		trim: (f: Field<any>) => f.derive({ trim: true }),
		lowercase: (f: Field<any>) => f.derive({ lowercase: true }),
		uppercase: (f: Field<any>) => f.derive({ uppercase: true }),
		min: (f: Field<any>, n: number) => f.derive({ minLength: n }),
		max: (f: Field<any>, n: number) => f.derive({ maxLength: n }),
	},
});
