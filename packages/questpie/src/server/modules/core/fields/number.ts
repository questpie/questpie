/**
 * Number Field Factory
 */

import {
	doublePrecision,
	integer,
	numeric,
	type PgIntegerBuilder,
	bigint as pgBigint,
	real,
	smallint,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field, Field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { numberOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface NumberFieldMeta {}
	}
}

export interface NumberFieldMeta extends Questpie.NumberFieldMeta {
	_?: never;
}

export type NumberFieldState = DefaultFieldState & {
	type: "number";
	data: number;
	column: PgIntegerBuilder;
	operators: typeof numberOps;
};

export interface NumberFieldMethods {
	min(n: number): any;
	max(n: number): any;
	positive(): any;
	int(): any;
	step(n: number): any;
}

type NumberMode =
	| "integer"
	| "smallint"
	| "bigint"
	| "real"
	| "double"
	| "decimal";

interface DecimalConfig {
	mode: "decimal";
	precision?: number;
	scale?: number;
}

/**
 * Create a number field.
 *
 * @param mode - Storage mode (default: "integer")
 *
 * @example
 * ```ts
 * age: f.number().required()
 * price: f.number({ mode: "decimal", precision: 10, scale: 2 })
 * rating: f.number("real")
 * ```
 */
export function number(): FieldWithMethods<NumberFieldState, NumberFieldMethods>;
export function number(
	mode: Exclude<NumberMode, "decimal">,
): FieldWithMethods<NumberFieldState, NumberFieldMethods>;
export function number(config: DecimalConfig): FieldWithMethods<NumberFieldState, NumberFieldMethods>;
export function number(
	arg?: NumberMode | DecimalConfig,
): FieldWithMethods<NumberFieldState, NumberFieldMethods> {
	const isDecimalConfig = typeof arg === "object" && arg?.mode === "decimal";
	const mode: NumberMode = isDecimalConfig
		? "decimal"
		: typeof arg === "string"
			? arg
			: "integer";
	const precision = isDecimalConfig
		? ((arg as DecimalConfig).precision ?? 10)
		: undefined;
	const scale = isDecimalConfig
		? ((arg as DecimalConfig).scale ?? 2)
		: undefined;

	const columnFactory = (name: string) => {
		switch (mode) {
			case "smallint":
				return smallint(name);
			case "bigint":
				return pgBigint(name, { mode: "number" });
			case "real":
				return real(name);
			case "double":
				return doublePrecision(name);
			case "decimal":
				return numeric(name, { precision, scale, mode: "number" });
			case "integer":
			default:
				return integer(name);
		}
	};

	const isInt = mode === "integer" || mode === "smallint";

	return wrapFieldComplete(field<NumberFieldState>({
		type: "number",
		columnFactory,
		schemaFactory: () => {
			let s = z.number();
			if (isInt) s = s.int();
			return s;
		},
		operatorSet: numberOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		int: isInt,
	}), numberFieldType.methods, {}) as any;
}

// NOTE: .min() and .max() are also declared in text.ts for string fields.
// The prototype methods below share the same property names on FieldRuntimeState,
// so they work for both text (minLength/maxLength) and number (min/max) fields.
// Text's .min()/.max() set minLength/maxLength, while number's set min/max.

// ---- fieldType() definition (QUE-265) ----

export const numberFieldType = fieldType("number", {
	create: (mode: NumberMode = "integer") => {
		const isInt = mode === "integer" || mode === "smallint";

		const columnFactory = (name: string) => {
			switch (mode) {
				case "smallint":
					return smallint(name);
				case "bigint":
					return pgBigint(name, { mode: "number" });
				case "real":
					return real(name);
				case "double":
					return doublePrecision(name);
				case "decimal":
					return numeric(name, { precision: 10, scale: 2, mode: "number" });
				case "integer":
				default:
					return integer(name);
			}
		};

		return {
			type: "number",
			columnFactory,
			schemaFactory: () => {
				let s = z.number();
				if (isInt) s = s.int();
				return s;
			},
			operatorSet: numberOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
			int: isInt,
		};
	},
	methods: {
		min: (f: Field<any>, n: number) => f.derive({ min: n }),
		max: (f: Field<any>, n: number) => f.derive({ max: n }),
		positive: (f: Field<any>) => f.derive({ positive: true }),
		int: (f: Field<any>) => f.derive({ int: true }),
		step: (f: Field<any>, n: number) => f.derive({ step: n }),
	},
});
