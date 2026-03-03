/**
 * Datetime Field Factory (V2)
 */

import { timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";
import { dateOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type DatetimeFieldState = DefaultFieldState & {
	type: "datetime";
	data: Date;
};

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
export function datetime(config?: DatetimeConfig): Field<DatetimeFieldState> {
	const { precision = 3, withTimezone = true } = config ?? {};

	return createField<DatetimeFieldState>({
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
	});
}

import type { Field } from "../field.js";
