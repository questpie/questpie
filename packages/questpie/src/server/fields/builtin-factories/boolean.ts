/**
 * Boolean Field Factory
 */

import {
	type PgBooleanBuilder,
	boolean as pgBoolean,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";
import { booleanOps } from "../operators/builtin.js";

declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Augmentation point
		interface BooleanFieldMeta {}
	}
}

export interface BooleanFieldMeta extends Questpie.BooleanFieldMeta {
	_?: never;
}

export type BooleanFieldState = DefaultFieldState & {
	type: "boolean";
	data: boolean;
	column: PgBooleanBuilder;
	operators: typeof booleanOps;
};

/**
 * Create a boolean field.
 *
 * @example
 * ```ts
 * isActive: f.boolean().default(true)
 * isPublished: f.boolean().required()
 * ```
 */
export function boolean(): Field<BooleanFieldState> {
	return field<BooleanFieldState>({
		type: "boolean",
		columnFactory: (name) => pgBoolean(name),
		schemaFactory: () => z.boolean(),
		operatorSet: booleanOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	});
}

import type { Field } from "../field-class.js";
