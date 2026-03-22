/**
 * Time Field Factory
 */

import { type PgTimeBuilder, time as pgTime } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../field-class-types.js";
import { field } from "../field-class.js";
import { fieldType, wrapFieldComplete } from "../field-type.js";
import { dateOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		interface TimeFieldMeta {}
	}
}

export interface TimeFieldMeta extends Questpie.TimeFieldMeta {
	_?: never;
}

export type TimeFieldState = DefaultFieldState & {
	type: "time";
	data: string;
	column: PgTimeBuilder;
	operators: typeof dateOps;
};

interface TimeConfig {
	/** Time precision (0-6). @default 0 */
	precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
	/** Include seconds. @default true */
	withSeconds?: boolean;
}

/**
 * Create a time field (HH:MM:SS, stored as `time` in PostgreSQL).
 *
 * @example
 * ```ts
 * openingTime: f.time()
 * eventTime: f.time({ precision: 3 })
 * ```
 */
export function time(config?: TimeConfig): Field<TimeFieldState> {
	const { precision = 0, withSeconds = true } = config ?? {};

	const timePattern = withSeconds
		? /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?$/
		: /^([01]\d|2[0-3]):([0-5]\d)$/;

	return wrapFieldComplete(field<TimeFieldState>({
		type: "time",
		columnFactory: (name) => pgTime(name, { precision }),
		schemaFactory: () =>
			z.string().regex(timePattern, {
				message: withSeconds
					? "Invalid time format. Expected HH:MM:SS"
					: "Invalid time format. Expected HH:MM",
			}),
		operatorSet: dateOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), timeFieldType.methods, {}) as any;
}

import type { Field } from "../field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const timeFieldType = fieldType("time", {
	create: (config?: TimeConfig) => {
		const { precision = 0, withSeconds = true } = config ?? {};

		const timePattern = withSeconds
			? /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?$/
			: /^([01]\d|2[0-3]):([0-5]\d)$/;

		return {
			type: "time",
			columnFactory: (name: string) => pgTime(name, { precision }),
			schemaFactory: () =>
				z.string().regex(timePattern, {
					message: withSeconds
						? "Invalid time format. Expected HH:MM:SS"
						: "Invalid time format. Expected HH:MM",
				}),
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
});
