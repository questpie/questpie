/**
 * Field Builder
 *
 * Defines reusable field types with form and cell components.
 */

import type { SetProperty } from "questpie/shared";
import type React from "react";
import type { z } from "zod";
import type {
  BaseFieldConfigProps,
  BaseFieldProps,
  MaybeLazyComponent,
} from "../types/common";
import type { FieldHookContext, SelectOption } from "../types/field-types";

// ============================================================================
// Zod Schema Building Context
// ============================================================================

/**
 * Context provided to createZod callbacks for building nested schemas
 */
export interface ZodBuildContext {
  /**
   * Recursively builds a Zod schema for any field definition.
   * Use this for nested fields in object/array types.
   */
  buildSchema: (fieldDef: FieldDefinition) => z.ZodTypeAny;

  /**
   * Field registry for resolving nested fields callbacks.
   * Used to create the `r` proxy in `fields: ({ r }) => ({...})`
   */
  registry: Record<string, FieldBuilder<any>>;
}

/**
 * Function type for creating Zod schema from field options
 */
export type CreateZodFn<TOptions = any> = (
  opts: TOptions,
  ctx: ZodBuildContext,
) => z.ZodTypeAny;

/**
 * Field state options (readOnly, disabled, hidden)
 */
export interface FieldStateOptions {
  /**
   * Whether field is read-only (can be dynamic based on form values).
   * Read-only fields look normal but cannot be edited.
   * Note: Fields with `compute` are automatically read-only.
   */
  readOnly?: boolean | ((values: Record<string, any>) => boolean);

  /**
   * Whether field is disabled (can be dynamic based on form values).
   * Disabled fields appear grayed out and cannot be edited.
   */
  disabled?: boolean | ((values: Record<string, any>) => boolean);

  /**
   * Whether field is hidden (can be dynamic based on form values).
   * Hidden fields are not rendered. Default is false (visible).
   *
   * Note: undefined/false = visible, true = hidden
   * This follows JavaScript falsy semantics for better DX.
   */
  hidden?: boolean | ((values: Record<string, any>) => boolean);
}

/**
 * Hook options for field interactivity
 */
export interface FieldHookOptions {
  /**
   * Compute field value from other fields (proxy-tracked dependencies).
   * Makes the field read-only and virtual (not submitted to backend).
   *
   * Dependencies are automatically detected via Proxy tracking.
   * Works in both forms (reactive) and tables (static).
   *
   * @example
   * ```ts
   * pricePerMinute: r.number({
   *   compute: (values) => values.price / values.duration,
   * })
   * ```
   */
  compute?: (values: Record<string, any>) => any;

  /**
   * Called when field value changes.
   * Use for side effects like updating other fields.
   * Can be async for API calls.
   *
   * @example
   * ```ts
   * name: r.text({
   *   onChange: (value, { setValue }) => {
   *     setValue('slug', slugify(value));
   *   },
   * })
   * ```
   */
  onChange?: (value: any, ctx: FieldHookContext) => void | Promise<void>;

  /**
   * Dynamic default value for new records.
   * Can be a static value, sync function, or async function.
   * Only evaluated when creating new records (not on edit).
   *
   * @example
   * ```ts
   * status: r.select({
   *   defaultValue: 'draft',
   *   // or dynamic:
   *   defaultValue: async () => fetchDefaultStatus(),
   * })
   * ```
   */
  defaultValue?:
    | any
    | ((values: Record<string, any>) => any)
    | ((values: Record<string, any>) => Promise<any>);

  /**
   * Async options loader for select-type fields.
   * Dependencies are automatically detected via Proxy tracking.
   *
   * @example
   * ```ts
   * subcategory: r.select({
   *   loadOptions: async (values) => {
   *     // Automatically re-fetches when values.category changes
   *     return fetchSubcategories(values.category);
   *   },
   * })
   * ```
   */
  loadOptions?: (values: Record<string, any>) => Promise<SelectOption[]>;
}

/**
 * UI options that can be set when defining a field in a collection.
 * These are the "soft" options from BaseFieldProps that make sense in config.
 */
export type FieldUIOptions = Partial<
  Pick<
    BaseFieldConfigProps,
    "label" | "description" | "placeholder" | "required"
  > &
    Pick<BaseFieldProps, "localized">
> &
  FieldStateOptions &
  FieldHookOptions;

/**
 * Field definition - stored in admin registry
 */
export interface FieldDefinition<
  TName extends string = string,
  TOptions = any,
> {
  readonly name: TName;
  readonly "~options": TOptions;
  field: { component: MaybeLazyComponent };
  cell?: { component: MaybeLazyComponent };
  /**
   * Creates a Zod schema from field options.
   * If not provided, a generic schema based on field type will be used.
   */
  createZod?: CreateZodFn<TOptions>;
}

/**
 * Field builder state
 */
export interface FieldBuilderState {
  readonly name: string;
  readonly "~options": any;
  readonly component: MaybeLazyComponent;
  readonly cellComponent?: MaybeLazyComponent;
  readonly createZod?: CreateZodFn;
}

/**
 * Field builder class
 *
 * Also implements FieldDefinition interface so it can be used directly in registries.
 */
export class FieldBuilder<
  TState extends FieldBuilderState,
> implements FieldDefinition<TState["name"], TState["~options"]> {
  constructor(public readonly state: TState) {}

  // Implement FieldDefinition interface via getters
  get name(): TState["name"] {
    return this.state.name;
  }

  get "~options"(): TState["~options"] {
    return this.state["~options"];
  }

  get field() {
    return { component: this.state.component };
  }

  get cell() {
    return this.state.cellComponent
      ? { component: this.state.cellComponent }
      : undefined;
  }

  get createZod(): CreateZodFn<TState["~options"]> | undefined {
    return this.state.createZod;
  }

  /**
   * Override options - returns new builder with updated state
   */
  $options<TNewOptions>(
    options: TNewOptions,
  ): FieldBuilder<SetProperty<TState, "~options", TNewOptions>> {
    return new FieldBuilder({
      ...this.state,
      "~options": options,
    } as any);
  }

  /**
   * Set cell component for table views
   */
  withCell<TNewCellComponent extends MaybeLazyComponent>(
    component: TNewCellComponent,
  ): FieldBuilder<SetProperty<TState, "cellComponent", TNewCellComponent>> {
    return new FieldBuilder({
      ...this.state,
      cellComponent: component,
    } as any);
  }
}

/**
 * Inferred options type for a field
 */
type InferFieldOptions<
  TConfig extends Record<string, any>,
  TComponent extends MaybeLazyComponent,
> = [TConfig] extends [Record<string, never>]
  ? ExtractComponentOptions<TComponent>
  : TConfig & FieldUIOptions;

/**
 * Create a field definition
 *
 * @param name - Field type name (e.g. "text", "relation")
 * @param config - Component and optional config type
 *
 * @example
 * ```ts
 * // With explicit config type and createZod
 * const relationField = field("relation", {
 *   component: RelationField,
 *   config: {} as RelationFieldConfig,
 *   createZod: (opts, ctx) => z.string(),
 * });
 *
 * // Without config (infers from component props)
 * const textField = field("text", {
 *   component: TextField,
 *   createZod: (opts) => {
 *     let schema = z.string();
 *     if (opts.maxLength) schema = schema.max(opts.maxLength);
 *     return opts.required ? schema : schema.optional().nullable();
 *   },
 * });
 * ```
 */
export function field<
  TName extends string,
  TConfig extends Record<string, any> = Record<string, never>,
  TComponent extends MaybeLazyComponent = MaybeLazyComponent,
  TCellComponent extends MaybeLazyComponent | undefined = undefined,
>(
  name: TName,
  options: {
    component: TComponent;
    cell?: TCellComponent;
    config?: TConfig;
    /**
     * Creates a Zod schema from field options.
     * Called during form validation schema generation.
     */
    createZod?: CreateZodFn<InferFieldOptions<TConfig, TComponent>>;
  },
): FieldBuilder<{
  name: TName;
  "~options": InferFieldOptions<TConfig, TComponent>;
  component: TComponent;
  cellComponent: TCellComponent;
  createZod: typeof options.createZod;
}> {
  return new FieldBuilder({
    name,
    "~options": {} as any,
    component: options.component,
    cellComponent: options.cell,
    createZod: options.createZod,
  } as any);
}

/**
 * Extract field-specific options from component props.
 * Omits BaseFieldProps to get only field-specific config.
 */
type ExtractComponentOptions<TComponent> =
  TComponent extends React.ComponentType<infer TProps>
    ? Omit<TProps, keyof BaseFieldProps> & FieldUIOptions
    : Record<string, never>;
