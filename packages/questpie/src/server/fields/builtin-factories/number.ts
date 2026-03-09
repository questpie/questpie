/**
 * Number Field Factory (V2)
 */

import {
	bigint as pgBigint,
	doublePrecision,
	integer,
	numeric,
	real,
	smallint,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { numberOps } from "../operators/builtin.js";
import { createField, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";

export type NumberFieldState = DefaultFieldState & {
	type: "number";
	data: number;
};

type NumberMode = "integer" | "smallint" | "bigint" | "real" | "double" | "decimal";

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
export function number(): Field<NumberFieldState>;
export function number(mode: Exclude<NumberMode, "decimal">): Field<NumberFieldState>;
export function number(config: DecimalConfig): Field<NumberFieldState>;
export function number(arg?: NumberMode | DecimalConfig): Field<NumberFieldState> {
	const isDecimalConfig = typeof arg === "object" && arg?.mode === "decimal";
	const mode: NumberMode = isDecimalConfig
		? "decimal"
		: typeof arg === "string"
			? arg
			: "integer";
	const precision = isDecimalConfig ? (arg as DecimalConfig).precision ?? 10 : undefined;
	const scale = isDecimalConfig ? (arg as DecimalConfig).scale ?? 2 : undefined;

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

	return createField<NumberFieldState>({
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
	});
}

/**
 * Add number-specific chain methods to Field.
 */
declare module "../field-class.js" {
	interface Field<TState> {
		/** Set minimum value (number fields). */
		min(n: number): Field<TState>;
		/** Set maximum value (number fields). */
		max(n: number): Field<TState>;
		/** Require positive value (number fields). */
		positive(): Field<TState>;
		/** Require integer value (number fields). */
		int(): Field<TState>;
		/** Set step increment (number fields). */
		step(n: number): Field<TState>;
	}
}

// NOTE: .min() and .max() are also declared in text.ts for string fields.
// The prototype methods below share the same property names on FieldRuntimeState,
// so they work for both text (minLength/maxLength) and number (min/max) fields.
// Text's .min()/.max() set minLength/maxLength, while number's set min/max.

Field.prototype.min = function (n: number) {
	// For text fields this is minLength; for number fields this is min
	const isString = ["text", "textarea", "email", "url"].includes(this._state.type);
	return isString
		? new Field({ ...this._state, minLength: n })
		: new Field({ ...this._state, min: n });
};

Field.prototype.max = function (n: number) {
	const isString = ["text", "textarea", "email", "url"].includes(this._state.type);
	return isString
		? new Field({ ...this._state, maxLength: n })
		: new Field({ ...this._state, max: n });
};

Field.prototype.positive = function () {
	return new Field({ ...this._state, positive: true });
};

Field.prototype.int = function () {
	return new Field({ ...this._state, int: true });
};

Field.prototype.step = function (n: number) {
	return new Field({ ...this._state, step: n });
};
