/**
 * Built-in Field Definitions
 *
 * Using field builder to create all default fields.
 * Each field has explicit config type for proper autocomplete.
 * Each field includes createZod for automatic validation schema generation.
 */

import { z } from "zod";
import type { AssetPreviewFieldProps } from "../../components/fields/asset-preview-field.js";
import type { BlocksFieldConfig } from "../../components/fields/blocks-field/index.js";
import type {
  ArrayFieldConfig,
  BooleanFieldConfig,
  DateFieldConfig,
  DateTimeFieldConfig,
  JsonFieldConfig,
  NumberFieldConfig,
  ObjectFieldConfig,
  RelationFieldConfig,
  RichTextFieldConfig,
  SelectFieldConfig,
  TextareaFieldConfig,
  TextFieldConfig,
  TimeFieldConfig,
  UploadFieldConfig,
} from "../../components/fields/field-types.js";
import {
  ArrayField,
  AssetPreviewField,
  BlocksField,
  BooleanField,
  DateField,
  DatetimeField,
  EmailField,
  JsonField,
  NumberField,
  ObjectField,
  RelationField,
  RichTextField,
  SelectField,
  TextareaField,
  TextField,
  TimeField,
  UploadField,
} from "../../components/fields/index.js";
import {
  AssetThumbnail,
  BlocksCell,
  BooleanCell,
  DateCell,
  DateTimeCell,
  EmailCell,
  JsonCell,
  NumberCell,
  ObjectCell,
  RelationCell,
  RichTextCell,
  SelectCell,
  TextCell,
  TimeCell,
  UploadCell,
} from "../../views/collection/cells/index.js";
import {
  type FieldDefinition,
  field,
  type ZodBuildContext,
} from "../field/field";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wraps a schema as optional/nullable based on required option
 */
function wrapOptional<T extends z.ZodTypeAny>(
  schema: T,
  required?: boolean,
): z.ZodTypeAny {
  if (required) return schema;
  return schema.optional().nullable();
}

/**
 * Creates a field registry proxy for nested fields callbacks.
 * This allows `fields: ({ r }) => ({ name: r.text() })` to work.
 */
export function createRegistryProxy(
  registry: Record<string, any>,
): Record<string, (opts?: any) => any> {
  return new Proxy({} as Record<string, (opts?: any) => any>, {
    get(_, fieldType: string) {
      return (opts: any = {}) => {
        const fieldDef = registry[fieldType];
        if (!fieldDef) {
          throw new Error(`Unknown field type: ${fieldType}`);
        }
        // Return a new field builder with the provided options
        return fieldDef.$options(opts);
      };
    },
  });
}

/**
 * Recursively builds schema for nested fields using the context
 */
function buildNestedSchema(
  nestedFields: Record<string, FieldDefinition>,
  ctx: ZodBuildContext,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, fieldDef] of Object.entries(nestedFields)) {
    shape[name] = ctx.buildSchema(fieldDef);
  }
  return z.object(shape);
}

// ============================================================================
// Text-based Fields
// ============================================================================

export const textField = field("text", {
  component: TextField,
  cell: TextCell,
  config: {} as TextFieldConfig,
  createZod: (opts) => {
    let schema = z.string();
    if (opts.minLength) {
      schema = schema.min(
        opts.minLength,
        `Must be at least ${opts.minLength} characters`,
      );
    }
    if (opts.maxLength) {
      schema = schema.max(
        opts.maxLength,
        `Must be at most ${opts.maxLength} characters`,
      );
    }
    if (opts.pattern) {
      // Support pattern from server metadata validation
      const regex =
        typeof opts.pattern === "string"
          ? new RegExp(opts.pattern)
          : opts.pattern;
      schema = schema.regex(regex, "Invalid format");
    }
    return wrapOptional(schema, opts.required);
  },
});

export const numberField = field("number", {
  component: NumberField,
  cell: NumberCell,
  config: {} as NumberFieldConfig,
  createZod: (opts) => {
    let schema = z.number();
    if (opts.min !== undefined) {
      schema = schema.min(opts.min, `Must be at least ${opts.min}`);
    }
    if (opts.max !== undefined) {
      schema = schema.max(opts.max, `Must be at most ${opts.max}`);
    }
    return wrapOptional(schema, opts.required);
  },
});

export const emailField = field("email", {
  component: EmailField,
  cell: EmailCell,
  config: {} as TextFieldConfig,
  createZod: (opts) => {
    let schema = z.email("Invalid email address");
    if (opts.maxLength) {
      schema = schema.max(
        opts.maxLength,
        `Must be at most ${opts.maxLength} characters`,
      );
    }
    return wrapOptional(schema, opts.required);
  },
});

export const textareaField = field("textarea", {
  component: TextareaField,
  cell: TextCell,
  config: {} as TextareaFieldConfig,
  createZod: (opts) => {
    let schema = z.string();
    if (opts.minLength) {
      schema = schema.min(
        opts.minLength,
        `Must be at least ${opts.minLength} characters`,
      );
    }
    if (opts.maxLength) {
      schema = schema.max(
        opts.maxLength,
        `Must be at most ${opts.maxLength} characters`,
      );
    }
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Boolean Field
// ============================================================================

/**
 * Boolean field - renders as checkbox (default) or switch based on displayAs option.
 * Maps to server field type "boolean".
 */
export const booleanField = field("boolean", {
  component: BooleanField,
  cell: BooleanCell,
  config: {} as BooleanFieldConfig,
  createZod: (opts) => {
    const schema = z.boolean();
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Select Fields
// ============================================================================

export const selectField = field("select", {
  component: SelectField,
  cell: SelectCell,
  config: {} as SelectFieldConfig,
  createZod: (opts) => {
    // If we have options, create an enum schema
    if (opts.options && opts.options.length > 0) {
      const values = opts.options.map((o: any) => o.value);
      // Handle mixed string/number values
      const schema = z
        .union([z.string(), z.number()])
        .refine((val) => values.includes(val), {
          message: "Invalid selection",
        });
      return wrapOptional(schema, opts.required);
    }
    // Fallback to string/number union
    const schema = z.union([z.string(), z.number()]);
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Date/Time Fields
// ============================================================================

export const dateField = field("date", {
  component: DateField,
  cell: DateCell,
  config: {} as DateFieldConfig,
  createZod: (opts) => {
    // Accept both Date objects and ISO strings
    const schema = z
      .union([z.date(), z.string().datetime()])
      .transform((val) => (typeof val === "string" ? new Date(val) : val));
    return wrapOptional(schema, opts.required);
  },
});

export const datetimeField = field("datetime", {
  component: DatetimeField,
  cell: DateTimeCell,
  config: {} as DateTimeFieldConfig,
  createZod: (opts) => {
    const schema = z
      .union([z.date(), z.string().datetime()])
      .transform((val) => (typeof val === "string" ? new Date(val) : val));
    return wrapOptional(schema, opts.required);
  },
});

export const timeField = field("time", {
  component: TimeField,
  cell: TimeCell,
  config: {} as TimeFieldConfig,
  createZod: (opts) => {
    // Time is stored as string "HH:mm" or "HH:mm:ss"
    const schema = z
      .string()
      .regex(
        /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/,
        "Invalid time format",
      );
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Relation Fields
// ============================================================================

export const relationField = field("relation", {
  component: RelationField,
  cell: RelationCell,
  config: {} as RelationFieldConfig,
  createZod: (opts) => {
    // Single relation = string ID, multiple = array of string IDs
    if (opts.type === "multiple") {
      let schema = z.array(z.string());
      if (opts.maxItems) {
        schema = schema.max(
          opts.maxItems,
          `Maximum ${opts.maxItems} items allowed`,
        );
      }
      return wrapOptional(schema, opts.required);
    }
    // Single relation
    const schema = z.string();
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Complex Fields
// ============================================================================

export const jsonField = field("json", {
  component: JsonField,
  cell: JsonCell,
  config: {} as JsonFieldConfig,
  createZod: (opts) => {
    const schema = z.any();
    return wrapOptional(schema, opts.required);
  },
});

export const objectField = field("object", {
  component: ObjectField,
  cell: ObjectCell,
  config: {} as ObjectFieldConfig,
  createZod: (opts, ctx) => {
    // If no fields defined, accept any object
    if (!opts.fields) {
      const schema = z.record(z.string(), z.any());
      return wrapOptional(schema, opts.required);
    }

    // Build nested fields schema using the registry proxy
    const nestedFields = opts.fields({ r: createRegistryProxy(ctx.registry) });
    const schema = buildNestedSchema(nestedFields, ctx);

    return wrapOptional(schema, opts.required);
  },
});

export const arrayField = field("array", {
  component: ArrayField,
  cell: JsonCell,
  config: {} as ArrayFieldConfig,
  createZod: (opts, ctx) => {
    let itemSchema: z.ZodTypeAny;

    // Object array - has `item` callback for complex items
    if (opts.item) {
      const itemFields = opts.item({ r: createRegistryProxy(ctx.registry) });
      itemSchema = buildNestedSchema(itemFields, ctx);
    }
    // Primitive array - use itemType
    else {
      switch (opts.itemType) {
        case "text":
          itemSchema = z.string();
          break;
        case "number":
          itemSchema = z.number();
          break;
        case "email":
          itemSchema = z.string().email("Invalid email");
          break;
        case "textarea":
          itemSchema = z.string();
          break;
        case "select":
          if (opts.options && opts.options.length > 0) {
            const values = opts.options.map((o: any) => o.value);
            itemSchema = z
              .union([z.string(), z.number()])
              .refine((val) => values.includes(val), {
                message: "Invalid selection",
              });
          } else {
            itemSchema = z.union([z.string(), z.number()]);
          }
          break;
        default:
          itemSchema = z.any();
      }
    }

    let schema = z.array(itemSchema);

    // Apply min/max constraints
    if (opts.minItems !== undefined) {
      schema = schema.min(
        opts.minItems,
        `Minimum ${opts.minItems} items required`,
      );
    }
    if (opts.maxItems !== undefined) {
      schema = schema.max(
        opts.maxItems,
        `Maximum ${opts.maxItems} items allowed`,
      );
    }

    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Upload Fields
// ============================================================================

export const uploadField = field("upload", {
  component: UploadField,
  cell: UploadCell,
  config: {} as UploadFieldConfig,
  createZod: (opts) => {
    // Multiple upload stores array of asset IDs
    if (opts.multiple) {
      let schema = z.array(z.string());
      if (opts.maxItems) {
        schema = schema.max(
          opts.maxItems,
          `Maximum ${opts.maxItems} files allowed`,
        );
      }
      return wrapOptional(schema, opts.required);
    }
    // Single upload stores asset ID as string
    const schema = z.string();
    return wrapOptional(schema, opts.required);
  },
});

export const assetPreviewField = field("assetPreview", {
  component: AssetPreviewField,
  cell: ({ row }: { value: unknown; row?: any }) => {
    return <AssetThumbnail asset={row?.original} size="sm" />;
  },
  config: {} as AssetPreviewFieldProps,
  createZod: (_opts) => {
    // Asset preview is read-only display
    return z.any().optional();
  },
});

// ============================================================================
// Rich Text & Embedded
// ============================================================================

export const richTextField = field("richText", {
  component: RichTextField,
  cell: RichTextCell,
  config: {} as RichTextFieldConfig,
  createZod: (opts) => {
    // Always TipTap JSON format
    const schema: z.ZodTypeAny = z.any();
    return wrapOptional(schema, opts.required);
  },
});

// ============================================================================
// Block Fields
// ============================================================================

export const blocksField = field("blocks", {
  component: BlocksField,
  cell: BlocksCell,
  config: {} as BlocksFieldConfig,
  createZod: (opts) => {
    // Blocks content schema: { _tree: BlockNode[], _values: Record<string, Record<string, unknown>> }
    const blockNodeSchema: z.ZodType<any> = z.lazy(() =>
      z.object({
        id: z.string(),
        type: z.string(),
        children: z.array(blockNodeSchema),
      }),
    );

    let schema = z.object({
      _tree: z.array(blockNodeSchema),
      _values: z.record(z.string(), z.record(z.string(), z.any())),
    });

    // Apply min/max block constraints
    if (opts.minBlocks !== undefined || opts.maxBlocks !== undefined) {
      schema = schema.refine(
        (data) => {
          const count = countBlocks(data._tree);
          if (opts.minBlocks !== undefined && count < opts.minBlocks) {
            return false;
          }
          if (opts.maxBlocks !== undefined && count > opts.maxBlocks) {
            return false;
          }
          return true;
        },
        {
          message:
            opts.minBlocks !== undefined && opts.maxBlocks !== undefined
              ? `Must have between ${opts.minBlocks} and ${opts.maxBlocks} blocks`
              : opts.minBlocks !== undefined
                ? `Minimum ${opts.minBlocks} blocks required`
                : `Maximum ${opts.maxBlocks} blocks allowed`,
        },
      ) as any;
    }

    return wrapOptional(schema, opts.required);
  },
});

/**
 * Helper to count blocks in a tree
 */
function countBlocks(tree: Array<{ children: Array<any> }>): number {
  let count = 0;
  for (const node of tree) {
    count += 1;
    count += countBlocks(node.children);
  }
  return count;
}

// ============================================================================
// Export All Built-in Fields
// ============================================================================

/**
 * Built-in admin fields registry.
 *
 * Maps 1:1 with questpie server default fields, plus admin-specific fields:
 * - richText: TipTap-based WYSIWYG editor
 * - blocks: Visual block editor
 * - assetPreview: Read-only asset thumbnail
 *
 * @example
 * ```ts
 * const admin = defineAdmin()
 *   .fields(builtInFields)
 *   // ... rest of config
 * ```
 */
export const builtInFields = {
  // ─────────────────────────────────────────────────────────────────────────
  // 1:1 with questpie server fields (15 fields)
  // ─────────────────────────────────────────────────────────────────────────

  // Text-based
  text: textField,
  textarea: textareaField,
  email: emailField,
  url: textField, // Uses text component, server has separate url field for validation

  // Numeric
  number: numberField,

  // Boolean - uses displayAs option for checkbox/switch variant
  boolean: booleanField,

  // Selection
  select: selectField,

  // Date/Time
  date: dateField,
  datetime: datetimeField,
  time: timeField,

  // Relations
  relation: relationField,

  // Complex types
  object: objectField,
  array: arrayField,
  json: jsonField,

  // Upload - use `through` config for multiple uploads (manyToMany)
  upload: uploadField,

  // ─────────────────────────────────────────────────────────────────────────
  // Admin-specific fields (not in questpie server)
  // ─────────────────────────────────────────────────────────────────────────

  /** TipTap-based WYSIWYG rich text editor */
  richText: richTextField,

  /** Visual block editor for structured content */
  blocks: blocksField,

  /** Read-only asset thumbnail preview */
  assetPreview: assetPreviewField,
} as const;
