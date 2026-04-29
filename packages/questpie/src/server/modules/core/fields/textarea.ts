/**
 * Textarea Field Factory
 */

import { type PgTextBuilder, text as pgText } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { stringOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface TextareaFieldMeta {}
	}
}

export interface TextareaFieldMeta extends Questpie.TextareaFieldMeta {
	_?: never;
}

export type TextareaFieldState = DefaultFieldState & {
	type: "textarea";
	data: string;
	column: PgTextBuilder;
	operators: typeof stringOps;
};

export interface TextareaFieldMethods {
	min(n: number): any;
	max(n: number): any;
}

/**
 * Create a textarea field (long text, stored as `text` in PostgreSQL).
 *
 * @example
 * ```ts
 * bio: f.textarea().label({ en: "Biography" })
 * ```
 */
export function textarea(): FieldWithMethods<TextareaFieldState, TextareaFieldMethods> {
	return wrapFieldComplete(field<TextareaFieldState>({
		type: "textarea",
		columnFactory: (name) => pgText(name),
		schemaFactory: () => z.string(),
		operatorSet: stringOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), textareaFieldType.methods, {}) as any;
}

// Re-export Field to avoid missing import in return type
import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const textareaFieldType = fieldType("textarea", {
	create: () => ({
		type: "textarea",
		columnFactory: (name: string) => pgText(name),
		schemaFactory: () => z.string(),
		operatorSet: stringOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
	methods: {
		min: (f: Field<any>, n: number) => f.derive({ minLength: n }),
		max: (f: Field<any>, n: number) => f.derive({ maxLength: n }),
	},
});
