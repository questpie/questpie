/**
 * Custom Field Factory
 *
 * Escape hatch for creating fields from arbitrary Drizzle column builders
 * and optional Zod schemas. Useful for PostGIS, custom types, etc.
 */

import { z, type ZodType } from "zod";
import { basicOps } from "../operators/builtin.js";
import { field } from "../field-class.js";
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

	return field<CustomFieldState>({
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

import { Field } from "../field-class.js";

Field.prototype.type = function (typeName: string) {
	return new Field({ ...this._state, customType: typeName });
};
