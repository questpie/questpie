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
import { field, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { numberOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
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
export function number(): Field<NumberFieldState>;
export function number(
	mode: Exclude<NumberMode, "decimal">,
): Field<NumberFieldState>;
export function number(config: DecimalConfig): Field<NumberFieldState>;
export function number(
	arg?: NumberMode | DecimalConfig,
): Field<NumberFieldState> {
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

	return field<NumberFieldState>({
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

// NOTE: .min() and .max() are also declared in text.ts for string fields.
// The prototype methods below share the same property names on FieldRuntimeState,
// so they work for both text (minLength/maxLength) and number (min/max) fields.
// Text's .min()/.max() set minLength/maxLength, while number's set min/max.

Field.prototype.min = function (n: number) {
	// For text fields this is minLength; for number fields this is min
	const isString = ["text", "textarea", "email", "url"].includes(
		this._state.type,
	);
	return isString
		? new Field({ ...this._state, minLength: n })
		: new Field({ ...this._state, min: n });
};

Field.prototype.max = function (n: number) {
	const isString = ["text", "textarea", "email", "url"].includes(
		this._state.type,
	);
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
