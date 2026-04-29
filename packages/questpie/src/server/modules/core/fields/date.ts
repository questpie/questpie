/**
 * Date Field Factory
 */

import { type PgDateStringBuilder, date as pgDate } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field, Field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { dateOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface DateFieldMeta {}
	}
}

export interface DateFieldMeta extends Questpie.DateFieldMeta {
	_?: never;
}

export type DateFieldState = DefaultFieldState & {
	type: "date";
	data: string;
	column: PgDateStringBuilder;
	operators: typeof dateOps;
};

export interface DateFieldMethods {
	autoNow(): any;
	autoNowUpdate(): any;
}

/**
 * Create a date field (ISO date string, stored as `date` in PostgreSQL).
 *
 * @example
 * ```ts
 * birthDate: f.date().required()
 * startDate: f.date().default("2024-01-01")
 * ```
 */
export function date(): FieldWithMethods<DateFieldState, DateFieldMethods> {
	return wrapFieldComplete(field<DateFieldState>({
		type: "date",
		columnFactory: (name) => pgDate(name, { mode: "string" }),
		schemaFactory: () => z.string().date(),
		operatorSet: dateOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), dateFieldType.methods, {}) as any;
}

// ---- fieldType() definition (QUE-265) ----

export const dateFieldType = fieldType("date", {
	create: () => ({
		type: "date",
		columnFactory: (name: string) => pgDate(name, { mode: "string" }),
		schemaFactory: () => z.string().date(),
		operatorSet: dateOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
	methods: {
		autoNow: (f: Field<any>) =>
			f.derive({ hasDefault: true, defaultValue: () => new Date() }),
		autoNowUpdate: (f: Field<any>) =>
			f.derive({
				hooks: {
					...(f._state.hooks ?? {}),
					beforeChange: () => new Date(),
				},
			}),
	},
});
