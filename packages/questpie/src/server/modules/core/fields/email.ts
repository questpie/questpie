/**
 * Email Field Factory
 */

import { type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { emailOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface EmailFieldMeta {}
	}
}

export interface EmailFieldMeta extends Questpie.EmailFieldMeta {
	_?: never;
}

export type EmailFieldState = DefaultFieldState & {
	type: "email";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof emailOps;
};

export interface EmailFieldMethods {
	min(n: number): any;
	max(n: number): any;
}

/**
 * Create an email field with built-in email validation.
 *
 * @param maxLength - Max character length (default: 255)
 *
 * @example
 * ```ts
 * email: f.email().required()
 * ```
 */
export function email(maxLength = 255): FieldWithMethods<EmailFieldState, EmailFieldMethods> {
	return wrapFieldComplete(field<EmailFieldState>({
		type: "email",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().email().max(maxLength),
		operatorSet: emailOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		maxLength,
	}), emailFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const emailFieldType = fieldType("email", {
	create: (maxLength: number = 255) => ({
		type: "email",
		columnFactory: (name: string) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().email().max(maxLength),
		operatorSet: emailOps,
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
		min: (f: Field<any>, n: number) => f.derive({ minLength: n }),
		max: (f: Field<any>, n: number) => f.derive({ maxLength: n }),
	},
});
