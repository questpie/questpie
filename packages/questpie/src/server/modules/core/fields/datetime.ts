/**
 * Datetime Field Factory
 */

import { type PgTimestampBuilder, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { dateOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface DatetimeFieldMeta {}
	}
}

export interface DatetimeFieldMeta extends Questpie.DatetimeFieldMeta {
	_?: never;
}

export type DatetimeFieldState = DefaultFieldState & {
	type: "datetime";
	data: Date;
	column: PgTimestampBuilder;
	operators: typeof dateOps;
};

export interface DatetimeFieldMethods {
	autoNow(): any;
	autoNowUpdate(): any;
}

interface DatetimeConfig {
	/** Timestamp precision (0-6). @default 3 */
	precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
	/** Store with timezone. @default true */
	withTimezone?: boolean;
}

/**
 * Create a datetime (timestamp) field.
 *
 * @example
 * ```ts
 * createdAt: f.datetime().autoNow().inputFalse()
 * updatedAt: f.datetime().autoNowUpdate().inputFalse()
 * publishedAt: f.datetime()
 * eventTime: f.datetime({ precision: 0 })
 * ```
 */
export function datetime(config?: DatetimeConfig): FieldWithMethods<DatetimeFieldState, DatetimeFieldMethods> {
	const { precision = 3, withTimezone = true } = config ?? {};

	return wrapFieldComplete(field<DatetimeFieldState>({
		type: "datetime",
		columnFactory: (name) =>
			timestamp(name, { precision, withTimezone, mode: "date" }),
		schemaFactory: () => z.coerce.date(),
		operatorSet: dateOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), datetimeFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const datetimeFieldType = fieldType("datetime", {
	create: (config?: DatetimeConfig) => {
		const { precision = 3, withTimezone = true } = config ?? {};

		return {
			type: "datetime",
			columnFactory: (name: string) =>
				timestamp(name, { precision, withTimezone, mode: "date" }),
			schemaFactory: () => z.coerce.date(),
			operatorSet: dateOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
		};
	},
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
