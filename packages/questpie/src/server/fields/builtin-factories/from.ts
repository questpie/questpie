/**
 * Custom Field Factory (V2)
 *
 * Escape hatch for creating fields from arbitrary Drizzle column builders
 * and optional Zod schemas. Useful for PostGIS, custom types, etc.
 */

import { z, type ZodType } from "zod";
import { basicOps } from "../operators/builtin.js";
import { createField } from "../field-class.js";
import type { DefaultFieldState } from "../field-class-types.js";

export type CustomFieldState = DefaultFieldState & {
	type: "custom";
	data: unknown;
};

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
): Field<CustomFieldState> {
	// If column is a column builder instance, wrap it as a factory
	const isFactory = typeof column === "function";
	const columnFactory = isFactory
		? (column as (name: string) => unknown)
		: (_name: string) => column;

	return createField<CustomFieldState>({
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
	});
}

/**
 * Add type-setting chain method to Field (for custom fields).
 */
declare module "../field-class.js" {
	interface Field<TState> {
		/** Set the field type string (for admin UI mapping). */
		type(typeName: string): Field<TState>;
	}
}

import { Field } from "../field-class.js";

Field.prototype.type = function (typeName: string) {
	return new Field({ ...this._state, customType: typeName });
};
