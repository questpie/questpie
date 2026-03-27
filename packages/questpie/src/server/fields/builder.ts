/**
 * Field Builder
 *
 * Creates a type-safe context object providing field factory methods.
 * Usage: f.text(255).required(), f.number().min(0), etc.
 */

import type { BuiltinFields } from "./builtin-factories/index.js";

export type { BuiltinFields } from "./builtin-factories/index.js";

import type { FieldState } from "./field-class-types.js";
import type { Field } from "./field-class.js";

// ============================================================================
// Field Builder Proxy Types
// ============================================================================

/**
 * Field builder proxy type.
 * Each property IS the factory function that returns a Field<TState> builder.
 *
 * @template TMap - The field type map to use (defaults to BuiltinFields)
 *
 * @example
 * ```ts
 * // Using the proxy:
 * const fields = {
 *   title: f.text(255).required(),
 *   count: f.number().min(0),
 *   isActive: f.boolean().default(true),
 * };
 * ```
 */
export type FieldBuilderProxy<TMap = BuiltinFields> = TMap;

// ============================================================================
// Fields Callback Context
// ============================================================================

/**
 * Context object passed to the `.fields()` callback.
 * Always use destructured syntax: `({ f }) => ...`
 *
 * @example
 * ```ts
 * collection("posts").fields(({ f }) => ({
 *   title: f.text(255).required(),
 *   content: f.textarea(),
 * }))
 * ```
 */
export type FieldsCallbackContext<TFieldTypes = BuiltinFields> = {
	f: FieldBuilderProxy<TFieldTypes>;
};

/**
 * Create a fields callback context object `{ f }` from field definitions.
 */
export function createFieldsCallbackContext<
	TFields extends Record<string, any>,
>(fieldDefs: TFields): FieldsCallbackContext<TFields> {
	return { f: createFieldBuilder(fieldDefs) };
}

// ============================================================================
// Field Builder Creation
// ============================================================================

/**
 * Create a field builder from a field factories map.
 * Wraps the map in a Proxy for nice error messages on unknown field types.
 *
 * @param fieldDefs - Map of field type names to factory functions
 * @returns A proxy object with field factory methods
 *
 * @example
 * ```ts
 * import { builtinFields } from "questpie";
 *
 * const f = createFieldBuilder(builtinFields);
 *
 * const fields = {
 *   title: f.text(255).required(),
 *   count: f.number(),
 * };
 * ```
 */
export function createFieldBuilder<TFields extends Record<string, any>>(
	fieldDefs: TFields,
): FieldBuilderProxy<TFields> {
	return new Proxy(fieldDefs as FieldBuilderProxy<TFields>, {
		get(target: any, prop: string) {
			if (prop in target) {
				return target[prop];
			}
			throw new Error(
				`Unknown field type: "${prop}". ` +
					`Available types: ${Object.keys(target).join(", ")}`,
			);
		},
	});
}

// ============================================================================
// Field Definition Extraction
// ============================================================================

/**
 * Any field instance.
 */
type AnyField = Field<FieldState>;

/**
 * Extract field definitions from a fields function result.
 * Separates field definitions from the Drizzle columns they generate.
 *
 * @param fields - Object with field definitions
 * @returns Object with both field definitions and extracted columns
 */
export function extractFieldDefinitions<
	TFields extends Record<string, AnyField>,
>(
	fields: TFields,
): {
	definitions: TFields;
	columns: Record<string, unknown>;
} {
	const columns: Record<string, unknown> = {};

	for (const [name, fieldDef] of Object.entries(fields)) {
		const column = fieldDef.toColumn(name);
		if (column !== null) {
			if (Array.isArray(column)) {
				// Multiple columns (e.g., polymorphic relation with type + id)
				for (const col of column) {
					const colName = (col as { name?: string }).name ?? name;
					columns[colName] = col;
				}
			} else {
				columns[name] = column;
			}
		}
	}

	return {
		definitions: fields,
		columns,
	};
}

/**
 * Type helper to infer field types from a fields factory function.
 */
export type InferFieldsFromFactory<
	TFactory extends (f: FieldBuilderProxy) => Record<string, AnyField>,
> = ReturnType<TFactory>;

/**
 * Type helper to extract value types from field definitions.
 */
export type FieldValues<TFields extends Record<string, AnyField>> = {
	[K in keyof TFields]: TFields[K]["$types"]["value"];
};

/**
 * Type helper to extract input types from field definitions.
 */
export type FieldInputs<TFields extends Record<string, AnyField>> = {
	[K in keyof TFields as TFields[K]["$types"]["input"] extends never
		? never
		: K]: TFields[K]["$types"]["input"];
};

/**
 * Type helper to extract output types from field definitions.
 */
export type FieldOutputs<TFields extends Record<string, AnyField>> = {
	[K in keyof TFields as TFields[K]["$types"]["output"] extends never
		? never
		: K]: TFields[K]["$types"]["output"];
};
