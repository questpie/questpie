/**
 * URL Field Factory
 */

import { type PgVarcharBuilder, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { urlOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface UrlFieldMeta {}
	}
}

export interface UrlFieldMeta extends Questpie.UrlFieldMeta {
	_?: never;
}

export type UrlFieldState = DefaultFieldState & {
	type: "url";
	data: string;
	column: PgVarcharBuilder<[string, ...string[]]>;
	operators: typeof urlOps;
};

export interface UrlFieldMethods {
	min(n: number): any;
	max(n: number): any;
}

/**
 * Create a URL field with built-in URL validation.
 *
 * @param maxLength - Max character length (default: 2048)
 *
 * @example
 * ```ts
 * website: f.url().required()
 * link: f.url(500)
 * ```
 */
export function url(maxLength = 2048): FieldWithMethods<UrlFieldState, UrlFieldMethods> {
	return wrapFieldComplete(field<UrlFieldState>({
		type: "url",
		columnFactory: (name) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().url().max(maxLength),
		operatorSet: urlOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		maxLength,
	}), urlFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const urlFieldType = fieldType("url", {
	create: (maxLength: number = 2048) => ({
		type: "url",
		columnFactory: (name: string) => varchar(name, { length: maxLength }),
		schemaFactory: () => z.string().url().max(maxLength),
		operatorSet: urlOps,
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
