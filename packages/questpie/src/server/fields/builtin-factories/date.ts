/**
 * Date Field Factory (V2)
 */

import { date as pgDate } from "drizzle-orm/pg-core";
import { z } from "zod";
import { dateOps } from "../operators/builtin.js";
import { createField, Field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";

export type DateFieldState = DefaultFieldState & {
	type: "date";
	data: string;
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
	return createField<DateFieldState>({
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

/**
 * Add date-specific chain methods to Field.
 */
declare module "../field-class.js" {
	interface Field<TState> {
		/** Auto-set to current date/time on create. */
		autoNow(): Field<TState & { hasDefault: true }>;
		/** Auto-update to current date/time on every update. */
		autoNowUpdate(): Field<TState>;
	}
}

Field.prototype.autoNow = function () {
	return new Field({
		...this._state,
		hasDefault: true,
		defaultValue: () => new Date(),
	});
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
