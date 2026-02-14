/**
 * Field Builder Proxy
 *
 * Creates a type-safe proxy object that provides field factory methods.
 * Usage: f.text({ required: true }), f.number({ min: 0 }), etc.
 *
 * Fields are plain objects (via field). The proxy wraps each field
 * into a callable factory: f.text(config) → FieldDefinition<...>.
 */

import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type { BuiltinFields } from "./builtin/defaults.js";

import {
  type BuildFieldState,
  createFieldDefinition,
  type ExtractConfigFromFieldDef,
  type ExtractOpsFromFieldDef,
  type ExtractTypeFromFieldDef,
  type ExtractValueFromFieldDef,
} from "./field.js";
import type { FieldDefinition, FieldDefinitionState } from "./types.js";

// ============================================================================
// Field Builder Proxy Types
// ============================================================================

// Re-export BuiltinFields for backwards compat
import type { BuiltinFields } from "./builtin/defaults.js";

/**
 * Default field type map for built-in fields.
 * @deprecated Use `BuiltinFields` instead
 */
export type DefaultFieldTypeMap = BuiltinFields;

/**
 * Field builder proxy type.
 * Maps plain field def objects to callable factories that produce FieldDefinition.
 *
 * Each property becomes a function: (config?) => FieldDefinition<BuildFieldState<...>>
 * The concrete operator types from getOperators are preserved through ExtractOpsFromFieldDef.
 *
 * @template TMap - The field type map to use (defaults to BuiltinFields)
 *
 * @example
 * ```ts
 * // Using the proxy:
 * const fields = {
 *   title: f.text({ required: true, maxLength: 255 }),
 *   count: f.number({ min: 0 }),
 *   isActive: f.boolean({ default: true }),
 * };
 * ```
 */
export type FieldBuilderProxy<TMap = BuiltinFields> = {
  [K in keyof TMap]: <
    const TUserConfig extends ExtractConfigFromFieldDef<TMap[K]>,
  >(
    config?: TUserConfig,
  ) => FieldDefinition<
    BuildFieldState<
      ExtractTypeFromFieldDef<TMap[K]>,
      TUserConfig extends undefined
        ? ExtractConfigFromFieldDef<TMap[K]>
        : TUserConfig,
      ExtractValueFromFieldDef<TMap[K]>,
      AnyPgColumn,
      ExtractOpsFromFieldDef<TMap[K]>
    >
  >;
};

// ============================================================================
// Field Builder Creation
// ============================================================================

/**
 * Create a field builder proxy from a plain field defs map.
 * Wraps each plain field def object into a callable factory using createFieldDefinition.
 *
 * @param fieldDefs - Map of field type names to plain field def objects (defaults to builtinFields)
 * @returns A proxy object with field factory methods
 *
 * @example
 * ```ts
 * import { builtinFields } from "questpie";
 *
 * const f = createFieldBuilder(builtinFields);
 *
 * const fields = {
 *   title: f.text({ required: true }),
 *   count: f.number(),
 * };
 * ```
 */
export function createFieldBuilder<TFields extends Record<string, any>>(
  fieldDefs: TFields,
): FieldBuilderProxy<TFields> {
  return new Proxy({} as FieldBuilderProxy<TFields>, {
    get(_target, prop: string) {
      const fieldDef = fieldDefs[prop];
      if (!fieldDef) {
        throw new Error(
          `Unknown field type: "${prop}". ` +
            `Available types: ${Object.keys(fieldDefs).join(", ")}`,
        );
      }
      // Return a factory function that wraps the plain field def
      return (config?: any) => createFieldDefinition(fieldDef, config);
    },
    has(_target, prop: string) {
      return prop in fieldDefs;
    },
    ownKeys() {
      return Object.keys(fieldDefs);
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (prop in fieldDefs) {
        return {
          configurable: true,
          enumerable: true,
          value: (config?: any) =>
            createFieldDefinition(fieldDefs[prop], config),
        };
      }
      return undefined;
    },
  });
}

/**
 * @deprecated Use `createFieldBuilder` instead
 */
export const createFieldBuilderFromDefs = createFieldBuilder;

// ============================================================================
// Field Definition Extraction
// ============================================================================

/**
 * Extract field definitions from a fields function result.
 * Separates field definitions from the Drizzle columns they generate.
 *
 * @param fields - Object with field definitions
 * @returns Object with both field definitions and extracted columns
 */
export function extractFieldDefinitions<
  TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
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
  TFactory extends (
    f: FieldBuilderProxy,
  ) => Record<string, FieldDefinition<FieldDefinitionState>>,
> = ReturnType<TFactory>;

/**
 * Type helper to extract value types from field definitions.
 */
export type FieldValues<
  TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
  [K in keyof TFields]: TFields[K]["$types"]["value"];
};

/**
 * Type helper to extract input types from field definitions.
 */
export type FieldInputs<
  TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
  [K in keyof TFields as TFields[K]["$types"]["input"] extends never
    ? never
    : K]: TFields[K]["$types"]["input"];
};

/**
 * Type helper to extract output types from field definitions.
 */
export type FieldOutputs<
  TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
  [K in keyof TFields as TFields[K]["$types"]["output"] extends never
    ? never
    : K]: TFields[K]["$types"]["output"];
};
