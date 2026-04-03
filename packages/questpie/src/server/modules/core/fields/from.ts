/**
 * Custom Field Factory
 *
 * Escape hatch for creating fields from arbitrary Drizzle column builders
 * and optional Zod schemas. Useful for PostGIS, custom types, etc.
 */

import { z, type ZodType } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import type { FieldWithMethods } from "../../../fields/field-with-methods.js";
import { basicOps } from "../../../fields/operators/builtin.js";

export type CustomFieldState = DefaultFieldState & {
	type: "custom";
	data: unknown;
};

export interface CustomFieldMethods {
	type(typeName: string): any;
}

/**
 * Create a field from an arbitrary Drizzle column builder.
 *
 * @param column - A Drizzle column builder instance or factory
 * @param zodSchema - Optional Zod schema for validation (auto-derived as z.unknown() if omitted)
 *
 * @example
 * ```ts
 * // PostGIS point field
 * location: f.from(
 *   geometry("", { type: "point", srid: 4326 }),
 *   z.object({ lat: z.number(), lng: z.number() })
 * ).required()
 *
 * // Custom column with auto-derived schema
 * data: f.from(customColumn(""))
 * ```
 */
export function from(
	column: unknown,
	zodSchema?: ZodType,
): FieldWithMethods<CustomFieldState, CustomFieldMethods> {
	// If column is a column builder instance, wrap it as a factory
	const isFactory = typeof column === "function";
	const columnFactory = isFactory
		? (column as (name: string) => unknown)
		: (_name: string) => column;

	return wrapFieldComplete(field<CustomFieldState>({
		type: "custom",
		columnFactory,
		schemaFactory: zodSchema ? () => zodSchema : () => z.unknown(),
		operatorSet: basicOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), fromFieldType.methods, {}) as any;
}

import { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const fromFieldType = fieldType("custom", {
	create: (column: unknown, zodSchema?: ZodType) => {
		const isFactory = typeof column === "function";
		const columnFactory = isFactory
			? (column as (name: string) => unknown)
			: (_name: string) => column;

		return {
			type: "custom",
			columnFactory,
			schemaFactory: zodSchema ? () => zodSchema : () => z.unknown(),
			operatorSet: basicOps,
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
		type: (f: Field<any>, typeName: string) =>
			f.derive({ customType: typeName } as any),
	},
});
