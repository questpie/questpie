/**
 * Define Field Helper
 *
 * Uses the curried "as const satisfies" pattern for type-safe field definitions.
 * Each field is defined as a plain object with generic methods — the concrete
 * return types (especially getOperators) are fully preserved by TypeScript.
 *
 * @example
 * ```ts
 * export const textField = field<TextFieldConfig, string>()({
 *   type: "text" as const,
 *   _value: undefined as unknown as string,
 *   toColumn(name: string, config: TextFieldConfig) { ... },
 *   getOperators<TApp>(config: TextFieldConfig) {
 *     return { column: stringColumnOperators, jsonb: stringJsonbOperators };
 *   },
 *   toZodSchema(config: TextFieldConfig) { ... },
 *   getMetadata(config: TextFieldConfig) { ... },
 * });
 * ```
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import type {
  BaseFieldConfig,
  ContextualOperators,
  FieldDefinition,
  FieldDefinitionState,
  FieldLocation,
  FieldMetadata,
  JoinBuilder,
  SelectModifier,
} from "./types.js";

// ============================================================================
// Type Helpers for State Inference (from config only)
// ============================================================================

/**
 * Infer field location from config.
 * - localized: true → "i18n"
 * - virtual: true | SQL → "virtual"
 * - Otherwise → "main"
 */
type InferFieldLocation<TConfig extends BaseFieldConfig> = TConfig extends {
  virtual: true | SQL<unknown>;
}
  ? "virtual"
  : TConfig extends { localized: true }
    ? "i18n"
    : "main";

/**
 * Infer input type from config.
 * Handles required, default, virtual, input options.
 */
type InferInputType<TConfig extends BaseFieldConfig, TValue> = TConfig extends {
  // Virtual fields: no input by default (unless input: true)
  virtual: true | SQL<unknown>;
}
  ? TConfig extends { input: true }
    ? TValue | undefined
    : never
  : // Input explicitly disabled
    TConfig extends { input: false }
    ? never
    : // Input optional (field is nullable in DB)
      TConfig extends { input: "optional" }
      ? TValue | undefined
      : // Required field
        TConfig extends { required: true }
        ? TValue
        : // Has default value
          TConfig extends { default: infer TDefault }
          ? TDefault extends () => infer _TReturn
            ? TValue | undefined // Factory function
            : TValue | undefined // Static default
          : TValue | null | undefined; // Nullable by default

/**
 * Infer output type from config.
 * Handles output: false and access.read functions.
 */
type InferOutputType<
  TConfig extends BaseFieldConfig,
  TValue,
> = TConfig extends { output: false } // Output explicitly disabled
  ? never
  : TConfig extends { access: { read: (...args: unknown[]) => unknown } }
    ? // Access control with function = might be filtered at runtime
        | (TConfig extends { required: true }
            ? TConfig extends { nullable: true }
              ? TValue | null
              : TValue
            : TConfig extends { nullable: false }
              ? TValue
              : TValue | null)
        | undefined
    : // Output nullability mirrors column nullability (required/nullable)
      TConfig extends { required: true }
      ? TConfig extends { nullable: true }
        ? TValue | null
        : TValue
      : TConfig extends { nullable: false }
        ? TValue
        : TValue | null;

/**
 * Infer select type from config.
 * Defaults to output type unless overridden by field definitions.
 *
 * Exported so FieldSelect can reuse nullability logic for object/array fields
 * instead of reimplementing it.
 */
export type InferSelectType<
  TConfig extends BaseFieldConfig,
  TValue,
> = InferOutputType<TConfig, TValue>;

/**
 * Infer column type from config.
 * Virtual fields have null columns.
 */
type InferColumnType<
  TConfig extends BaseFieldConfig,
  TColumn extends AnyPgColumn | null,
> = TConfig extends { virtual: true | SQL<unknown> } ? null : TColumn;

/**
 * Narrow the value type for relation/upload fields based on config.
 *
 * Relation fields are defined with a wide union value
 * `string | string[] | { type: string; id: string } | null` to cover all
 * relation variants. This type narrows it based on the actual config:
 * - hasMany/through/multiple/morphName → string[]
 * - polymorphic (to: Record) → { type: string; id: string } | null
 * - default (belongsTo) → string | null
 *
 * Upload fields similarly narrow from `string | string[]`:
 * - through → string[]
 * - default → string | null
 */
type NarrowFieldValue<
  TType extends string,
  TConfig,
  TValue,
> = TType extends "relation"
  ? TConfig extends { hasMany: true }
    ? string[]
    : TConfig extends { through: any }
      ? string[]
      : TConfig extends { multiple: true }
        ? string[]
        : TConfig extends { morphName: string }
          ? string[]
          : TConfig extends { to: Record<string, string> }
            ? { type: string; id: string } | null
            : string | null
  : TType extends "upload"
    ? TConfig extends { through: string }
      ? string[]
      : TConfig extends { multiple: true }
        ? string[]
        : string | null
    : TType extends "select"
      ? TConfig extends { multiple: true }
        ? string[]
        : string
      : TType extends "array"
        ? TConfig extends { of: FieldDefinition<infer TItemState extends FieldDefinitionState> }
          ? TItemState["value"][]
          : TValue
        : TType extends "object"
          ? TConfig extends { fields: infer TFields extends Record<string, FieldDefinition<FieldDefinitionState>> }
            ? { [K in keyof TFields]: TFields[K] extends FieldDefinition<infer TFS extends FieldDefinitionState> ? TFS["value"] : unknown }
            : TValue
          : TValue;

/**
 * Build complete field state from config + implementation.
 * This is the TState that FieldDefinition will use.
 *
 * @template TOps - Concrete operators type (e.g. typeof stringColumnOperators).
 */
export type BuildFieldState<
  TType extends string,
  TConfig extends BaseFieldConfig,
  TValue,
  TColumn extends AnyPgColumn | null,
  TOps extends ContextualOperators,
> = {
  type: TType;
  config: TConfig;
  value: NarrowFieldValue<TType, TConfig, TValue>;
  input: InferInputType<TConfig, NarrowFieldValue<TType, TConfig, TValue>>;
  output: InferOutputType<TConfig, NarrowFieldValue<TType, TConfig, TValue>>;
  select: InferSelectType<TConfig, NarrowFieldValue<TType, TConfig, TValue>>;
  column: InferColumnType<TConfig, TColumn>;
  location: InferFieldLocation<TConfig>;
  operators: TOps;
};

// ============================================================================
// Field Definition Shape (FieldDef)
// ============================================================================

/**
 * Type constraint for a field implementation object.
 * Validates shape without widening — used with the curried field pattern.
 *
 * @template TConfig - The field configuration type
 * @template TValue - The field value type
 */
export interface FieldDef<TConfig extends BaseFieldConfig, TValue> {
  /** Field type identifier (e.g. "text", "number", "relation") */
  type: string;

  /** Phantom property for value type inference. Not used at runtime. */
  _value?: TValue;

  /** Generate Drizzle column(s) for this field. */
  toColumn: (
    name: string,
    config: TConfig,
  ) => AnyPgColumn | AnyPgColumn[] | null;

  /** Generate Zod schema for input validation. */
  toZodSchema: (config: TConfig) => ZodType;

  /**
   * Get operators for where clauses.
   * Generic over TApp so relation fields can resolve target collection types.
   * For simple fields (text, number, etc.), TApp is unused.
   */
  getOperators: <TApp>(config: TConfig) => ContextualOperators;

  /** Get metadata for admin introspection. */
  getMetadata: (config: TConfig) => FieldMetadata;

  /** Optional: Get nested fields (for object/array types). */
  getNestedFields?: (
    config: TConfig,
  ) => Record<string, FieldDefinition<FieldDefinitionState>> | undefined;

  /** Optional: Modify select query (for relations, computed fields). */
  getSelectModifier?: (config: TConfig) => SelectModifier | undefined;

  /** Optional: Build joins for relation fields. */
  getJoinBuilder?: (config: TConfig) => JoinBuilder | undefined;

  /** Optional: Transform value after reading from DB. */
  fromDb?: (dbValue: unknown, config: TConfig) => TValue;

  /** Optional: Transform value before writing to DB. */
  toDb?: (value: TValue, config: TConfig) => unknown;
}

// ============================================================================
// Type Extraction Helpers
// ============================================================================

/**
 * Extract config type from a field def by looking at getOperators parameter.
 */
export type ExtractConfigFromFieldDef<TFieldDef> = TFieldDef extends {
  getOperators: (config: infer TConfig, ...args: any[]) => any;
}
  ? TConfig extends BaseFieldConfig
    ? TConfig
    : BaseFieldConfig
  : BaseFieldConfig;

/**
 * Extract value type from a field def's phantom _value property.
 */
export type ExtractValueFromFieldDef<TFieldDef> = TFieldDef extends {
  _value?: infer V;
}
  ? unknown extends V
    ? unknown
    : V
  : unknown;

/**
 * Extract field type string literal from a field def.
 */
export type ExtractTypeFromFieldDef<TFieldDef> = TFieldDef extends {
  type: infer T extends string;
}
  ? T
  : string;

/**
 * Extract concrete operators from a field def's getOperators return type.
 */
export type ExtractOpsFromFieldDef<TFieldDef> = TFieldDef extends {
  getOperators: (...args: any[]) => infer TOps;
}
  ? TOps extends ContextualOperators
    ? TOps
    : ContextualOperators
  : ContextualOperators;

// ============================================================================
// field — Curried "as const satisfies" Pattern
// ============================================================================

/**
 * Define a field type with full type inference.
 *
 * Uses the curried pattern to separate explicit type params from inferred ones:
 * - First call: provide TConfig and TValue explicitly
 * - Second call: provide implementation object — its concrete type (including
 *   getOperators return type) is fully preserved by TypeScript
 *
 * This avoids the TypeScript "all-or-nothing" inference problem where
 * specifying ANY explicit type params prevents inference of the rest.
 *
 * @example
 * ```ts
 * export const textField = field<TextFieldConfig, string>()({
 *   type: "text" as const,
 *   _value: undefined as unknown as string,
 *   toColumn(name: string, config: TextFieldConfig) {
 *     return varchar({ length: config.maxLength ?? 255 });
 *   },
 *   getOperators<TApp>(config: TextFieldConfig) {
 *     return { column: stringColumnOperators, jsonb: stringJsonbOperators };
 *   },
 *   toZodSchema(config: TextFieldConfig) { return z.string(); },
 *   getMetadata(config: TextFieldConfig) { return { type: "text" }; },
 * });
 * ```
 */
export const field =
  <TConfig extends BaseFieldConfig, TValue>() =>
  <const TImpl extends FieldDef<TConfig, TValue>>(impl: TImpl): TImpl =>
    impl;

// ============================================================================
// Runtime: Create FieldDefinition from a plain field def + config
// ============================================================================

/**
 * Create a FieldDefinition object from a plain field definition + user config.
 * Used at runtime by the FieldBuilderProxy to produce FieldDefinition instances.
 *
 * The typed overload preserves concrete types (operators, value, config) when
 * the field def and config types are known at call site.
 * The untyped overload is used for dynamic/registry-based creation.
 */
export function createFieldDefinition<
  TFieldDef extends FieldDef<any, any>,
  const TConfig extends ExtractConfigFromFieldDef<TFieldDef>,
>(
  fieldDef: TFieldDef,
  config: TConfig,
): FieldDefinition<
  BuildFieldState<
    ExtractTypeFromFieldDef<TFieldDef>,
    TConfig,
    ExtractValueFromFieldDef<TFieldDef>,
    AnyPgColumn,
    ExtractOpsFromFieldDef<TFieldDef>
  >
>;
export function createFieldDefinition(
  fieldDef: FieldDef<any, any>,
  config: any,
): FieldDefinition<FieldDefinitionState>;
export function createFieldDefinition(
  fieldDef: FieldDef<any, any>,
  config: any,
): FieldDefinition<FieldDefinitionState> {
  const fieldConfig = config ?? {};

  // Infer location from config at runtime
  const location: FieldLocation =
    "virtual" in fieldConfig &&
    (fieldConfig.virtual === true ||
      (typeof fieldConfig.virtual === "object" && fieldConfig.virtual !== null))
      ? "virtual"
      : fieldConfig.localized === true
        ? "i18n"
        : "main";

  const state = {
    type: fieldDef.type,
    config: fieldConfig,
    value: undefined,
    input: undefined,
    output: undefined,
    select: undefined,
    column: undefined,
    location,
    operators: undefined,
  };

  return {
    state,
    $types: {} as any,
    toColumn(name: string) {
      if (location === "virtual") {
        return null;
      }
      return fieldDef.toColumn(name, fieldConfig);
    },
    toZodSchema() {
      return fieldDef.toZodSchema(fieldConfig);
    },
    getOperators() {
      return fieldDef.getOperators(fieldConfig);
    },
    getMetadata() {
      return fieldDef.getMetadata(fieldConfig);
    },
    getNestedFields: fieldDef.getNestedFields
      ? () =>
          fieldDef.getNestedFields!(fieldConfig) as Record<
            string,
            FieldDefinition<FieldDefinitionState>
          >
      : undefined,
    getSelectModifier: fieldDef.getSelectModifier
      ? () => fieldDef.getSelectModifier!(fieldConfig)
      : undefined,
    getJoinBuilder: fieldDef.getJoinBuilder
      ? () => fieldDef.getJoinBuilder!(fieldConfig)
      : undefined,
    fromDb: fieldDef.fromDb
      ? (dbValue: unknown) => fieldDef.fromDb!(dbValue, fieldConfig)
      : undefined,
    toDb: fieldDef.toDb
      ? (value: unknown) => fieldDef.toDb!(value, fieldConfig)
      : undefined,
  } as unknown as FieldDefinition<FieldDefinitionState>;
}
