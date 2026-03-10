/**
 * Date Field Factory
 */

import { type PgDateStringBuilder, date as pgDate } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { dateOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
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

/**
 * Create a date field (ISO date string, stored as `date` in PostgreSQL).
 *
 * @example
 * ```ts
 * birthDate: f.date().required()
 * startDate: f.date().default("2024-01-01")
 * ```
 */
export function date(): Field<DateFieldState> {
	return field<DateFieldState>({
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
	});
}

Field.prototype.autoNow = function () {
	return new Field({
		...this._state,
		hasDefault: true,
		defaultValue: () => new Date(),
	}) as any;
};

Field.prototype.autoNowUpdate = function () {
	const existing = this._state.hooks ?? {};
	return new Field({
		...this._state,
		hooks: {
			...existing,
			beforeChange: () => new Date(),
		},
	});
};
