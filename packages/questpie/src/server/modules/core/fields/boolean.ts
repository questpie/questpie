/**
 * Boolean Field Factory
 */

import {
	type PgBooleanBuilder,
	boolean as pgBoolean,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import { booleanOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
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
	return wrapFieldComplete(field<BooleanFieldState>({
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
	}), booleanFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const booleanFieldType = fieldType("boolean", {
	create: () => ({
		type: "boolean",
		columnFactory: (name: string) => pgBoolean(name),
		schemaFactory: () => z.boolean(),
		operatorSet: booleanOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
});
