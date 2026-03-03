/**
 * Boolean Field Factory (V2)
 */

import { boolean as pgBoolean } from "drizzle-orm/pg-core";
import { z } from "zod";
import { booleanOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";

export type BooleanFieldState = DefaultFieldState & {
	type: "boolean";
	data: boolean;
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
	return createField<BooleanFieldState>({
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

import type { Field } from "../field.js";
