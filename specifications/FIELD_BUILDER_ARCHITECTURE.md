# Field Builder Architecture Specification

> **Status:** Draft
> **Author:** AI Assistant
> **Last Updated:** 2026-01-31

## Overview

Migrácia z raw Drizzle column definícií na vlastný **Field Builder** systém s:

- **Single source of truth** na BE
- **Auto-introspekcia** pre FE admin
- **Extensible field registry** pre custom fieldy
- **Query builder integrácia** s field-specific operátormi
- **Unified validation** (JSON Schema pre client, Zod pre server)

---

## Implementation Phases

| Phase | Feature                   | Priority | Dependencies | Package                              |
| ----- | ------------------------- | -------- | ------------ | ------------------------------------ |
| **1** | Core Field System         | P0       | -            | `questpie/server`                    |
| **2** | Built-in Fields           | P0       | Phase 1      | `questpie/server`                    |
| **3** | Relation Fields           | P0       | Phase 2      | `questpie/server`                    |
| **4** | Complex Fields            | P1       | Phase 2      | `questpie/server`                    |
| **5** | Operators & Query Builder | P1       | Phase 2      | `questpie/server`                    |
| **6** | Admin Introspection       | P1       | Phase 3      | `questpie/server`, `@questpie/admin` |
| **7** | Advanced Features         | P2       | Phase 4-6    | `questpie/server`, `@questpie/admin` |

---

# Phase 1: Core Field System

> **Package:** `questpie/server`
> **Priority:** P0
> **Dependencies:** None

## 1.1 Problem

Aktuálne kolekcie používajú raw Drizzle columns priamo:

```typescript
// Current - raw Drizzle
const posts = q.collection("posts")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    content: jsonb("content"),
    status: varchar("status", { length: 50 }).default("draft"),
  })
  .relations(({ one, manyToMany, table }) => ({
    author: one("users", { fields: [table.authorId], references: ["id"] }),
    tags: manyToMany("tags", { through: "postTags", ... }),
  }));
```

Problémy:

1. **Duplicated metadata** - labels, descriptions definované zvlášť v admin
2. **No type inference** - FE nevie o field typoch
3. **Separate relations** - `.relations()` oddelené od `.fields()`
4. **Fixed operators** - query builder nepozná field-specific operátory
5. **Manual validation** - Zod schémy generované z Drizzle, nie z business logic

## 1.2 Solution: Field Builder Pattern

Field builder je **sugar syntax** nad Drizzle - generuje columns, existujúci migration flow zostáva.

```typescript
// New - Field Builder
const posts = q.collection("posts").fields((f) => ({
  title: f.text({
    label: "Title",
    required: true,
    maxLength: 255,
  }),
  content: f.richText({
    label: "Content",
    localized: true,
  }),
  status: f.select({
    label: "Status",
    options: [
      { value: "draft", label: "Draft" },
      { value: "published", label: "Published" },
    ],
    default: "draft",
  }),
  // Inline relations
  author: f.relation("users", {
    type: "belongsTo",
    label: "Author",
    required: true,
  }),
  tags: f.relation("tags", {
    type: "manyToMany",
    through: "postTags",
    label: "Tags",
  }),
}));
```

## 1.3 Field Definition Interface

```typescript
// packages/questpie/src/server/fields/types.ts

/**
 * Core field definition interface.
 * Each field type implements this to provide:
 * - Column generation for Drizzle
 * - Validation schema (Zod v4 - JSON Schema derived via z.toJSONSchema())
 * - Query operators (context-aware for column vs JSONB)
 * - Admin metadata
 *
 * Type parameters:
 * - TType: Field type identifier ("text", "number", etc.)
 * - TConfig: Configuration object type
 * - TValue: Base runtime value type (string, number, etc.)
 * - TInput: Type for create/update input (may differ due to required/default)
 * - TOutput: Type for select output (may differ due to output: false)
 * - TColumn: Drizzle column type
 */
interface FieldDefinition<
  TType extends string = string,
  TConfig extends BaseFieldConfig = BaseFieldConfig,
  TValue = unknown,
  TInput = TValue,
  TOutput = TValue,
  TColumn = AnyPgColumn,
> {
  /** Field type identifier (e.g., "text", "number", "relation") */
  readonly type: TType;

  /** Field configuration */
  readonly config: TConfig;

  /** Phantom types for inference - used by collection $infer */
  readonly $types: {
    value: TValue;
    input: TInput;
    output: TOutput;
    column: TColumn;
  };

  /**
   * Generate Drizzle column(s) for this field.
   * May return single column, multiple (e.g., polymorphic), or null (e.g., hasMany).
   */
  toColumn(name: string): TColumn | TColumn[] | null;

  /**
   * Generate Zod schema for input validation.
   * JSON Schema is derived automatically via Zod v4's z.toJSONSchema().
   * Supports async refinements for server-side validation.
   *
   * NOTE: toJsonSchema() is NOT needed on fields!
   * Zod v4 provides z.toJSONSchema(schema) to convert any Zod schema.
   * This is used at collection level to generate client validation schemas.
   */
  toZodSchema(): ZodType<TInput>;

  /**
   * Get operators for query builder.
   * Returns context-aware operators for both column and JSONB access.
   * System automatically selects appropriate variant based on field context.
   *
   * @param config - Field configuration (for conditional operator logic)
   */
  getOperators(config: TConfig): ContextualOperators;

  /**
   * Get metadata for admin introspection.
   * Includes labels, descriptions, options, etc.
   * Returns the appropriate FieldMetadata subtype based on field type.
   *
   * @param config - Field configuration
   */
  getMetadata(config: TConfig): FieldMetadata;

  /**
   * Optional: Get nested fields (for object/array types).
   */
  getNestedFields?(): Record<string, FieldDefinition>;

  /**
   * Optional: Modify select query (for relations, computed fields).
   */
  getSelectModifier?(): SelectModifier;

  /**
   * Optional: Build joins for relation fields.
   */
  getJoinBuilder?(): JoinBuilder;

  /**
   * Optional: Transform value after reading from DB.
   */
  fromDb?(dbValue: unknown): TValue;

  /**
   * Optional: Transform value before writing to DB.
   */
  toDb?(value: TInput): unknown;
}

/**
 * Context-aware operators for both column and JSONB access.
 * System automatically selects appropriate variant based on field context.
 */
interface ContextualOperators {
  /** Operators for direct column access */
  column: OperatorMap;

  /** Operators for JSONB path access */
  jsonb: OperatorMap;
}

/**
 * Map of operator name to function.
 */
type OperatorMap = Record<string, OperatorFn | undefined>;

/**
 * Operator function type.
 */
type OperatorFn<TValue = unknown> = (
  column: AnyPgColumn,
  value: TValue,
  ctx: QueryContext,
) => SQL;
```

## 1.4 I18nText Type

````typescript
// packages/questpie/src/shared/i18n/types.ts

/**
 * Locale-to-string mapping for inline translations.
 * Keys are locale codes (e.g., "en", "sk", "de").
 */
type I18nLocaleMap = {
  [locale: string]: string;
};

/**
 * Internationalized text value.
 * Used for labels, descriptions, and other user-facing strings.
 *
 * Supports three formats:
 *
 * 1. **Simple string** (no translation, same for all locales):
 *    ```ts
 *    label: "Posts"
 *    ```
 *
 * 2. **Translation key** (resolved via i18n adapter):
 *    ```ts
 *    label: { key: "collections.posts.label" }
 *    label: { key: "collections.posts.label", fallback: "Posts" }
 *    label: { key: "greeting", params: { name: "John" } }
 *    ```
 *
 * 3. **Inline locale map** (recommended for collection/field labels):
 *    ```ts
 *    label: { en: "Posts", sk: "Príspevky", de: "Beiträge" }
 *    ```
 *
 * All formats are serializable for API transport and introspection.
 */
type I18nText =
  | string
  | { key: string; fallback?: string; params?: Record<string, unknown> }
  | I18nLocaleMap;

/**
 * Type guard to check if value is a translation key object.
 */
function isI18nKey(value: I18nText): value is {
  key: string;
  fallback?: string;
  params?: Record<string, unknown>;
} {
  return typeof value === "object" && value !== null && "key" in value;
}

/**
 * Type guard to check if value is a locale map.
 */
function isI18nLocaleMap(value: I18nText): value is I18nLocaleMap {
  return typeof value === "object" && value !== null && !("key" in value);
}

/**
 * Resolve I18nText to string for given locale.
 */
function resolveI18nText(
  value: I18nText,
  locale: string,
  t?: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (isI18nKey(value)) {
    // Translation key - use t() function or fallback
    if (t) {
      return t(value.key, value.params);
    }
    return value.fallback ?? value.key;
  }

  // Locale map - get value for locale or first available
  return value[locale] ?? value["en"] ?? Object.values(value)[0] ?? "";
}
````

## 1.5 Base Field Config

```typescript
/**
 * Common configuration options for all field types.
 *
 * NOTE: NO admin/UI config here! BE fields are purely data-focused.
 * Admin package handles all UI concerns via its own override system.
 */
interface BaseFieldConfig {
  /** Display label (i18n supported) - used for validation messages, API docs */
  label?: I18nText;

  /** Help text / description - used for API docs, validation messages */
  description?: I18nText;

  /** Field is required (not null in DB, required in input) */
  required?: boolean;

  /** Field can be null (default: !required) */
  nullable?: boolean;

  /** Default value or factory function */
  default?: unknown | (() => unknown);

  /**
   * Input behavior for create/update operations.
   *
   * - `true` (default): Included in input, follows `required` for validation
   * - `false`: Excluded from input entirely (TInput = never)
   * - `'optional'`: Included but always optional (TInput = T | undefined)
   *
   * Use `'optional'` for fields that are:
   * - Required at DB level (NOT NULL)
   * - But can be omitted in input (computed via hooks if not provided)
   *
   * Example: slug field - user can provide, but auto-generated if missing
   */
  input?: boolean | "optional";

  /**
   * Include field in select output.
   * Set to false for write-only fields (e.g., passwords, tokens).
   * @default true
   */
  output?: boolean;

  /** Field is localized (stored in i18n table) */
  localized?: boolean;

  /** Create unique constraint */
  unique?: boolean;

  /** Create index */
  index?: boolean;

  /** Include in search index */
  searchable?: boolean;

  /**
   * Field-level access control.
   * If access has functions (not just `true`), output type becomes optional.
   */
  access?: FieldAccess;

  /**
   * Virtual field - no DB column.
   * - `true`: Marker, use hooks.afterRead to compute value
   * - `SQL`: Computed column/subquery added to SELECT
   */
  virtual?: true | SQL<unknown>;

  /**
   * Field-level hooks (BE only).
   */
  hooks?: FieldHooks;
}

// NOTE: No AdminFieldConfig interface!
// Admin package defines its own override system.
// This keeps BE clean and focused on data concerns only.
```

## 1.4.1 Field-level Access Control

```typescript
/**
 * Field-level access control.
 * Evaluated at runtime to determine if user can access field.
 *
 * Type implications:
 * - If any access property is a function (not `true`), output becomes optional
 *   because the field might be filtered at runtime.
 * - `true` = always allowed, no type change
 * - `false` = never allowed (same as input: false / output: false)
 * - Function = runtime check, output becomes TOutput | undefined
 */
interface FieldAccess {
  /**
   * Can read this field?
   * If function returns false, field is omitted from response.
   * @default true
   */
  read?: boolean | ((ctx: AccessContext) => boolean | Promise<boolean>);

  /**
   * Can set this field on create?
   * If false, field is removed from input before save.
   * @default true
   */
  create?: boolean | ((ctx: AccessContext) => boolean | Promise<boolean>);

  /**
   * Can update this field?
   * If false, field changes are ignored on update.
   * @default true
   */
  update?: boolean | ((ctx: AccessContext) => boolean | Promise<boolean>);
}

interface AccessContext {
  /** Current request */
  req: Request;

  /** Authenticated user (if any) */
  user?: User;

  /** Current document (for update/read) */
  doc?: Record<string, unknown>;

  /** Operation type */
  operation: "create" | "read" | "update" | "delete";
}

/**
 * Type inference: If access has functions, output becomes optional.
 */
type InferAccessOutput<TConfig, TOutput> = TConfig extends {
  access: { read: (...args: any[]) => any };
}
  ? TOutput | undefined // Runtime check = might be filtered
  : TOutput; // No function = always present

/**
 * Examples:
 */
const posts = q.collection("posts").fields((f) => ({
  // Public field - everyone can read
  title: f.text({ required: true }),
  // → TOutput = string

  // Admin-only field - has access function
  internalNotes: f.text({
    access: {
      read: ({ user }) => user?.role === "admin",
      update: ({ user }) => user?.role === "admin",
    },
  }),
  // → TOutput = string | undefined (might be filtered)

  // Read-only for non-owners
  email: f.email({
    required: true,
    access: {
      read: ({ user, doc }) =>
        user?.id === doc?.authorId || user?.role === "admin",
      update: ({ user, doc }) => user?.id === doc?.authorId,
    },
  }),
  // → TOutput = string | undefined

  // Never writable via API (system-managed)
  createdAt: f.datetime({
    default: () => new Date(),
    access: {
      create: false,
      update: false,
    },
  }),
  // → TInput = never (can't set via API)
}));
```

## 1.4.2 Field-level Hooks

```typescript
/**
 * Field-level hooks.
 * Hooks transform or validate values but DON'T change the type.
 * Return type must match input type.
 */
interface FieldHooks<TValue = unknown> {
  /**
   * Transform value before save (create or update).
   * Called after validation, before DB write.
   * Must return same type as input.
   */
  beforeChange?: (
    value: TValue,
    ctx: FieldHookContext,
  ) => TValue | Promise<TValue>;

  /**
   * Transform value after read from DB.
   * Called before sending to client.
   * Must return same type as stored value.
   */
  afterRead?: (
    value: TValue,
    ctx: FieldHookContext,
  ) => TValue | Promise<TValue>;

  /**
   * Validate value before save.
   * Throw error to reject, return void to accept.
   * Called before beforeChange.
   */
  validate?: (value: TValue, ctx: FieldHookContext) => void | Promise<void>;

  /**
   * Called only on create, before beforeChange.
   */
  beforeCreate?: (
    value: TValue,
    ctx: FieldHookContext,
  ) => TValue | Promise<TValue>;

  /**
   * Called only on update, before beforeChange.
   */
  beforeUpdate?: (
    value: TValue,
    ctx: FieldHookContext,
  ) => TValue | Promise<TValue>;
}

interface FieldHookContext<TConfig = BaseFieldConfig> {
  /** Field name */
  field: string;

  /** Collection name */
  collection: string;

  /** Operation type */
  operation: "create" | "read" | "update";

  /** Current request */
  req: Request;

  /** Authenticated user */
  user?: User;

  /** Full document (other fields) */
  doc: Record<string, unknown>;

  /** Original value (for update) */
  originalValue?: unknown;

  /** Database client (for async validation) */
  db: DrizzleClient;

  /** Field configuration (for accessing field-specific options in hooks) */
  config: TConfig;
}

/**
 * Examples:
 */
const users = q.collection("users").fields((f) => ({
  email: f.email({
    required: true,
    hooks: {
      // Normalize email
      beforeChange: (value) => value.toLowerCase().trim(),

      // Async validation
      validate: async (value, { db, doc }) => {
        const existing = await db.query.users.findFirst({
          where: and(
            eq(users.email, value),
            doc.id ? ne(users.id, doc.id) : undefined,
          ),
        });
        if (existing) {
          throw new ValidationError("Email already taken");
        }
      },
    },
  }),

  password: f.text({
    required: true,
    output: false, // Never send to client
    hooks: {
      // Hash password before save
      beforeChange: async (value) => {
        return await bcrypt.hash(value, 10);
      },
    },
  }),

  slug: f.text({
    required: true,
    unique: true,
    hooks: {
      // Auto-generate slug on create only
      beforeCreate: (value, { doc }) => {
        if (!value && doc.title) {
          return slugify(doc.title as string);
        }
        return value;
      },
    },
  }),
}));
```

## 1.4.3 Virtual Fields

```typescript
/**
 * Virtual fields have no DB column.
 * They are computed on read via:
 * 1. hooks.afterRead - for simple computations from other fields
 * 2. SQL expression - for DB-level computed values (subqueries, aggregates)
 *
 * Virtual fields:
 * - toColumn() returns null
 * - TInput = never (unless has custom setter via hook)
 * - Can't be used in WHERE unless backed by SQL expression with index
 */

/**
 * Option 1: virtual: true + hooks
 * For computed values from other fields in the document.
 */
const users = q.collection("users").fields((f) => ({
  firstName: f.text({ required: true }),
  lastName: f.text({ required: true }),

  // Computed from other fields
  fullName: f.text({
    virtual: true,
    hooks: {
      afterRead: (_, { doc }) => `${doc.firstName} ${doc.lastName}`,
    },
  }),
  // → TValue = string
  // → TInput = never (can't set)
  // → TOutput = string
  // → TColumn = null (no DB column)
}));

/**
 * Option 2: virtual: sql`...`
 * For DB-computed values, subqueries, aggregates.
 * The SQL is added to SELECT clause.
 */
const posts = q.collection("posts").fields((f) => ({
  title: f.text({ required: true }),

  // Subquery - count of comments
  commentCount: f.number({
    virtual: sql<number>`(
      SELECT COUNT(*)::int
      FROM comments
      WHERE comments.post_id = posts.id
    )`,
  }),
  // → Added to SELECT as: (SELECT COUNT(*)...) AS "commentCount"
  // → TOutput = number
  // → TInput = never
  // → Can be used in ORDER BY

  // Computed column expression
  titleLength: f.number({
    virtual: sql<number>`LENGTH(posts.title)`,
  }),

  // Conditional computed
  status: f.text({
    virtual: sql<string>`
      CASE
        WHEN posts.published_at IS NOT NULL THEN 'published'
        WHEN posts.deleted_at IS NOT NULL THEN 'deleted'
        ELSE 'draft'
      END
    `,
  }),
}));

/**
 * Virtual field with setter (via hooks).
 * Allows setting computed field that updates underlying fields.
 */
const users = q.collection("users").fields((f) => ({
  firstName: f.text({ required: true }),
  lastName: f.text({ required: true }),

  fullName: f.text({
    virtual: true,
    input: true, // Allow in input (override default)
    hooks: {
      // Compute on read
      afterRead: (_, { doc }) => `${doc.firstName} ${doc.lastName}`,

      // Parse and update underlying fields on write
      beforeChange: (value, { doc }) => {
        if (value) {
          const [first, ...rest] = value.split(" ");
          doc.firstName = first;
          doc.lastName = rest.join(" ");
        }
        return value; // Return value (won't be saved, just for type)
      },
    },
  }),
  // → TInput = string | undefined (because input: true)
  // → TOutput = string
}));

/**
 * Type inference for virtual fields.
 *
 * These types are used by the collection's $infer type to properly handle
 * virtual fields in input/output types. They are integrated into the main
 * InferInputType and InferOutputType helpers (see "Type System & Inference" section).
 */
type InferVirtualInput<TConfig, TValue> = TConfig extends {
  virtual: true | SQL<any>;
}
  ? TConfig extends { input: true }
    ? TValue | undefined // Explicitly enabled input
    : never // Default: no input for virtual
  : TValue; // Non-virtual: normal input

type InferVirtualColumn<TConfig, TColumn> = TConfig extends {
  virtual: true | SQL<any>;
}
  ? null // No DB column
  : TColumn;

/**
 * Integration with main type inference:
 *
 * The InferInputType and InferOutputType helpers (defined in "Type System & Inference")
 * should check for virtual fields first:
 *
 * type InferInputType<TConfig, TValue> =
 *   TConfig extends { virtual: true | SQL<any> }
 *     ? InferVirtualInput<TConfig, TValue>
 *     : TConfig extends { input: false }
 *       ? never
 *       : ... // rest of input type logic
 */
```

## 1.4.4 Combined Example

```typescript
const posts = q.collection("posts").fields((f) => ({
  // Standard field
  title: f.text({
    required: true,
    label: "Title",
    hooks: {
      beforeChange: (v) => v.trim(),
    },
  }),

  // Field with access control
  internalScore: f.number({
    default: 0,
    access: {
      read: ({ user }) => user?.role === "admin",
      update: ({ user }) => user?.role === "admin",
    },
  }),
  // → TOutput = number | undefined (has access function)

  // Virtual computed field
  excerpt: f.text({
    virtual: true,
    hooks: {
      afterRead: (_, { doc }) => {
        const content = doc.content as string;
        return content?.substring(0, 200) + "...";
      },
    },
  }),
  // → TOutput = string, TInput = never

  // Virtual SQL aggregate
  commentCount: f.number({
    virtual: sql<number>`(
      SELECT COUNT(*)::int FROM comments
      WHERE comments.post_id = posts.id
    )`,
  }),
  // → TOutput = number, TInput = never

  // System field - not writable via API
  createdAt: f.datetime({
    required: true,
    default: () => new Date(),
    access: { create: false, update: false },
  }),
  // → TInput = never, TOutput = Date

  // Write-only field
  password: f.text({
    output: false,
    hooks: {
      beforeChange: async (v) => bcrypt.hash(v, 10),
    },
  }),
  // → TOutput = never, TInput = string | null | undefined
}));

// Inferred types:
type PostSelect = typeof posts.$infer.select;
// {
//   title: string;
//   internalScore: number | undefined;  // access.read is function
//   excerpt: string;
//   commentCount: number;
//   createdAt: Date;
//   // password excluded (output: false)
// }

type PostInsert = typeof posts.$infer.insert;
// {
//   title: string;
//   // internalScore?: number;  // optional, has default
//   // excerpt excluded (virtual)
//   // commentCount excluded (virtual)
//   // createdAt excluded (access.create: false)
//   password?: string;
// }
```

## 1.6 Field Metadata (for Introspection)

```typescript
/**
 * Metadata exposed for introspection.
 * Contains only data-relevant information - NO UI/admin config.
 * Admin package uses this to auto-generate UI, then applies its own overrides.
 *
 * Field-type specific properties are included via intersection with
 * type-specific metadata interfaces (see below).
 */
interface FieldMetadataBase {
  /** Field type identifier */
  type: string;

  /** Display label */
  label?: I18nText;

  /** Description / help text */
  description?: I18nText;

  /** Is field required */
  required: boolean;

  /** Is field localized */
  localized: boolean;

  /** Is field unique */
  unique: boolean;

  /** Is field searchable */
  searchable: boolean;

  /** Is field read-only (input: false) */
  readOnly?: boolean;

  /** Is field write-only (output: false) */
  writeOnly?: boolean;

  /** Validation constraints (derived from field config) */
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
  };

  // NOTE: No adminConfig here!
  // Admin package determines UI concerns itself based on field type.
}

/**
 * Type-specific metadata extensions.
 * Each field type adds its own properties.
 */

/** Select field metadata */
interface SelectFieldMetadata extends FieldMetadataBase {
  type: "select";
  options: Array<{ value: string | number; label: I18nText }>;
  multiple?: boolean;
}

/** Relation field metadata */
interface RelationFieldMetadata extends FieldMetadataBase {
  type: "relation";
  relationTarget: string;
  relationType: "belongsTo" | "hasMany" | "manyToMany";
}

/** Polymorphic relation field metadata */
interface PolymorphicRelationFieldMetadata extends FieldMetadataBase {
  type: "polymorphicRelation";
  relationType: "polymorphic";
  types: string[];
  typeField?: string;
  idField?: string;
}

/** Object/Array field metadata */
interface NestedFieldMetadata extends FieldMetadataBase {
  type: "object" | "array" | "blocks";
  nestedFields?: Record<string, FieldMetadata>;
}

/** Geometry field metadata (custom field example) */
interface GeometryFieldMetadata extends FieldMetadataBase {
  type: "geometry";
  geometryType?: "point" | "polygon" | "linestring" | "geometry";
  srid?: number;
}

/**
 * Union type of all field metadata types.
 * Extensible via module augmentation for custom fields.
 */
type FieldMetadata =
  | FieldMetadataBase
  | SelectFieldMetadata
  | RelationFieldMetadata
  | PolymorphicRelationFieldMetadata
  | NestedFieldMetadata
  | GeometryFieldMetadata;
```

## 1.7 Field Registry

```typescript
// packages/questpie/src/server/fields/registry.ts

/**
 * Registry for field types.
 * Allows registration of built-in and custom fields.
 */
interface FieldRegistry {
  /** Registered field factories */
  fields: Map<string, FieldFactory>;

  /**
   * Register a field type.
   */
  register<TType extends string, TConfig, TValue>(
    type: TType,
    factory: FieldFactory<TType, TConfig, TValue>,
  ): this;

  /**
   * Get field factory by type.
   */
  get<TType extends string>(type: TType): FieldFactory | undefined;

  /**
   * Check if field type is registered.
   */
  has(type: string): boolean;

  /**
   * Get all registered field types.
   */
  types(): string[];
}

/**
 * Factory function that creates a field definition from config.
 *
 * Type parameters match FieldDefinition for consistency:
 * - TType: Field type identifier
 * - TConfig: Configuration object type (extends BaseFieldConfig)
 * - TValue: Base runtime value type
 * - TInput: Input type (inferred from config via InferInputType)
 * - TOutput: Output type (inferred from config via InferOutputType)
 * - TColumn: Drizzle column type (inferred from toColumn return)
 *
 * See "Type System & Inference" section for detailed type derivation.
 */
type FieldFactory<
  TType extends string = string,
  TConfig extends BaseFieldConfig = BaseFieldConfig,
  TValue = unknown,
  TInput = TValue,
  TOutput = TValue,
  TColumn = AnyPgColumn,
> = <TUserConfig extends TConfig>(
  config?: TUserConfig,
) => FieldDefinition<
  TType,
  TUserConfig,
  TValue,
  InferInputType<TUserConfig, TValue>,
  InferOutputType<TUserConfig, TValue>,
  InferColumnType<TUserConfig, TColumn>
>;
```

## 1.8 Field Builder Proxy

```typescript
// packages/questpie/src/server/fields/builder.ts

/**
 * Type map for registered fields.
 * Used to provide type-safe autocomplete for f.text(), f.number(), etc.
 */
type FieldTypeMap = {
  [K: string]: FieldFactory;
};

/**
 * Creates a type-safe field builder proxy from a registry.
 * Provides autocomplete for f.text(), f.number(), etc.
 *
 * For built-in fields, use DefaultFieldBuilderProxy for full type safety.
 */
type FieldBuilderProxy<TMap extends FieldTypeMap = DefaultFieldTypeMap> = {
  [K in keyof TMap]: TMap[K] extends FieldFactory<
    infer TType,
    infer TConfig,
    infer TValue,
    infer TInput,
    infer TColumn
  >
    ? <TUserConfig extends TConfig & BaseFieldConfig>(
        config?: TUserConfig,
      ) => FieldDefinition<
        TType,
        TUserConfig,
        TValue,
        InferInputType<TUserConfig, TValue>,
        InferOutputType<TUserConfig, TValue>,
        InferColumnType<TUserConfig, TColumn>
      >
    : never;
};

/**
 * Default field type map for built-in fields.
 * Provides full type inference for standard fields.
 */
interface DefaultFieldTypeMap {
  text: typeof textFieldFactory;
  textarea: typeof textareaFieldFactory;
  number: typeof numberFieldFactory;
  boolean: typeof booleanFieldFactory;
  date: typeof dateFieldFactory;
  datetime: typeof datetimeFieldFactory;
  time: typeof timeFieldFactory;
  select: typeof selectFieldFactory;
  email: typeof emailFieldFactory;
  url: typeof urlFieldFactory;
  json: typeof jsonFieldFactory;
  object: typeof objectFieldFactory;
  array: typeof arrayFieldFactory;
  upload: typeof uploadFieldFactory;
  richText: typeof richTextFieldFactory;
  relation: typeof relationFieldFactory;
  polymorphicRelation: typeof polymorphicRelationFieldFactory;
}

/**
 * Create field builder proxy from registry.
 * Runtime implementation that wraps registry Map in proxy object.
 */
function createFieldBuilder(
  registry: FieldRegistry,
): FieldBuilderProxy<DefaultFieldTypeMap> {
  const proxy = {} as FieldBuilderProxy<DefaultFieldTypeMap>;

  for (const [type, factory] of registry.fields) {
    (proxy as any)[type] = (config: any = {}) => factory(config);
  }

  return proxy;
}
```

## 1.9 Collection Builder Integration

```typescript
// packages/questpie/src/server/collection/builder/collection-builder.ts

class CollectionBuilder<TState extends CollectionBuilderState> {
  /**
   * Define fields using field builder.
   * Replaces raw Drizzle column definitions.
   */
  fields<TFields extends Record<string, FieldDefinition>>(
    factory: (f: FieldBuilderProxy<DefaultRegistry>) => TFields,
  ): CollectionBuilder<SetProperty<TState, "fields", TFields>> {
    const fieldBuilder = createFieldBuilder(this.registry);
    const fields = factory(fieldBuilder);

    // Extract Drizzle columns from field definitions
    const columns: Record<string, PgColumn> = {};
    const fieldDefs: Record<string, FieldDefinition> = {};

    for (const [name, fieldDef] of Object.entries(fields)) {
      fieldDefs[name] = fieldDef;

      const column = fieldDef.toColumn(name);
      if (column) {
        if (Array.isArray(column)) {
          // Multiple columns (e.g., relation with FK)
          for (const col of column) {
            columns[col.name] = col;
          }
        } else {
          columns[name] = column;
        }
      }
    }

    return this.clone({
      ...this.state,
      fields: fieldDefs,
      columns, // Drizzle columns for table generation
    });
  }
}
```

## 1.10 File Structure

```
packages/questpie/src/server/fields/
├── index.ts              # Public exports
├── types.ts              # Core interfaces
├── registry.ts           # Field registry implementation
├── builder.ts            # Field builder proxy
├── operators/
│   ├── index.ts          # Operator exports
│   ├── types.ts          # Operator interfaces
│   ├── string.ts         # String operators (eq, like, etc.)
│   ├── number.ts         # Number operators (gt, lt, etc.)
│   ├── date.ts           # Date operators
│   ├── json.ts           # JSON/JSONB operators
│   └── relation.ts       # Relation operators (has, hasNot)
├── builtin/
│   ├── index.ts          # Built-in fields export
│   ├── text.ts           # Text field
│   ├── number.ts         # Number field
│   ├── boolean.ts        # Boolean field
│   ├── date.ts           # Date field
│   ├── datetime.ts       # Datetime field
│   ├── time.ts           # Time field
│   ├── select.ts         # Select field
│   ├── email.ts          # Email field
│   ├── url.ts            # URL field
│   ├── json.ts           # JSON field
│   ├── object.ts         # Object field (nested)
│   ├── array.ts          # Array field
│   ├── upload.ts         # Upload/file field
│   └── relation.ts       # Relation field
└── utils/
    ├── zod.ts            # Zod schema helpers
    ├── json-schema.ts    # JSON Schema helpers
    └── column.ts         # Drizzle column helpers
```

---

# Phase 2: Built-in Fields

> **Package:** `questpie/server`
> **Priority:** P0
> **Dependencies:** Phase 1

> **Note on `toJsonSchema()` in examples:** Some examples below show `toJsonSchema()` for
> illustration of expected output. In actual implementation, JSON Schema is derived from
> Zod schema using `z.toJSONSchema()` - fields only implement `toZodSchema()`.
> See "Validation & JSON Schema (Zod v4)" section for details.

## 2.1 Text Field

```typescript
// packages/questpie/src/server/fields/builtin/text.ts

interface TextFieldConfig extends BaseFieldConfig {
  /** Storage mode: varchar (default) or text */
  mode?: "varchar" | "text";

  /** Max length for varchar mode */
  maxLength?: number;

  /** Min length validation */
  minLength?: number;

  /** Regex pattern validation */
  pattern?: RegExp | string;

  /** Transform: trim whitespace */
  trim?: boolean;

  /** Transform: lowercase */
  lowercase?: boolean;

  /** Transform: uppercase */
  uppercase?: boolean;
}

const textField = field<"text", TextFieldConfig, string>("text", {
  toColumn(name, config) {
    const {
      mode = "varchar",
      maxLength = 255,
      required,
      nullable,
      default: defaultValue,
    } = config;

    let column =
      mode === "text" ? text(name) : varchar(name, { length: maxLength });

    if (required) column = column.notNull();
    if (defaultValue !== undefined) column = column.default(defaultValue);

    return column;
  },

  toZodSchema(config) {
    let schema = z.string();

    if (config.maxLength) schema = schema.max(config.maxLength);
    if (config.minLength) schema = schema.min(config.minLength);
    if (config.pattern) {
      const regex =
        typeof config.pattern === "string"
          ? new RegExp(config.pattern)
          : config.pattern;
      schema = schema.regex(regex);
    }
    if (config.trim) schema = schema.trim();
    if (config.lowercase) schema = schema.toLowerCase();
    if (config.uppercase) schema = schema.toUpperCase();

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: toJsonSchema() is NOT implemented on fields!
  // JSON Schema is derived from Zod schema at collection level:
  //
  // import { z } from "zod";
  // const jsonSchema = z.toJSONSchema(field.toZodSchema());
  //
  // For text field, this produces:
  // { type: "string", maxLength: 255, minLength: 1, pattern: "..." }

  getOperators(config): ContextualOperators {
    return {
      column: {
        eq: (col, value) => eq(col, value),
        ne: (col, value) => ne(col, value),
        like: (col, value) => like(col, value),
        ilike: (col, value) => ilike(col, value),
        startsWith: (col, value) => like(col, `${value}%`),
        endsWith: (col, value) => like(col, `%${value}`),
        contains: (col, value) => ilike(col, `%${value}%`),
        in: (col, values) => inArray(col, values),
        notIn: (col, values) => notInArray(col, values),
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        eq: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
        },
        ne: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
        },
        like: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value}`;
        },
        ilike: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${value}`;
        },
        contains: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + value + "%"}`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "text",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? false,
      validation: {
        maxLength: config.maxLength,
        minLength: config.minLength,
        pattern: config.pattern?.toString(),
      },
    };
  },
});
```

## 2.2 Number Field

```typescript
// packages/questpie/src/server/fields/builtin/number.ts

interface NumberFieldConfig extends BaseFieldConfig {
  /** Storage mode */
  mode?: "integer" | "smallint" | "bigint" | "real" | "double" | "decimal";

  /** Precision for decimal mode */
  precision?: number;

  /** Scale for decimal mode */
  scale?: number;

  /** Minimum value */
  min?: number;

  /** Maximum value */
  max?: number;

  /** Must be positive */
  positive?: boolean;

  /** Must be negative */
  negative?: boolean;

  /** Must be integer (for non-integer modes) */
  int?: boolean;

  /** Step value (for validation) */
  step?: number;
}

const numberField = field<"number", NumberFieldConfig, number>("number", {
  toColumn(name, config) {
    const {
      mode = "integer",
      precision,
      scale,
      required,
      default: defaultValue,
    } = config;

    let column: PgColumn;
    switch (mode) {
      case "smallint":
        column = smallint(name);
        break;
      case "bigint":
        column = bigint(name, { mode: "number" });
        break;
      case "real":
        column = real(name);
        break;
      case "double":
        column = doublePrecision(name);
        break;
      case "decimal":
        column = numeric(name, {
          precision: precision ?? 10,
          scale: scale ?? 2,
        });
        break;
      default:
        column = integer(name);
    }

    if (required) column = column.notNull();
    if (defaultValue !== undefined) column = column.default(defaultValue);

    return column;
  },

  toZodSchema(config) {
    // Note: For bigint mode, we'd use z.bigint() - simplified here
    let schema = z.number();

    if (config.mode === "integer" || config.int) {
      schema = schema.int();
    }
    if (config.min !== undefined) schema = schema.min(config.min);
    if (config.max !== undefined) schema = schema.max(config.max);
    if (config.positive) schema = schema.positive();
    if (config.negative) schema = schema.negative();
    if (config.step) schema = schema.multipleOf(config.step);

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

  getOperators(config): ContextualOperators {
    return {
      column: {
        eq: (col, value) => eq(col, value),
        ne: (col, value) => ne(col, value),
        gt: (col, value) => gt(col, value),
        gte: (col, value) => gte(col, value),
        lt: (col, value) => lt(col, value),
        lte: (col, value) => lte(col, value),
        between: (col, [min, max]) => between(col, min, max),
        in: (col, values) => inArray(col, values),
        notIn: (col, values) => notInArray(col, values),
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        eq: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric = ${value}`;
        },
        ne: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric != ${value}`;
        },
        gt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric > ${value}`;
        },
        gte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric >= ${value}`;
        },
        lt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric < ${value}`;
        },
        lte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric <= ${value}`;
        },
        between: (col, [min, max], ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::numeric BETWEEN ${min} AND ${max}`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "number",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? false,
      validation: {
        min: config.min,
        max: config.max,
      },
    };
  },
});
```

## 2.3 Boolean Field

```typescript
// packages/questpie/src/server/fields/builtin/boolean.ts

interface BooleanFieldConfig extends BaseFieldConfig {
  /** Default to true */
  defaultTrue?: boolean;
}

const booleanField = field<"boolean", BooleanFieldConfig, boolean>(
  "boolean",
  {
    toColumn(name, config) {
      let column = boolean(name);

      if (config.required) column = column.notNull();
      if (config.default !== undefined) {
        column = column.default(config.default);
      } else if (config.defaultTrue) {
        column = column.default(true);
      }

      return column;
    },

    toZodSchema(config) {
      let schema = z.boolean();

      if (!config.required && config.nullable !== false) {
        schema = schema.nullish();
      }

      return schema;
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

    getOperators(config): ContextualOperators {
      return {
        column: {
          eq: (col, value) => eq(col, value),
          ne: (col, value) => ne(col, value),
          isNull: (col) => isNull(col),
          isNotNull: (col) => isNotNull(col),
        },
        jsonb: {
          eq: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::boolean = ${value}`;
          },
          ne: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::boolean != ${value}`;
          },
          isNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
          },
          isNotNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
          },
        },
      };
    },

    getMetadata(config): FieldMetadata {
      return {
        type: "boolean",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: config.localized ?? false,
        unique: false,
        searchable: false,
      };
    },
  },
);
```

## 2.4 Date/Time Fields

```typescript
// packages/questpie/src/server/fields/builtin/date.ts

interface DateFieldConfig extends BaseFieldConfig {
  /** Minimum date */
  min?: Date | string;

  /** Maximum date */
  max?: Date | string;

  /** Auto-set to now on create */
  autoNow?: boolean;

  /** Auto-update to now on change */
  autoNowUpdate?: boolean;
}

const dateField = field<"date", DateFieldConfig, Date>("date", {
  toColumn(name, config) {
    let column = date(name, { mode: "date" });

    if (config.required) column = column.notNull();
    if (config.default !== undefined) column = column.default(config.default);
    if (config.autoNow) column = column.defaultNow();

    return column;
  },

  toZodSchema(config) {
    let schema = z.coerce.date();

    if (config.min) schema = schema.min(new Date(config.min));
    if (config.max) schema = schema.max(new Date(config.max));

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

  getOperators(config): ContextualOperators {
    return {
      column: {
        eq: (col, value) => eq(col, new Date(value)),
        ne: (col, value) => ne(col, new Date(value)),
        gt: (col, value) => gt(col, new Date(value)),
        gte: (col, value) => gte(col, new Date(value)),
        lt: (col, value) => lt(col, new Date(value)),
        lte: (col, value) => lte(col, new Date(value)),
        between: (col, [min, max]) =>
          between(col, new Date(min), new Date(max)),
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        eq: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::date = ${new Date(value)}`;
        },
        gt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::date > ${new Date(value)}`;
        },
        gte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::date >= ${new Date(value)}`;
        },
        lt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::date < ${new Date(value)}`;
        },
        lte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::date <= ${new Date(value)}`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "date",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? false,
      validation: {
        min: config.min ? Number(new Date(config.min)) : undefined,
        max: config.max ? Number(new Date(config.max)) : undefined,
      },
    };
  },
});
```

## 2.4.1 Datetime Field

```typescript
// packages/questpie/src/server/fields/builtin/datetime.ts

interface DatetimeFieldConfig extends BaseFieldConfig {
  /** Minimum datetime */
  min?: Date | string;

  /** Maximum datetime */
  max?: Date | string;

  /** Auto-set to now on create */
  autoNow?: boolean;

  /** Auto-update to now on change */
  autoNowUpdate?: boolean;

  /** Storage precision (0-6, default: 3 for milliseconds) */
  precision?: number;

  /** Store with timezone (default: true) */
  withTimezone?: boolean;
}

const datetimeField = field<"datetime", DatetimeFieldConfig, Date>(
  "datetime",
  {
    toColumn(name, config) {
      const { withTimezone = true, precision = 3 } = config;

      let column = withTimezone
        ? timestamp(name, { mode: "date", withTimezone: true, precision })
        : timestamp(name, { mode: "date", withTimezone: false, precision });

      if (config.required) column = column.notNull();
      if (config.default !== undefined) column = column.default(config.default);
      if (config.autoNow) column = column.defaultNow();

      return column;
    },

    toZodSchema(config) {
      let schema = z.coerce.date();

      if (config.min) schema = schema.min(new Date(config.min));
      if (config.max) schema = schema.max(new Date(config.max));

      if (!config.required && config.nullable !== false) {
        schema = schema.nullish();
      }

      return schema;
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
    // Produces: { type: "string", format: "date-time" }

    getOperators(config): ContextualOperators {
      return {
        column: {
          eq: (col, value) => eq(col, new Date(value)),
          ne: (col, value) => ne(col, new Date(value)),
          gt: (col, value) => gt(col, new Date(value)),
          gte: (col, value) => gte(col, new Date(value)),
          lt: (col, value) => lt(col, new Date(value)),
          lte: (col, value) => lte(col, new Date(value)),
          between: (col, [min, max]) =>
            between(col, new Date(min), new Date(max)),
          in: (col, values) =>
            inArray(
              col,
              values.map((v) => new Date(v)),
            ),
          notIn: (col, values) =>
            notInArray(
              col,
              values.map((v) => new Date(v)),
            ),
          // Date range helpers
          today: (col) => {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            return and(gte(col, start), lt(col, end));
          },
          thisWeek: (col) => {
            const now = new Date();
            const start = new Date(now);
            start.setDate(now.getDate() - now.getDay());
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            return and(gte(col, start), lt(col, end));
          },
          thisMonth: (col) => {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            return and(gte(col, start), lt(col, end));
          },
          isNull: (col) => isNull(col),
          isNotNull: (col) => isNotNull(col),
        },
        jsonb: {
          eq: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz = ${new Date(value)}`;
          },
          ne: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz != ${new Date(value)}`;
          },
          gt: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz > ${new Date(value)}`;
          },
          gte: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz >= ${new Date(value)}`;
          },
          lt: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz < ${new Date(value)}`;
          },
          lte: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz <= ${new Date(value)}`;
          },
          between: (col, [min, max], ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`(${col}#>>'{${sql.raw(path)}}')::timestamptz BETWEEN ${new Date(min)} AND ${new Date(max)}`;
          },
          isNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
          },
          isNotNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
          },
        },
      };
    },

    getMetadata(config): FieldMetadata {
      return {
        type: "datetime",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: config.localized ?? false,
        unique: config.unique ?? false,
        searchable: config.searchable ?? false,
        validation: {
          min: config.min ? Number(new Date(config.min)) : undefined,
          max: config.max ? Number(new Date(config.max)) : undefined,
        },
      };
    },

    // Handle autoNowUpdate in hooks
    hooks: {
      beforeChange: (value, { operation, config }) => {
        if (config.autoNowUpdate && operation === "update") {
          return new Date();
        }
        return value;
      },
    },
  },
);
```

## 2.4.2 Time Field

```typescript
// packages/questpie/src/server/fields/builtin/time.ts

interface TimeFieldConfig extends BaseFieldConfig {
  /** Minimum time (HH:mm or HH:mm:ss format) */
  min?: string;

  /** Maximum time (HH:mm or HH:mm:ss format) */
  max?: string;

  /** Include seconds (default: false, uses HH:mm) */
  withSeconds?: boolean;

  /** Storage precision for seconds (0-6) */
  precision?: number;
}

const timeField = field<"time", TimeFieldConfig, string>("time", {
  toColumn(name, config) {
    const { precision = 0 } = config;

    let column = time(name, { precision, withTimezone: false });

    if (config.required) column = column.notNull();
    if (config.default !== undefined) column = column.default(config.default);

    return column;
  },

  toZodSchema(config) {
    // Time format: HH:mm or HH:mm:ss
    const pattern = config.withSeconds
      ? /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/
      : /^([01]\d|2[0-3]):([0-5]\d)$/;

    let schema = z.string().regex(pattern, "Invalid time format");

    if (config.min) {
      schema = schema.refine(
        (val) => val >= config.min!,
        `Time must be ${config.min} or later`,
      );
    }
    if (config.max) {
      schema = schema.refine(
        (val) => val <= config.max!,
        `Time must be ${config.max} or earlier`,
      );
    }

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
  // Produces: { type: "string", pattern: "..." }

  getOperators(config): ContextualOperators {
    return {
      column: {
        eq: (col, value) => eq(col, value),
        ne: (col, value) => ne(col, value),
        gt: (col, value) => gt(col, value),
        gte: (col, value) => gte(col, value),
        lt: (col, value) => lt(col, value),
        lte: (col, value) => lte(col, value),
        between: (col, [min, max]) => between(col, min, max),
        in: (col, values) => inArray(col, values),
        notIn: (col, values) => notInArray(col, values),
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        eq: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time = ${value}::time`;
        },
        ne: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time != ${value}::time`;
        },
        gt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time > ${value}::time`;
        },
        gte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time >= ${value}::time`;
        },
        lt: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time < ${value}::time`;
        },
        lte: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time <= ${value}::time`;
        },
        between: (col, [min, max], ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`(${col}#>>'{${sql.raw(path)}}')::time BETWEEN ${min}::time AND ${max}::time`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "time",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? false,
      validation: {
        pattern: config.withSeconds
          ? "^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$"
          : "^([01]\\d|2[0-3]):([0-5]\\d)$",
      },
    };
  },
});
```

## 2.5 Select Field

```typescript
// packages/questpie/src/server/fields/builtin/select.ts

interface SelectOption {
  value: string | number;
  label: I18nText;
  disabled?: boolean;
}

interface SelectFieldConfig extends BaseFieldConfig {
  /** Available options */
  options: SelectOption[];

  /** Allow multiple selection */
  multiple?: boolean;

  /** Use PostgreSQL enum type */
  enumType?: boolean;

  /** Enum type name (for enumType: true) */
  enumName?: string;
}

const selectField = field<"select", SelectFieldConfig, string | string[]>(
  "select",
  {
    toColumn(name, config) {
      const {
        options,
        multiple,
        enumType,
        enumName,
        required,
        default: defaultValue,
      } = config;

      let column: PgColumn;

      if (enumType && !multiple) {
        // Use PostgreSQL ENUM
        const values = options.map((o) => String(o.value)) as [
          string,
          ...string[],
        ];
        const pgEnum = pgEnumFactory(enumName ?? `${name}_enum`, values);
        column = pgEnum(name);
      } else if (multiple) {
        // Array of values
        column = varchar(name, { length: 255 }).array();
      } else {
        // Regular varchar
        column = varchar(name, { length: 255 });
      }

      if (required) column = column.notNull();
      if (defaultValue !== undefined) column = column.default(defaultValue);

      return column;
    },

    toZodSchema(config) {
      const values = config.options.map((o) => o.value);

      let schema: ZodSchema;
      if (typeof values[0] === "number") {
        schema = z.number().refine((v) => values.includes(v));
      } else {
        schema = z.enum(values as [string, ...string[]]);
      }

      if (config.multiple) {
        schema = z.array(schema);
      }

      if (!config.required && config.nullable !== false) {
        schema = schema.nullish();
      }

      return schema;
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

    getOperators(config): ContextualOperators {
      if (config.multiple) {
        return {
          column: {
            contains: (col, value) => sql`${value} = ANY(${col})`,
            containsAll: (col, values) => sql`${col} @> ${values}`,
            containsAny: (col, values) => sql`${col} && ${values}`,
            isEmpty: (col) => sql`cardinality(${col}) = 0`,
            isNotEmpty: (col) => sql`cardinality(${col}) > 0`,
            length: (col, len) => sql`cardinality(${col}) = ${len}`,
            isNull: (col) => isNull(col),
            isNotNull: (col) => isNotNull(col),
          },
          jsonb: {
            contains: (col, value, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`${col}#>'{${sql.raw(path)}}' ? ${value}`;
            },
            containsAll: (col, values, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`${col}#>'{${sql.raw(path)}}' ?& array[${sql.join(
                values.map((v: string) => sql`${v}`),
                sql`, `,
              )}]`;
            },
            isEmpty: (col, _, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`jsonb_array_length(${col}#>'{${sql.raw(path)}}') = 0`;
            },
            isNotEmpty: (col, _, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`jsonb_array_length(${col}#>'{${sql.raw(path)}}') > 0`;
            },
            isNull: (col, _, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
            },
            isNotNull: (col, _, ctx) => {
              const path = ctx.jsonbPath!.join(",");
              return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
            },
          },
        };
      }

      return {
        column: {
          eq: (col, value) => eq(col, value),
          ne: (col, value) => ne(col, value),
          in: (col, values) => inArray(col, values),
          notIn: (col, values) => notInArray(col, values),
          isNull: (col) => isNull(col),
          isNotNull: (col) => isNotNull(col),
        },
        jsonb: {
          eq: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
          },
          ne: (col, value, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
          },
          in: (col, values, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>>'{${sql.raw(path)}}' IN (${sql.join(
              values.map((v: string) => sql`${v}`),
              sql`, `,
            )})`;
          },
          isNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
          },
          isNotNull: (col, _, ctx) => {
            const path = ctx.jsonbPath!.join(",");
            return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
          },
        },
      };
    },

    getMetadata(config): SelectFieldMetadata {
      return {
        type: "select",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: config.localized ?? false,
        unique: config.unique ?? false,
        searchable: config.searchable ?? false,
        options: config.options,
        multiple: config.multiple,
      };
    },
  },
);
```

## 2.6 Email Field

```typescript
// packages/questpie/src/server/fields/builtin/email.ts

interface EmailFieldConfig extends BaseFieldConfig {
  /** Validate email format strictly */
  strict?: boolean;
}

const emailField = field<"email", EmailFieldConfig, string>("email", {
  toColumn(name, config) {
    let column = varchar(name, { length: 255 });

    if (config.required) column = column.notNull();
    if (config.default !== undefined) column = column.default(config.default);

    return column;
  },

  toZodSchema(config) {
    let schema = z.string().email();

    if (config.strict) {
      schema = schema.regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
    }

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
  // Produces: { type: "string", format: "email" }

  getOperators(): ContextualOperators {
    // Inherits all text operators + adds domain-specific ones
    const textOps = textField.getOperators();

    return {
      column: {
        ...textOps.column,
        // Email-specific: filter by domain
        domain: (col, domain) => ilike(col, `%@${domain}`),
        domainIn: (col, domains: string[]) =>
          or(...domains.map((d) => ilike(col, `%@${d}`))),
      },
      jsonb: {
        ...textOps.jsonb,
        domain: (col, domain, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + domain}`;
        },
        domainIn: (col, domains: string[], ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return or(
            ...domains.map(
              (d) => sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + d}`,
            ),
          );
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "email",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? true,
    };
  },
});
```

## 2.7 URL Field

```typescript
// packages/questpie/src/server/fields/builtin/url.ts

interface UrlFieldConfig extends BaseFieldConfig {
  /** Validate URL format strictly (full URL with protocol) */
  strict?: boolean;

  /** Allowed protocols (default: ['http', 'https']) */
  protocols?: string[];

  /** Max URL length (default: 2048) */
  maxLength?: number;
}

const urlField = field<"url", UrlFieldConfig, string>("url", {
  toColumn(name, config) {
    const maxLength = config.maxLength ?? 2048;
    let column = varchar(name, { length: maxLength });

    if (config.required) column = column.notNull();
    if (config.default !== undefined) column = column.default(config.default);

    return column;
  },

  toZodSchema(config) {
    let schema = z.string().url();

    if (config.protocols && config.protocols.length > 0) {
      const protocolRegex = new RegExp(
        `^(${config.protocols.join("|")}):\/\/`,
        "i",
      );
      schema = schema.refine(
        (val) => protocolRegex.test(val),
        `URL must start with: ${config.protocols.join(", ")}`,
      );
    }

    if (config.maxLength) {
      schema = schema.max(config.maxLength);
    }

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
  // Produces: { type: "string", format: "uri" }

  getOperators(): ContextualOperators {
    // Inherits all text operators + adds URL-specific ones
    const textOps = textField.getOperators();

    return {
      column: {
        ...textOps.column,
        // URL-specific: filter by domain/host
        host: (col, host) => ilike(col, `%://${host}%`),
        hostIn: (col, hosts: string[]) =>
          or(...hosts.map((h) => ilike(col, `%://${h}%`))),
        protocol: (col, protocol) => like(col, `${protocol}://%`),
        protocolIn: (col, protocols: string[]) =>
          or(...protocols.map((p) => like(col, `${p}://%`))),
      },
      jsonb: {
        ...textOps.jsonb,
        host: (col, host, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + host + "%"}`;
        },
        hostIn: (col, hosts: string[], ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return or(
            ...hosts.map(
              (h) =>
                sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + h + "%"}`,
            ),
          );
        },
        protocol: (col, protocol, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${protocol + "://%"}`;
        },
        protocolIn: (col, protocols: string[], ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return or(
            ...protocols.map(
              (p) => sql`${col}#>>'{${sql.raw(path)}}' LIKE ${p + "://%"}`,
            ),
          );
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "url",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: config.unique ?? false,
      searchable: config.searchable ?? false,
      validation: {
        maxLength: config.maxLength,
      },
    };
  },
});
```

## 2.8 Textarea Field

```typescript
// packages/questpie/src/server/fields/builtin/textarea.ts

interface TextareaFieldConfig extends BaseFieldConfig {
  /** Max length validation */
  maxLength?: number;

  /** Min length validation */
  minLength?: number;

  /** Number of visible rows (hint for admin UI) */
  rows?: number;

  /** Transform: trim whitespace */
  trim?: boolean;
}

const textareaField = field<"textarea", TextareaFieldConfig, string>(
  "textarea",
  {
    toColumn(name, config) {
      // Always use text column for unlimited length
      let column = text(name);

      if (config.required) column = column.notNull();
      if (config.default !== undefined) column = column.default(config.default);

      return column;
    },

    toZodSchema(config) {
      let schema = z.string();

      if (config.maxLength) schema = schema.max(config.maxLength);
      if (config.minLength) schema = schema.min(config.minLength);
      if (config.trim) schema = schema.trim();

      if (!config.required && config.nullable !== false) {
        schema = schema.nullish();
      }

      return schema;
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

    getOperators(): ContextualOperators {
      // Same operators as text field
      return textField.getOperators();
    },

    getMetadata(config): FieldMetadata {
      return {
        type: "textarea",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: config.localized ?? false,
        unique: config.unique ?? false,
        searchable: config.searchable ?? true,
        validation: {
          maxLength: config.maxLength,
          minLength: config.minLength,
        },
      };
    },
  },
);
```

## 2.9 Upload Field

```typescript
// packages/questpie/src/server/fields/builtin/upload.ts

interface UploadFieldConfig extends BaseFieldConfig {
  /** Allowed MIME types (e.g., ["image/*", "application/pdf"]) */
  mimeTypes?: string[];

  /** Max file size in bytes */
  maxSize?: number;

  /** Upload target collection (default: 'assets') */
  to?: string;

  /** Junction collection for many-to-many uploads */
  through?: string;
  sourceField?: string;
  targetField?: string;
}

const uploadField = field<
  "upload",
  UploadFieldConfig,
  string | string[] // ID or array of IDs
>("upload", {
  toColumn(name, config) {
    // Many-to-many uploads use a junction table, no local column
    if (config.through) return null;

    // Single ID stored as varchar
    let column = varchar(name, { length: 36 }); // UUID
    if (config.required) column = column.notNull();
    return column;
  },

  toZodSchema(config) {
    const idSchema = z.string().uuid();

    const schema = config.through ? z.array(idSchema) : idSchema;

    if (!config.required && config.nullable !== false) {
      return schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

  getOperators(config): ContextualOperators {
    if (config.through) {
      return {
        column: {
          some: () => sql`TRUE`,
          none: () => sql`TRUE`,
          every: () => sql`TRUE`,
          count: () => sql`0`,
        },
        jsonb: {
          some: () => sql`TRUE`,
          none: () => sql`TRUE`,
          every: () => sql`TRUE`,
          count: () => sql`0`,
        },
      };
    }

    // Single upload - same as relation belongsTo
    return {
      column: {
        eq: (col, value) => eq(col, value),
        ne: (col, value) => ne(col, value),
        in: (col, values) => inArray(col, values),
        notIn: (col, values) => notInArray(col, values),
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        eq: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
        },
        ne: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' != ${value}`;
        },
        in: (col, values, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>>'{${sql.raw(path)}}' IN (${sql.join(
            values.map((v) => sql`${v}`),
            sql`, `,
          )})`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config): FieldMetadata {
    return {
      type: "upload",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: false,
      searchable: false,
      validation: {
        // Admin uses these for file picker validation
      },
    };
  },
});
```

## 2.10 Built-in Fields Module

```typescript
// packages/questpie/src/server/fields/builtin/index.ts

export const builtinFields = {
  // Basic
  text: textField,
  textarea: textareaField,
  number: numberField,
  boolean: booleanField,

  // Date/Time
  date: dateField,
  datetime: datetimeField,
  time: timeField,

  // Selection
  select: selectField,

  // Formatted
  email: emailField,
  url: urlField,

  // Complex
  json: jsonField,
  object: objectField,
  array: arrayField,

  // Media
  upload: uploadField,

  // Relations (Phase 3)
  relation: relationField,
  polymorphicRelation: polymorphicRelationField,
} as const;

/**
 * Extended fields provided by @questpie/admin module.
 * These require additional BE + FE integration:
 *
 * - richText: Rich text editor with Tiptap/ProseMirror
 * - blocks: Block-based content editor
 *
 * Usage:
 *   import { adminModule } from "@questpie/admin";
 *   const cms = q().use(builtinFields).use(adminModule.server);
 *
 * See Phase 7.1 for module architecture details.
 */

export type BuiltinFields = typeof builtinFields;
```

---

# Phase 3: Relation Fields

> **Package:** `questpie/server`
> **Priority:** P0
> **Dependencies:** Phase 2

## 3.1 Relation Field Config

```typescript
// packages/questpie/src/server/fields/builtin/relation.ts

interface RelationFieldConfig extends BaseFieldConfig {
  /** Relation type */
  type: "belongsTo" | "hasMany" | "manyToMany";

  /**
   * Foreign key column name.
   * - belongsTo: column on THIS table (default: `${fieldName}Id`)
   * - hasMany: column on RELATED table pointing to this collection
   * Auto-generated if not specified.
   */
  foreignKey?: string;

  /**
   * Junction table name (for manyToMany).
   * Can be string (explicit name) or true (auto-generate).
   */
  through?: string | true;

  /**
   * Source FK field in junction table (for manyToMany).
   * Default: `${sourceCollection}Id`
   */
  sourceField?: string;

  /**
   * Target FK field in junction table (for manyToMany).
   * Default: `${targetCollection}Id`
   */
  targetField?: string;

  /**
   * ON DELETE behavior for FK constraint.
   */
  onDelete?: "cascade" | "set null" | "restrict" | "no action";

  /**
   * ON UPDATE behavior for FK constraint.
   */
  onUpdate?: "cascade" | "set null" | "restrict" | "no action";

  /**
   * Default filter for related records.
   */
  where?: Record<string, unknown>;

  /**
   * Order for related records.
   */
  orderBy?: Record<string, "asc" | "desc">;

  /**
   * Limit for hasMany/manyToMany.
   */
  limit?: number;

  // NOTE: No admin config! Admin handles UI concerns via its override system.
}

function createRelationField(
  target: string,
  config: RelationFieldConfig,
): FieldDefinition {
  return {
    type: "relation",
    config: { ...config, target },

    toColumn(name) {
      if (config.type === "belongsTo") {
        // Create FK column on this table
        const fkName = config.foreignKey ?? `${name}Id`;
        let column = varchar(fkName, { length: 36 }); // UUID

        if (config.required) column = column.notNull();

        // Note: actual FK constraint is added via table builder
        return column;
      }

      // hasMany and manyToMany don't create columns on this table
      return null;
    },

    toZodSchema() {
      if (config.type === "belongsTo") {
        // Accept ID or nested create/connect object
        const schema = z.union([
          z.string().uuid(), // Direct ID
          z.object({
            connect: z.object({ id: z.string().uuid() }),
          }),
          z.object({
            create: z.record(z.unknown()),
          }),
          z.object({
            connectOrCreate: z.object({
              where: z.record(z.unknown()),
              create: z.record(z.unknown()),
            }),
          }),
        ]);

        return config.required ? schema : schema.nullish();
      }

      if (config.type === "hasMany" || config.type === "manyToMany") {
        // Accept array of operations
        return z
          .object({
            connect: z.array(z.object({ id: z.string().uuid() })).optional(),
            disconnect: z.array(z.object({ id: z.string().uuid() })).optional(),
            create: z.array(z.record(z.unknown())).optional(),
            set: z.array(z.object({ id: z.string().uuid() })).optional(),
          })
          .optional();
      }

      return z.unknown();
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

    getOperators(): ContextualOperators {
      const belongsToOps = {
        eq: (col: AnyPgColumn, value: string) => eq(col, value),
        ne: (col: AnyPgColumn, value: string) => ne(col, value),
        in: (col: AnyPgColumn, values: string[]) => inArray(col, values),
        notIn: (col: AnyPgColumn, values: string[]) => notInArray(col, values),
        isNull: (col: AnyPgColumn) => isNull(col),
        isNotNull: (col: AnyPgColumn) => isNotNull(col),
        // Relation filter: check if related record matches condition
        is: (
          col: AnyPgColumn,
          where: Record<string, unknown>,
          ctx: QueryContext,
        ) => {
          return sql`EXISTS (
            SELECT 1 FROM ${sql.identifier(target)}
            WHERE ${sql.identifier(target)}.id = ${col}
            AND ${buildWhere(where, { ...ctx, tableName: target })}
          )`;
        },
        isNot: (
          col: AnyPgColumn,
          where: Record<string, unknown>,
          ctx: QueryContext,
        ) => {
          return sql`NOT EXISTS (
            SELECT 1 FROM ${sql.identifier(target)}
            WHERE ${sql.identifier(target)}.id = ${col}
            AND ${buildWhere(where, { ...ctx, tableName: target })}
          )`;
        },
      };

      const toManyOps = {
        some: (
          _: unknown,
          where: Record<string, unknown>,
          ctx: QueryContext,
        ) => {
          const fk = config.foreignKey ?? `${ctx.tableName}Id`;
          return sql`EXISTS (
            SELECT 1 FROM ${sql.identifier(target)}
            WHERE ${sql.identifier(target)}.${sql.identifier(fk)} = ${ctx.table}.id
            AND ${buildWhere(where, { ...ctx, tableName: target })}
          )`;
        },
        none: (
          _: unknown,
          where: Record<string, unknown>,
          ctx: QueryContext,
        ) => {
          const fk = config.foreignKey ?? `${ctx.tableName}Id`;
          return sql`NOT EXISTS (
            SELECT 1 FROM ${sql.identifier(target)}
            WHERE ${sql.identifier(target)}.${sql.identifier(fk)} = ${ctx.table}.id
            AND ${buildWhere(where, { ...ctx, tableName: target })}
          )`;
        },
        every: (
          _: unknown,
          where: Record<string, unknown>,
          ctx: QueryContext,
        ) => {
          const fk = config.foreignKey ?? `${ctx.tableName}Id`;
          return sql`NOT EXISTS (
            SELECT 1 FROM ${sql.identifier(target)}
            WHERE ${sql.identifier(target)}.${sql.identifier(fk)} = ${ctx.table}.id
            AND NOT (${buildWhere(where, { ...ctx, tableName: target })})
          )`;
        },
      };

      if (config.type === "belongsTo") {
        return { column: belongsToOps, jsonb: {} };
      }

      return { column: toManyOps, jsonb: {} };
    },

    getMetadata(): RelationFieldMetadata {
      return {
        type: "relation",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: false,
        unique: false,
        searchable: false,
        relationTarget: target,
        relationType: config.type,
      };
    },

    getJoinBuilder() {
      return {
        buildJoin(alias: string, ctx: QueryContext) {
          const fk = config.foreignKey;

          switch (config.type) {
            case "belongsTo":
              return sql`
                LEFT JOIN ${sql.identifier(target)} ${sql.identifier(alias)}
                ON ${sql.identifier(alias)}.id = ${ctx.table}.${sql.identifier(fk ?? `${alias}Id`)}
              `;

            case "hasMany":
              return sql`
                LEFT JOIN ${sql.identifier(target)} ${sql.identifier(alias)}
                ON ${sql.identifier(alias)}.${sql.identifier(fk ?? `${ctx.tableName}Id`)} = ${ctx.table}.id
              `;

            case "manyToMany":
              const through =
                typeof config.through === "string"
                  ? config.through
                  : [ctx.tableName, target].sort().join("_");
              const sourceField = config.sourceField ?? `${ctx.tableName}Id`;
              const targetField = config.targetField ?? `${target}Id`;

              return sql`
                LEFT JOIN ${sql.identifier(through)} ${sql.identifier(`${alias}_junction`)}
                ON ${sql.identifier(`${alias}_junction`)}.${sql.identifier(sourceField)} = ${ctx.table}.id
                LEFT JOIN ${sql.identifier(target)} ${sql.identifier(alias)}
                ON ${sql.identifier(alias)}.id = ${sql.identifier(`${alias}_junction`)}.${sql.identifier(targetField)}
              `;
          }
        },

        buildSelect(alias: string, fields: string[]) {
          return fields.map(
            (f) => sql`${sql.identifier(alias)}.${sql.identifier(f)}`,
          );
        },
      };
    },
  };
}

// Factory function
const relationField = (target: string, config: RelationFieldConfig) =>
  createRelationField(target, config);
```

## 3.2 Polymorphic Relations

```typescript
// packages/questpie/src/server/fields/builtin/polymorphic-relation.ts

interface PolymorphicRelationConfig extends BaseFieldConfig {
  /** Allowed target collections */
  types: string[];

  /** Column name for type discriminator */
  typeField?: string;

  /** Column name for ID */
  idField?: string;

  /** ON DELETE behavior */
  onDelete?: "cascade" | "set null" | "restrict";
}

const polymorphicRelationField = field<
  "polymorphicRelation",
  PolymorphicRelationConfig,
  { type: string; id: string }
>("polymorphicRelation", {
  toColumn(name, config) {
    const typeField = config.typeField ?? `${name}Type`;
    const idField = config.idField ?? `${name}Id`;

    const typeCol = varchar(typeField, { length: 100 });
    const idCol = varchar(idField, { length: 36 });

    if (config.required) {
      return [typeCol.notNull(), idCol.notNull()];
    }

    return [typeCol, idCol];
  },

  toZodSchema(config) {
    const schema = z.object({
      type: z.enum(config.types as [string, ...string[]]),
      id: z.string().uuid(),
    });

    return config.required ? schema : schema.nullish();
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

  getOperators(config): ContextualOperators {
    // Polymorphic relations are always column-based (can't be inside JSONB)
    return {
      column: {
        // Filter by type
        typeIs: (_, type, ctx) => {
          const typeCol = ctx.table[config.typeField ?? `${ctx.fieldName}Type`];
          return eq(typeCol, type);
        },
        typeIn: (_, types: string[], ctx) => {
          const typeCol = ctx.table[config.typeField ?? `${ctx.fieldName}Type`];
          return inArray(typeCol, types);
        },
        typeNotIn: (_, types: string[], ctx) => {
          const typeCol = ctx.table[config.typeField ?? `${ctx.fieldName}Type`];
          return notInArray(typeCol, types);
        },

        // Check related record (type-specific)
        is: (
          _,
          { type, where }: { type: string; where?: Record<string, unknown> },
          ctx,
        ) => {
          const typeCol = ctx.table[config.typeField ?? `${ctx.fieldName}Type`];
          const idCol = ctx.table[config.idField ?? `${ctx.fieldName}Id`];

          if (!where || Object.keys(where).length === 0) {
            return eq(typeCol, type);
          }

          return sql`
            ${typeCol} = ${type}
            AND EXISTS (
              SELECT 1 FROM ${sql.identifier(type)} AS related
              WHERE related.id = ${idCol}
              AND ${buildWhere(where, { ...ctx, table: sql`related` })}
            )
          `;
        },

        isNot: (
          _,
          { type, where }: { type: string; where?: Record<string, unknown> },
          ctx,
        ) => {
          const typeCol = ctx.table[config.typeField ?? `${ctx.fieldName}Type`];
          const idCol = ctx.table[config.idField ?? `${ctx.fieldName}Id`];

          if (!where || Object.keys(where).length === 0) {
            return ne(typeCol, type);
          }

          return sql`
            NOT (
              ${typeCol} = ${type}
              AND EXISTS (
                SELECT 1 FROM ${sql.identifier(type)} AS related
                WHERE related.id = ${idCol}
                AND ${buildWhere(where, { ...ctx, table: sql`related` })}
              )
            )
          `;
        },

        // Null checks (check ID column)
        isNull: (_, __, ctx) => {
          const idCol = ctx.table[config.idField ?? `${ctx.fieldName}Id`];
          return isNull(idCol);
        },
        isNotNull: (_, __, ctx) => {
          const idCol = ctx.table[config.idField ?? `${ctx.fieldName}Id`];
          return isNotNull(idCol);
        },
      },
      // Polymorphic relations can't be inside JSONB
      jsonb: {},
    };
  },

  getMetadata(config) {
    return {
      type: "polymorphicRelation",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: false,
      unique: false,
      searchable: false,
      relationType: "polymorphic",
      // Polymorphic config is part of field type, not admin
      types: config.types,
      typeField: config.typeField,
      idField: config.idField,
    };
  },
});
```

## 3.3 Usage Example

```typescript
const posts = q.collection("posts").fields((f) => ({
  title: f.text({ label: "Title", required: true }),

  // BelongsTo - creates authorId column on posts table
  author: f.relation("users", {
    type: "belongsTo",
    label: "Author",
    required: true,
    onDelete: "cascade",
    // foreignKey defaults to "authorId"
  }),

  // HasMany - no column on posts table, FK is on comments table
  comments: f.relation("comments", {
    type: "hasMany",
    foreignKey: "postId", // Column on comments table pointing to this post
    label: "Comments",
    orderBy: { createdAt: "desc" },
  }),

  // ManyToMany - uses junction table
  tags: f.relation("tags", {
    type: "manyToMany",
    through: "postTags", // Or use `true` for auto-generated "posts_tags"
    sourceField: "postId",
    targetField: "tagId",
    label: "Tags",
  }),

  // Polymorphic - creates commentableType + commentableId columns
  commentable: f.polymorphicRelation({
    types: ["posts", "pages", "products"],
    label: "Commentable",
  }),
}));

// Query with relation operators
const postsWithTaggedAuthor = await posts.find({
  where: {
    // belongsTo relation - use `is` to filter by related record properties
    author: {
      is: { role: "admin" },
    },
    // manyToMany relation - use `some` to check if any related record matches
    tags: {
      some: { name: "featured" },
    },
  },
  with: {
    author: true,
    tags: { limit: 5 },
    comments: {
      limit: 10,
      with: { author: true },
    },
  },
});
```

---

# Phase 4: Complex Fields

> **Package:** `questpie/server`
> **Priority:** P1
> **Dependencies:** Phase 2

## 4.1 Object Field (Nested Structure)

```typescript
// packages/questpie/src/server/fields/builtin/object.ts

interface ObjectFieldConfig extends BaseFieldConfig {
  /** Nested field definitions */
  fields: (f: FieldBuilderProxy) => Record<string, FieldDefinition>;

  /** Storage mode */
  mode?: "jsonb" | "json";
}

const objectField = field<
  "object",
  ObjectFieldConfig,
  Record<string, unknown>
>("object", {
  toColumn(name, config) {
    const { mode = "jsonb", required } = config;

    let column = mode === "jsonb" ? jsonb(name) : json(name);

    if (required) column = column.notNull();
    if (config.default !== undefined) {
      column = column.default(config.default);
    }

    return column;
  },

  toZodSchema(config) {
    const fieldBuilder = createFieldBuilder(defaultRegistry);
    const nestedFields = config.fields(fieldBuilder);

    const shape: Record<string, ZodSchema> = {};
    for (const [name, field] of Object.entries(nestedFields)) {
      shape[name] = field.toZodSchema();
    }

    let schema = z.object(shape);

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
  // Zod schema is already an object with nested schemas

  getOperators(): ContextualOperators {
    return {
      column: {
        // JSONB containment operators (column is JSONB)
        contains: (col, value) =>
          sql`${col} @> ${JSON.stringify(value)}::jsonb`,
        containedBy: (col, value) =>
          sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
        hasKey: (col, key) => sql`${col} ? ${key}`,
        hasKeys: (col, keys) =>
          sql`${col} ?& array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`,
        hasAnyKey: (col, keys) =>
          sql`${col} ?| array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`,

        // Path queries
        pathEquals: (
          col,
          { path, value }: { path: string[]; value: unknown },
        ) => sql`${col} #>> '{${sql.raw(path.join(","))}}' = ${String(value)}`,
        pathExists: (col, path: string[]) =>
          sql`${col} #> '{${sql.raw(path.join(","))}}' IS NOT NULL`,

        // JSONPath (PostgreSQL 12+)
        jsonPath: (col, pathExpr: string) => sql`${col} @? ${pathExpr}`,
        jsonPathMatch: (col, pathExpr: string) => sql`${col} @@ ${pathExpr}`,

        // Empty checks
        isEmpty: (col) => sql`${col} = '{}'::jsonb`,
        isNotEmpty: (col) => sql`${col} != '{}'::jsonb`,

        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        // Object nested inside another JSONB - prepend parent path
        contains: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify(value)}::jsonb`;
        },
        containedBy: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' <@ ${JSON.stringify(value)}::jsonb`;
        },
        hasKey: (col, key, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ? ${key}`;
        },
        hasKeys: (col, keys, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ?& array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`;
        },
        hasAnyKey: (col, keys, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ?| array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`;
        },
        pathExists: (col, subPath: string[], ctx) => {
          const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
          return sql`${col} #> '{${sql.raw(fullPath)}}' IS NOT NULL`;
        },
        pathEquals: (
          col,
          { path: subPath, value }: { path: string[]; value: unknown },
          ctx,
        ) => {
          const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
          return sql`${col} #>> '{${sql.raw(fullPath)}}' = ${String(value)}`;
        },
        isEmpty: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' = '{}'::jsonb`;
        },
        isNotEmpty: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' != '{}'::jsonb`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getNestedFields(config) {
    const fieldBuilder = createFieldBuilder(defaultRegistry);
    return config.fields(fieldBuilder);
  },

  getMetadata(config) {
    const fieldBuilder = createFieldBuilder(defaultRegistry);
    const nestedFields = config.fields(fieldBuilder);

    const nestedMetadata: Record<string, FieldMetadata> = {};
    for (const [name, field] of Object.entries(nestedFields)) {
      nestedMetadata[name] = field.getMetadata();
    }

    return {
      type: "object",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: false,
      searchable: false,
      nestedFields: nestedMetadata,
    };
  },
});
```

## 4.2 Array Field

```typescript
// packages/questpie/src/server/fields/builtin/array.ts

interface ArrayFieldConfig extends BaseFieldConfig {
  /** Item field definition */
  of: FieldDefinition | ((f: FieldBuilderProxy) => FieldDefinition);

  /** Minimum items */
  minItems?: number;

  /** Maximum items */
  maxItems?: number;

  /** Storage mode */
  mode?: "jsonb" | "array"; // PostgreSQL array or JSONB
}

const arrayField = field<"array", ArrayFieldConfig, unknown[]>("array", {
  toColumn(name, config) {
    const { mode = "jsonb", required } = config;

    let column: PgColumn;

    if (mode === "array") {
      // PostgreSQL native array
      const itemField =
        typeof config.of === "function"
          ? config.of(createFieldBuilder(defaultRegistry))
          : config.of;

      const itemColumn = itemField.toColumn("item");
      if (itemColumn && "array" in itemColumn) {
        column = itemColumn.array();
      } else {
        // Fallback to JSONB for complex items
        column = jsonb(name);
      }
    } else {
      column = jsonb(name);
    }

    if (required) column = column.notNull();
    if (config.default !== undefined) {
      column = column.default(config.default);
    }

    return column;
  },

  toZodSchema(config) {
    const itemField =
      typeof config.of === "function"
        ? config.of(createFieldBuilder(defaultRegistry))
        : config.of;

    let schema = z.array(itemField.toZodSchema());

    if (config.minItems !== undefined) schema = schema.min(config.minItems);
    if (config.maxItems !== undefined) schema = schema.max(config.maxItems);

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

  getOperators(config): ContextualOperators {
    const isNativeArray = config.mode === "array";

    if (isNativeArray) {
      // PostgreSQL native array operators
      return {
        column: {
          contains: (col, value) => sql`${value} = ANY(${col})`,
          containsAll: (col, values) => sql`${col} @> ${values}`,
          containsAny: (col, values) => sql`${col} && ${values}`,
          length: (col, len) => sql`cardinality(${col}) = ${len}`,
          lengthGt: (col, len) => sql`cardinality(${col}) > ${len}`,
          lengthGte: (col, len) => sql`cardinality(${col}) >= ${len}`,
          lengthLt: (col, len) => sql`cardinality(${col}) < ${len}`,
          lengthLte: (col, len) => sql`cardinality(${col}) <= ${len}`,
          isEmpty: (col) => sql`cardinality(${col}) = 0`,
          isNotEmpty: (col) => sql`cardinality(${col}) > 0`,
          isNull: (col) => isNull(col),
          isNotNull: (col) => isNotNull(col),
        },
        // Native arrays can't be nested in JSONB, so no jsonb operators
        jsonb: {},
      };
    }

    // JSONB array operators
    return {
      column: {
        contains: (col, value) =>
          sql`${col} @> ${JSON.stringify([value])}::jsonb`,
        containsAll: (col, values) =>
          sql`${col} @> ${JSON.stringify(values)}::jsonb`,
        containsAny: (col, values) =>
          sql`${col} ?| array[${sql.join(
            values.map((v: unknown) => sql`${JSON.stringify(v)}`),
            sql`, `,
          )}]`,
        containedBy: (col, values) =>
          sql`${col} <@ ${JSON.stringify(values)}::jsonb`,
        length: (col, len) => sql`jsonb_array_length(${col}) = ${len}`,
        lengthGt: (col, len) => sql`jsonb_array_length(${col}) > ${len}`,
        lengthGte: (col, len) => sql`jsonb_array_length(${col}) >= ${len}`,
        lengthLt: (col, len) => sql`jsonb_array_length(${col}) < ${len}`,
        lengthLte: (col, len) => sql`jsonb_array_length(${col}) <= ${len}`,
        isEmpty: (col) => sql`jsonb_array_length(${col}) = 0`,
        isNotEmpty: (col) => sql`jsonb_array_length(${col}) > 0`,
        // Element queries (for array of objects)
        some: (col, where, ctx) =>
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col}) AS elem
            WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
          )`,
        every: (col, where, ctx) =>
          sql`NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col}) AS elem
            WHERE NOT (${buildJsonbElementWhere(where, sql`elem`, ctx)})
          )`,
        none: (col, where, ctx) =>
          sql`NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col}) AS elem
            WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
          )`,
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        // Array nested inside JSONB - prepend parent path
        contains: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
        },
        containsAll: (col, values, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
        },
        containsAny: (col, values, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ?| array[${sql.join(
            values.map((v: unknown) => sql`${JSON.stringify(v)}`),
            sql`, `,
          )}]`;
        },
        length: (col, len, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') = ${len}`;
        },
        lengthGt: (col, len, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') > ${len}`;
        },
        lengthGte: (col, len, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') >= ${len}`;
        },
        lengthLt: (col, len, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') < ${len}`;
        },
        lengthLte: (col, len, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') <= ${len}`;
        },
        isEmpty: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') = 0`;
        },
        isNotEmpty: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') > 0`;
        },
        some: (col, where, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
            WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
          )`;
        },
        every: (col, where, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
            WHERE NOT (${buildJsonbElementWhere(where, sql`elem`, ctx)})
          )`;
        },
        none: (col, where, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
            WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
          )`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config) {
    const itemField =
      typeof config.of === "function"
        ? config.of(createFieldBuilder(defaultRegistry))
        : config.of;

    return {
      type: "array",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: false,
      searchable: false,
      nestedFields: { item: itemField.getMetadata() },
      validation: {
        minItems: config.minItems,
        maxItems: config.maxItems,
      },
    };
  },
});
```

## 4.3 Working Hours Helper

```typescript
// packages/questpie/src/server/fields/helpers/working-hours.ts

/**
 * Helper for common working hours pattern.
 * Reduces boilerplate for 7-day schedules.
 */
interface WorkingHoursConfig extends BaseFieldConfig {
  /** Days to include */
  days?: (
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday"
  )[];
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function workingHoursField(config: WorkingHoursConfig = {}): FieldDefinition {
  const days = config.days ?? [...DAYS];

  return objectField({
    ...config,
    fields: (f) => {
      const result: Record<string, FieldDefinition> = {};

      for (const day of days) {
        result[day] = f.object({
          label: { en: day.charAt(0).toUpperCase() + day.slice(1) },
          fields: (f) => ({
            open: f.time({ label: "Open" }),
            close: f.time({ label: "Close" }),
            closed: f.boolean({ label: "Closed", default: false }),
          }),
        });
      }

      return result;
    },
  });
}

// Usage
const barbers = q.collection("barbers").fields((f) => ({
  name: f.text({ label: "Name" }),
  workingHours: workingHoursField({ label: "Working Hours" }),
}));
```

## 4.4 JSON Field (Schema-less)

```typescript
// packages/questpie/src/server/fields/builtin/json.ts

interface JsonFieldConfig extends BaseFieldConfig {
  /** Storage mode */
  mode?: "jsonb" | "json";

  /** Optional JSON Schema for validation */
  schema?: JSONSchema7;
}

const jsonField = field<"json", JsonFieldConfig, unknown>("json", {
  toColumn(name, config) {
    const { mode = "jsonb", required } = config;

    let column = mode === "jsonb" ? jsonb(name) : json(name);

    if (required) column = column.notNull();
    if (config.default !== undefined) {
      column = column.default(config.default);
    }

    return column;
  },

  toZodSchema(config) {
    // If schema provided, convert to Zod
    if (config.schema) {
      return jsonSchemaToZod(config.schema);
    }

    let schema = z.unknown();

    if (!config.required && config.nullable !== false) {
      schema = schema.nullish();
    }

    return schema;
  },

  // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()
  // If config.schema is provided, it's converted to Zod first

  getOperators(): ContextualOperators {
    // JSON field has same operators as object field - it's schema-less JSONB
    return {
      column: {
        // JSONB containment
        contains: (col, value) =>
          sql`${col} @> ${JSON.stringify(value)}::jsonb`,
        containedBy: (col, value) =>
          sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
        hasKey: (col, key) => sql`${col} ? ${key}`,
        hasKeys: (col, keys) =>
          sql`${col} ?& array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`,
        hasAnyKey: (col, keys) =>
          sql`${col} ?| array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`,

        // Path queries
        pathEquals: (
          col,
          { path, value }: { path: string[]; value: unknown },
        ) => sql`${col} #>> '{${sql.raw(path.join(","))}}' = ${String(value)}`,
        pathExists: (col, path: string[]) =>
          sql`${col} #> '{${sql.raw(path.join(","))}}' IS NOT NULL`,
        pathContains: (
          col,
          { path, value }: { path: string[]; value: unknown },
        ) =>
          sql`${col} #> '{${sql.raw(path.join(","))}}' @> ${JSON.stringify(value)}::jsonb`,

        // JSONPath (PostgreSQL 12+)
        jsonPath: (col, pathExpr: string) => sql`${col} @? ${pathExpr}`,
        jsonPathMatch: (col, pathExpr: string) => sql`${col} @@ ${pathExpr}`,

        // Type checks (for schema-less JSON)
        typeOf: (col, { path, type }: { path?: string[]; type: string }) => {
          if (path && path.length > 0) {
            return sql`jsonb_typeof(${col} #> '{${sql.raw(path.join(","))}}') = ${type}`;
          }
          return sql`jsonb_typeof(${col}) = ${type}`;
        },

        isEmpty: (col) => sql`${col} = '{}'::jsonb OR ${col} = '[]'::jsonb`,
        isNotEmpty: (col) =>
          sql`${col} != '{}'::jsonb AND ${col} != '[]'::jsonb`,

        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },
      jsonb: {
        // JSON nested inside JSONB - prepend parent path
        contains: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify(value)}::jsonb`;
        },
        containedBy: (col, value, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' <@ ${JSON.stringify(value)}::jsonb`;
        },
        hasKey: (col, key, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ? ${key}`;
        },
        hasKeys: (col, keys, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' ?& array[${sql.join(
            keys.map((k: string) => sql`${k}`),
            sql`, `,
          )}]`;
        },
        pathExists: (col, subPath: string[], ctx) => {
          const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
          return sql`${col} #> '{${sql.raw(fullPath)}}' IS NOT NULL`;
        },
        pathEquals: (
          col,
          { path: subPath, value }: { path: string[]; value: unknown },
          ctx,
        ) => {
          const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
          return sql`${col} #>> '{${sql.raw(fullPath)}}' = ${String(value)}`;
        },
        pathContains: (
          col,
          { path: subPath, value }: { path: string[]; value: unknown },
          ctx,
        ) => {
          const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
          return sql`${col} #> '{${sql.raw(fullPath)}}' @> ${JSON.stringify(value)}::jsonb`;
        },
        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NULL`;
        },
        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col} #> '{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config) {
    return {
      type: "json",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: config.localized ?? false,
      unique: false,
      searchable: false,
      // JSON schema is for validation, included in introspection
      jsonSchema: config.schema,
    };
  },
});
```

---

# Validation & JSON Schema (Zod v4)

> **Important:** Zod v4 provides built-in JSON Schema export via `z.toJSONSchema()`.
> Fields only implement `toZodSchema()` - JSON Schema is derived automatically.

## Zod v4 JSON Schema Export

```typescript
import { z } from "zod";

// Field implements only Zod schema
const textField = field("text", {
  toZodSchema(config) {
    let schema = z.string();
    if (config.maxLength) schema = schema.max(config.maxLength);
    if (config.minLength) schema = schema.min(config.minLength);
    if (config.pattern) schema = schema.regex(config.pattern);
    if (!config.required) schema = schema.nullish();
    return schema;
  },
});

// JSON Schema is derived at collection level
const field = f.text({ required: true, maxLength: 255, minLength: 1 });
const zodSchema = field.toZodSchema();
const jsonSchema = z.toJSONSchema(zodSchema);

// Result:
// {
//   "type": "string",
//   "maxLength": 255,
//   "minLength": 1
// }
```

## Collection-Level Schema Generation

```typescript
// packages/questpie/src/server/collection/validation.ts

import { z } from "zod";

/**
 * Generate validation schemas for a collection.
 * Zod schemas are built from field definitions.
 * JSON Schema is derived from Zod for client-side validation.
 */
function generateCollectionSchemas<
  TFields extends Record<string, FieldDefinition>,
>(fields: TFields): CollectionValidation {
  // Build Zod object schema from fields
  const shape: Record<string, ZodSchema> = {};

  for (const [name, field] of Object.entries(fields)) {
    // Skip fields with input: false
    if (field.config.input === false) continue;
    shape[name] = field.toZodSchema();
  }

  const insertSchema = z.object(shape);
  const updateSchema = z.object(shape).partial();

  // Derive JSON Schema from Zod (Zod v4 feature)
  const jsonSchema = z.toJSONSchema(insertSchema);

  return {
    insertSchema,
    updateSchema,
    jsonSchema,
  };
}

interface CollectionValidation {
  /** Zod schema for create operations */
  insertSchema: ZodSchema;

  /** Zod schema for update operations (all fields optional) */
  updateSchema: ZodSchema;

  /** JSON Schema for client-side validation (react-hook-form, etc.) */
  jsonSchema: JSONSchema7;
}
```

## API Endpoint for Client Validation

```typescript
// GET /api/cms/collections/:name/schema
// Returns JSON Schema for client-side form validation

handler: async (ctx) => {
  const { name } = ctx.params;
  const collection = ctx.cms.collections[name];

  if (!collection) {
    throw new ApiError(404, `Collection not found: ${name}`);
  }

  // JSON Schema is pre-generated from Zod
  return json({
    $schema: "http://json-schema.org/draft-07/schema#",
    ...collection.validation.jsonSchema,
  });
};
```

## Benefits of Zod v4 Approach

1. **Single source of truth** - Zod schema defines validation, JSON Schema derived
2. **Type inference** - `z.infer<typeof schema>` provides TypeScript types
3. **Async validation** - Zod supports async refinements (DB lookups, etc.)
4. **Client compatibility** - JSON Schema works with react-hook-form, ajv, etc.
5. **No duplication** - Don't maintain both Zod and JSON Schema

## Example: Complex Nested Schema

```typescript
const workingHoursField = f.object({
  fields: (f) => ({
    monday: f.object({
      fields: (f) => ({
        open: f.time(),
        close: f.time(),
        closed: f.boolean({ default: false }),
      }),
    }),
    // ... other days
  }),
});

// Zod schema (generated)
const zodSchema = workingHoursField.toZodSchema();
// z.object({
//   monday: z.object({
//     open: z.string().time(),
//     close: z.string().time(),
//     closed: z.boolean().default(false),
//   }),
//   ...
// })

// JSON Schema (derived from Zod)
const jsonSchema = z.toJSONSchema(zodSchema);
// {
//   "type": "object",
//   "properties": {
//     "monday": {
//       "type": "object",
//       "properties": {
//         "open": { "type": "string", "format": "time" },
//         "close": { "type": "string", "format": "time" },
//         "closed": { "type": "boolean", "default": false }
//       }
//     }
//   }
// }
```

---

# Phase 5: Operators & Query Builder Integration

> **Package:** `questpie/server`
> **Priority:** P1
> **Dependencies:** Phase 2

## 5.0 Backward Compatibility - CRITICAL

**The existing Where/Operator API MUST remain unchanged.** This is a non-negotiable requirement.

### Existing Operators (preserve exactly)

```typescript
// Current WhereOperators - DO NOT CHANGE
interface WhereOperators<T> {
  eq?: T;
  ne?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  in?: T[];
  notIn?: T[];
  like?: string;
  ilike?: string;
  notLike?: string;
  notIlike?: string;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  isNull?: boolean;
  isNotNull?: boolean;
  arrayOverlaps?: T[];
  arrayContained?: T[];
  arrayContains?: T[];
}

// Current RelationFilter - DO NOT CHANGE
type RelationFilter<TFields, TRelations> =
  | Where<TFields, TRelations>
  | {
      some?: Where<TFields, TRelations>; // EXISTS
      none?: Where<TFields, TRelations>; // NOT EXISTS
      every?: Where<TFields, TRelations>; // NOT EXISTS (NOT ...)
      is?: Where<TFields, TRelations>; // For belongsTo
      isNot?: Where<TFields, TRelations>; // For belongsTo
    };

// Current Where - DO NOT CHANGE
type Where<TFields, TRelations> = {
  [K in keyof TFields]?: TFields[K] | WhereOperators<TFields[K]>;
} & {
  AND?: Where<TFields, TRelations>[];
  OR?: Where<TFields, TRelations>[];
  NOT?: Where<TFields, TRelations>;
  RAW?: (table: any) => SQL;
} & RelationWhereFields<TRelations>;
```

### What Field Builder Adds (extensions, not changes)

Field builder **extends** operator support without changing existing API:

1. **Context-aware operators** - same operator name, different implementation for column vs JSONB
2. **Custom operators** - fields can add new operators (e.g., `near` for geometry)
3. **Nested JSONB paths** - new syntax `"field.nested.path"` for JSONB queries

```typescript
// Existing syntax - UNCHANGED
{ title: { eq: "Hello" } }
{ author: { some: { name: "John" } } }
{ AND: [{ status: "active" }, { views: { gt: 100 } }] }

// New syntax - ADDITIONS (opt-in)
{ "seo.title": { contains: "keyword" } }     // JSONB nested path
{ location: { near: { point: [...], distance: 5000 } } }  // Custom operator
```

### Joins vs Multiple Queries

**JOINs are ONLY for WHERE clauses**, not for data loading:

```typescript
// WHERE with relation filter - uses EXISTS subquery (current behavior)
posts.find({
  where: {
    author: { some: { role: "admin" } }, // EXISTS subquery
  },
});

// Data loading with 'with' - uses MULTIPLE QUERIES (current behavior)
posts.find({
  with: {
    author: true, // Separate query, batched
    comments: true, // Separate query, batched
  },
});

// WHY multiple queries?
// 1. Hooks can run on each related record
// 2. Access control per record
// 3. Pagination per relation
// 4. Avoids cartesian explosion
// 5. Better caching potential
```

---

## 5.1 Operator Registry

```typescript
// packages/questpie/src/server/fields/operators/types.ts

/**
 * Operator function type.
 * Generates SQL condition from column and value.
 */
type OperatorFn<TValue = unknown> = (
  column: PgColumn,
  value: TValue,
  ctx: QueryContext,
) => SQL;

/**
 * Map of operator name to function.
 */
type OperatorMap<TColumnValue = unknown> = {
  [K in StandardOperator]?: OperatorFn<OperatorValue<K, TColumnValue>>;
} & {
  [K: string]: OperatorFn<unknown> | undefined;
};

/**
 * Standard operators available for most fields.
 */
type StandardOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull"
  | "like"
  | "ilike"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "between";

/**
 * Query context passed to operators.
 */
interface QueryContext {
  /** Current table/alias */
  table: PgTable;

  /** Table name */
  tableName: string;

  /** Collection instance */
  collection: Collection;

  /** Database client */
  db: DrizzleClient;

  /** Request locale */
  locale?: string;

  /** Registered field definitions */
  fields: Record<string, FieldDefinition>;

  /** Current field name being processed */
  fieldName: string;

  /** Current field definition being processed */
  field?: FieldDefinition;

  /**
   * JSONB path from root column (for nested field queries).
   * Present when querying fields inside object/array/blocks.
   * Example: ["seo", "title"] for query `"seo.title": { eq: "..." }`
   *
   * NOTE: Paths should be validated/sanitized before use in sql.raw()
   * to prevent SQL injection. Only allow alphanumeric + underscore.
   */
  jsonbPath?: string[];

  /** Parent JSONB column name (when inside JSONB context) */
  jsonbColumn?: string;
}
```

## 5.2 Where Clause Builder

```typescript
// packages/questpie/src/server/fields/operators/where-builder.ts

/**
 * Build SQL WHERE clause from field-aware conditions.
 */
function buildWhere(where: WhereInput, ctx: QueryContext): SQL {
  const conditions: SQL[] = [];

  for (const [fieldName, condition] of Object.entries(where)) {
    // Handle AND/OR
    if (fieldName === "AND") {
      const andConditions = (condition as WhereInput[]).map((w) =>
        buildWhere(w, ctx),
      );
      conditions.push(and(...andConditions)!);
      continue;
    }

    if (fieldName === "OR") {
      const orConditions = (condition as WhereInput[]).map((w) =>
        buildWhere(w, ctx),
      );
      conditions.push(or(...orConditions)!);
      continue;
    }

    if (fieldName === "NOT") {
      conditions.push(not(buildWhere(condition as WhereInput, ctx)));
      continue;
    }

    // Get field definition
    const fieldDef = ctx.fields[fieldName];
    if (!fieldDef) {
      throw new Error(`Unknown field: ${fieldName}`);
    }

    // Get column
    const column = ctx.table[fieldName];
    if (!column) {
      // May be a relation field that needs join handling
      if (fieldDef.type === "relation") {
        conditions.push(buildRelationCondition(fieldDef, condition, ctx));
        continue;
      }
      throw new Error(`No column for field: ${fieldName}`);
    }

    // Get operators for this field
    const operators = fieldDef.getOperators();

    // Handle condition
    if (typeof condition !== "object" || condition === null) {
      // Direct equality
      if (operators.eq) {
        conditions.push(operators.eq(column, condition, ctx));
      } else {
        conditions.push(eq(column, condition));
      }
    } else {
      // Operator conditions
      for (const [opName, opValue] of Object.entries(condition)) {
        const operator = operators[opName];
        if (!operator) {
          throw new Error(`Unknown operator ${opName} for field ${fieldName}`);
        }
        conditions.push(operator(column, opValue, ctx));
      }
    }
  }

  return and(...conditions) ?? sql`TRUE`;
}

/**
 * Build condition for relation fields.
 */
function buildRelationCondition(
  fieldDef: FieldDefinition,
  condition: unknown,
  ctx: QueryContext,
): SQL {
  const operators = fieldDef.getOperators();
  const config = fieldDef.config as RelationFieldConfig;

  if (typeof condition !== "object" || condition === null) {
    // Direct ID comparison for belongsTo
    if (config.type === "belongsTo" && operators.eq) {
      const fkColumn = ctx.table[config.foreignKey ?? `${ctx.fieldName}Id`];
      return operators.eq(fkColumn, condition, ctx);
    }
    throw new Error("Invalid relation condition");
  }

  // Operator conditions (has, hasNot, etc.)
  const conditions: SQL[] = [];

  for (const [opName, opValue] of Object.entries(condition)) {
    const operator = operators[opName];
    if (!operator) {
      throw new Error(`Unknown operator ${opName} for relation field`);
    }
    conditions.push(operator(null, opValue, ctx));
  }

  return and(...conditions) ?? sql`TRUE`;
}
```

## 5.3 Custom Field Operators Example (PostGIS)

```typescript
// Example: Custom geometry field with PostGIS operators
// packages/questpie/src/server/fields/custom/geometry.ts

interface GeometryFieldConfig extends BaseFieldConfig {
  /** Geometry type */
  geometryType?: "point" | "linestring" | "polygon" | "geometry";

  /** SRID (default: 4326 for WGS84) */
  srid?: number;
}

const geometryField = field<"geometry", GeometryFieldConfig, GeoJSON>(
  "geometry",
  {
    toColumn(name, config) {
      const { geometryType = "geometry", srid = 4326 } = config;

      // Requires PostGIS extension
      // CREATE EXTENSION IF NOT EXISTS postgis;
      return sql`${sql.identifier(name)} geometry(${geometryType}, ${srid})`;
    },

    toZodSchema() {
      // GeoJSON validation
      return z.object({
        type: z.enum([
          "Point",
          "LineString",
          "Polygon",
          "MultiPoint",
          "MultiLineString",
          "MultiPolygon",
        ]),
        coordinates: z.array(z.unknown()),
      });
    },

    // NOTE: No toJsonSchema()! Derived from Zod via z.toJSONSchema()

    getOperators(config) {
      const srid = config.srid ?? 4326;

      return {
        // Distance queries (in meters for geography)
        near: (
          col,
          { point, distance }: { point: [number, number]; distance: number },
        ) => {
          return sql`ST_DWithin(
          ${col}::geography,
          ST_SetSRID(ST_MakePoint(${point[0]}, ${point[1]}), ${srid})::geography,
          ${distance}
        )`;
        },

        // Bounding box
        within: (col, bbox: [number, number, number, number]) => {
          const [minX, minY, maxX, maxY] = bbox;
          return sql`${col} && ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}, ${srid})`;
        },

        // Contains geometry
        contains: (col, geojson: GeoJSON) => {
          return sql`ST_Contains(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Within geometry
        withinGeometry: (col, geojson: GeoJSON) => {
          return sql`ST_Within(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Intersects
        intersects: (col, geojson: GeoJSON) => {
          return sql`ST_Intersects(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Distance (returns value, use in select/orderBy)
        distanceFrom: (col, point: [number, number]) => {
          return sql`ST_Distance(
          ${col}::geography,
          ST_SetSRID(ST_MakePoint(${point[0]}, ${point[1]}), ${srid})::geography
        )`;
        },

        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      };
    },

    getMetadata(config) {
      return {
        type: "geometry",
        label: config.label,
        description: config.description,
        required: config.required ?? false,
        localized: false,
        unique: false,
        searchable: false,
        // Geometry config is part of field type
        geometryType: config.geometryType,
        srid: config.srid,
      };
    },
  },
);

// Usage
const locations = q.collection("locations").fields((f) => ({
  name: f.text({ label: "Name" }),
  position: geometryField({
    label: "Position",
    geometryType: "point",
  }),
  area: geometryField({
    label: "Service Area",
    geometryType: "polygon",
  }),
}));

// Query
const nearbyLocations = await locations.find({
  where: {
    position: {
      near: { point: [17.1077, 48.1486], distance: 5000 }, // 5km
    },
    area: {
      intersects: userLocation,
    },
  },
  orderBy: {
    position: { distanceFrom: [17.1077, 48.1486] },
  },
});
```

---

# Phase 6: Admin Introspection

> **Package:** `questpie/server`, `@questpie/admin`
> **Priority:** P1
> **Dependencies:** Phase 3

## 6.1 Introspection API

```typescript
// packages/questpie/src/server/adapters/introspection.ts

interface CollectionIntrospection {
  name: string;
  label?: I18nText;
  description?: I18nText;

  /** Field definitions - includes localized, searchable flags per field */
  fields: Record<string, FieldMetadata>;

  // NOTE: No separate `localized: string[]` or `searchableFields: string[]`
  // These are derived from FieldMetadata.localized and FieldMetadata.searchable

  /** Field used for display title */
  title?: string;

  /** Collection options */
  timestamps: boolean;
  softDelete: boolean;
  versioning: boolean;

  /** Upload configuration (if collection is uploadable) */
  upload?: {
    enabled: boolean;
    mimeTypes?: string[];
    maxSize?: number;
  };

  /** JSON Schema for client validation (derived from Zod) */
  validation: {
    jsonSchema: JSONSchema7;
  };
}

interface GlobalIntrospection {
  name: string;
  label?: I18nText;
  description?: I18nText;

  fields: Record<string, FieldMetadata>;

  validation: {
    jsonSchema: JSONSchema7;
  };
}

interface CMSIntrospection {
  collections: Record<string, CollectionIntrospection>;
  globals: Record<string, GlobalIntrospection>;

  fieldTypes: string[];

  locales: string[];
  defaultLocale: string;
}

/**
 * Generate introspection data from CMS config.
 *
 * NOTE: localized/searchable info is in FieldMetadata, not collection level.
 * Use helper functions to derive collection-level lists if needed.
 */
function generateIntrospection(cms: CMS): CMSIntrospection {
  const collections: Record<string, CollectionIntrospection> = {};

  for (const [name, collection] of Object.entries(cms.collections)) {
    const fields: Record<string, FieldMetadata> = {};

    for (const [fieldName, fieldDef] of Object.entries(collection.fields)) {
      fields[fieldName] = fieldDef.getMetadata();
    }

    collections[name] = {
      name,
      label: collection.options.label,
      description: collection.options.description,
      fields,
      // Localized/searchable derived from FieldMetadata:
      // localizedFields = Object.entries(fields).filter(([_, f]) => f.localized).map(([k]) => k)
      // searchableFields = Object.entries(fields).filter(([_, f]) => f.searchable).map(([k]) => k)
      title: collection.title,
      timestamps: collection.options.timestamps ?? false,
      softDelete: collection.options.softDelete ?? false,
      versioning: collection.options.versioning ?? false,
      upload: collection.upload
        ? {
            enabled: true,
            mimeTypes: collection.upload.mimeTypes,
            maxSize: collection.upload.maxSize,
          }
        : undefined,
      validation: {
        // JSON Schema derived from Zod via z.toJSONSchema()
        jsonSchema: collection.validation.jsonSchema,
      },
    };
  }

  // Similar for globals...

  return {
    collections,
    globals: {},
    fieldTypes: Array.from(cms.fieldRegistry.types()),
    locales: cms.config.locales,
    defaultLocale: cms.config.defaultLocale,
  };
}

/**
 * Helper: Get localized fields from FieldMetadata.
 */
function getLocalizedFields(fields: Record<string, FieldMetadata>): string[] {
  return Object.entries(fields)
    .filter(([_, meta]) => meta.localized)
    .map(([name]) => name);
}

/**
 * Helper: Get searchable fields from FieldMetadata.
 */
function getSearchableFields(fields: Record<string, FieldMetadata>): string[] {
  return Object.entries(fields)
    .filter(([_, meta]) => meta.searchable)
    .map(([name]) => name);
}
```

## 6.2 API Endpoints

```typescript
// packages/questpie/src/server/adapters/routes/introspection.ts

// GET /api/cms/_introspect
// Returns full CMS introspection data
handler: async (ctx) => {
  const introspection = generateIntrospection(ctx.cms);
  return json(introspection);
};

// GET /api/cms/_introspect/collections/:name
// Returns single collection introspection
handler: async (ctx) => {
  const { name } = ctx.params;
  const introspection = generateIntrospection(ctx.cms);

  if (!introspection.collections[name]) {
    throw new ApiError(404, `Collection not found: ${name}`);
  }

  return json(introspection.collections[name]);
};

// GET /api/cms/_introspect/collections/:name/schema
// Returns JSON Schema for collection
handler: async (ctx) => {
  const { name } = ctx.params;
  const collection = ctx.cms.collections[name];

  if (!collection) {
    throw new ApiError(404, `Collection not found: ${name}`);
  }

  return json(generateCollectionJsonSchema(collection));
};
```

## 6.3 Admin Auto-Registration

```typescript
// packages/admin/src/client/builder/auto-register.ts

interface AutoRegisterOptions {
  /** Auto-register all collections (default: true) */
  collections?: boolean;

  /** Auto-register all globals (default: true) */
  globals?: boolean;

  /** Collections to exclude from auto-registration */
  excludeCollections?: string[];

  /** Globals to exclude from auto-registration */
  excludeGlobals?: string[];
}

/**
 * Auto-register collections from BE introspection.
 */
function autoRegisterCollections(
  introspection: CMSIntrospection,
  options: AutoRegisterOptions = {},
): AdminConfig {
  const {
    collections = true,
    globals = true,
    excludeCollections = [],
    excludeGlobals = [],
  } = options;

  const adminCollections: Record<string, AdminCollectionConfig> = {};
  const adminGlobals: Record<string, AdminGlobalConfig> = {};

  if (collections) {
    for (const [name, collection] of Object.entries(
      introspection.collections,
    )) {
      if (excludeCollections.includes(name)) continue;

      adminCollections[name] = generateAdminCollectionConfig(collection);
    }
  }

  if (globals) {
    for (const [name, global] of Object.entries(introspection.globals)) {
      if (excludeGlobals.includes(name)) continue;

      adminGlobals[name] = generateAdminGlobalConfig(global);
    }
  }

  return {
    collections: adminCollections,
    globals: adminGlobals,
  };
}

/**
 * Generate admin collection config from BE introspection.
 */
function generateAdminCollectionConfig(
  collection: CollectionIntrospection,
): AdminCollectionConfig {
  const fields: Record<string, AdminFieldConfig> = {};

  for (const [name, metadata] of Object.entries(collection.fields)) {
    fields[name] = generateAdminFieldConfig(metadata);
  }

  return {
    name: collection.name,
    meta: {
      label: collection.label,
      description: collection.description,
    },
    fields,
    list: generateDefaultListConfig(collection),
    form: generateDefaultFormConfig(collection),
    validation: {
      jsonSchema: collection.validation.jsonSchema,
    },
  };
}

/**
 * Generate admin field config from BE metadata.
 * NOTE: BE provides only data-relevant info. Admin adds its own UI config.
 */
function generateAdminFieldConfig(metadata: FieldMetadata): AdminFieldConfig {
  // Map BE field type to admin renderer
  const renderer = fieldTypeToRenderer(metadata.type);

  return {
    type: renderer,
    label: metadata.label,
    description: metadata.description,
    required: metadata.required,
    options: metadata.options,
    validation: metadata.validation,
    nestedFields: metadata.nestedFields
      ? Object.fromEntries(
          Object.entries(metadata.nestedFields).map(([k, v]) => [
            k,
            generateAdminFieldConfig(v),
          ]),
        )
      : undefined,
    // Admin can add its own overrides via .collection() or .fieldOverride()
  };
}

/**
 * Map BE field type to admin renderer.
 */
function fieldTypeToRenderer(type: string): string {
  const mapping: Record<string, string> = {
    text: "text",
    textarea: "textarea",
    number: "number",
    boolean: "switch",
    date: "date",
    datetime: "datetime",
    time: "time",
    select: "select",
    email: "email",
    url: "url",
    json: "json",
    object: "object",
    array: "array",
    richText: "richText",
    upload: "upload",
    relation: "relation",
    polymorphicRelation: "polymorphicRelation",
    geometry: "map", // Custom renderer for PostGIS
  };

  return mapping[type] ?? "json"; // Fallback to JSON for unknown types
}
```

## 6.4 Admin Builder with Auto-Registration

```typescript
// packages/admin/src/client/builder/qa.ts

class AdminBuilder<TState extends AdminBuilderState> {
  /**
   * Auto-register collections from BE introspection.
   * Called during initialization with fetched introspection data.
   */
  autoRegister(
    options?: AutoRegisterOptions,
  ): AdminBuilder<TState & { autoRegistered: true }> {
    // This is a marker method - actual registration happens at runtime
    return this.clone({
      ...this.state,
      autoRegisterOptions: options ?? {},
    });
  }

  /**
   * Override specific collection with custom config.
   * Merges with auto-registered config if enabled.
   */
  collection<TName extends keyof TState["collections"]>(
    name: TName,
    configurator: (
      builder: CollectionBuilder<TState["collections"][TName]>,
    ) => CollectionBuilder<any>,
  ): AdminBuilder<TState> {
    const existingConfig = this.state.collections[name] ?? {};
    const builder = new CollectionBuilder(existingConfig);
    const configured = configurator(builder);

    return this.clone({
      ...this.state,
      collections: {
        ...this.state.collections,
        [name]: configured.state,
      },
    });
  }

  /**
   * Override specific field in a collection.
   */
  fieldOverride<
    TCollection extends keyof TState["collections"],
    TField extends keyof TState["collections"][TCollection]["fields"],
  >(
    collection: TCollection,
    field: TField,
    override: Partial<AdminFieldConfig> & {
      component?: React.ComponentType<any>;
      onChange?: (value: unknown, ctx: FormContext) => void;
    },
  ): AdminBuilder<TState> {
    const collectionConfig = this.state.collections[collection] ?? {};
    const fieldConfig = collectionConfig.fields?.[field] ?? {};

    return this.clone({
      ...this.state,
      collections: {
        ...this.state.collections,
        [collection]: {
          ...collectionConfig,
          fields: {
            ...collectionConfig.fields,
            [field]: {
              ...fieldConfig,
              ...override,
            },
          },
        },
      },
    });
  }
}
```

## 6.5 Usage Example

```typescript
// Before: Verbose admin config
const admin = qa<AppCMS>()
  .use(coreAdminModule)
  .collections({
    posts: builder.collection("posts")
      .meta({ label: "Posts", icon: ArticleIcon })
      .fields(({ r }) => ({
        title: r.text({ label: "Title", required: true }),
        content: r.richText({ label: "Content" }),
        author: r.relation({ targetCollection: "users", label: "Author" }),
        tags: r.relation({ targetCollection: "tags", type: "multiple" }),
      }))
      .list(...)
      .form(...),
  });

// After: Auto-registered with minimal overrides
const admin = qa<AppCMS>()
  .use(coreAdminModule)
  .autoRegister() // All collections from BE
  .collection("posts", cfg => cfg
    .meta({ icon: ArticleIcon }) // Just add icon, label from BE
    .list(({ v, f }) => v.table({
      columns: [f.title, f.author, f.createdAt],
    }))
  )
  .fieldOverride("posts", "content", {
    component: CustomRichTextEditor, // Custom component
    onChange: (value, { form }) => {
      // Update word count
      form.setValue("metadata.wordCount", countWords(value));
    },
  });

// For simple collections - zero config needed!
// They appear in admin automatically with default UI
```

---

# Phase 7: Advanced Features

> **Package:** `questpie/server`, `@questpie/admin`
> **Priority:** P2
> **Dependencies:** Phase 4-6

## 7.1 Field Modules Architecture

Field modules (like `richText`, `blocks`) add support to **both BE and FE** automatically.
The `@questpie/admin` package provides these modules.

```typescript
// @questpie/admin exports field modules for BE + FE
import { adminModule } from "@questpie/admin";

// BE: Register field types + block definitions + validation
const cms = q()
  .use(builtinFields)
  .use(adminModule.server) // Adds richText, blocks fields to BE
  .config({...});

// FE: Register renderers (auto-matched by field type)
const admin = qa<AppCMS>()
  .use(coreAdminModule)  // Includes richText, blocks renderers
  .autoRegister();
```

### Module Structure

```typescript
// @questpie/admin/module.ts

export const adminModule = {
  /**
   * Server-side module: field definitions, validation, operators
   */
  server: {
    fields: {
      richText: richTextField,
      blocks: blocksField,
    },
  },

  /**
   * Client-side module: renderers, editors
   * Automatically included in coreAdminModule
   */
  client: {
    fields: {
      richText: RichTextRenderer,
      blocks: BlocksRenderer,
    },
  },
};
```

---

## 7.2 JSONB Context & Nested Field Operators

When fields are inside JSONB (object, array, blocks), they operate in **JSONB context**.
The system automatically generates appropriate operators for nested paths.

### Field Context Detection

```typescript
interface FieldContext {
  /** Field is stored directly in table column */
  mode: "column" | "jsonb";

  /** JSONB path from root (e.g., ["data", "cta", "label"]) */
  jsonbPath?: string[];

  /** Parent JSONB column name */
  jsonbColumn?: string;
}

// System detects context during field registration
function getFieldContext(
  fieldName: string,
  parentContext?: FieldContext,
): FieldContext {
  if (!parentContext) {
    return { mode: "column" };
  }

  return {
    mode: "jsonb",
    jsonbPath: [...(parentContext.jsonbPath ?? []), fieldName],
    jsonbColumn: parentContext.jsonbColumn,
  };
}
```

### Security: JSONB Path Sanitization

**CRITICAL:** JSONB paths used in `sql.raw()` must be sanitized to prevent SQL injection.

```typescript
// packages/questpie/src/server/fields/operators/path-utils.ts

/**
 * Validate and sanitize JSONB path segments.
 * Only allows alphanumeric characters, underscores, and hyphens.
 * Throws error on invalid characters to prevent SQL injection.
 */
function sanitizeJsonbPath(path: string[]): string[] {
  const validPattern = /^[a-zA-Z0-9_-]+$/;

  for (const segment of path) {
    if (!validPattern.test(segment)) {
      throw new Error(
        `Invalid JSONB path segment: "${segment}". ` +
          `Only alphanumeric, underscore, and hyphen allowed.`,
      );
    }
  }

  return path;
}

/**
 * Build safe JSONB path string for use in sql.raw().
 */
function buildJsonbPath(path: string[]): string {
  const sanitized = sanitizeJsonbPath(path);
  return sanitized.join(",");
}

// Usage in operators:
const path = buildJsonbPath(ctx.jsonbPath!);
return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
```

All operator implementations MUST use `sanitizeJsonbPath()` or `buildJsonbPath()` before
passing paths to `sql.raw()`. The query builder should pre-validate paths when parsing
dot-notation queries like `"seo.title"`.

---

### Operator Variants: Column vs JSONB

**Key principle: Same operator names, automatic context detection.**

User writes the same query syntax regardless of whether field is in column or JSONB.
System automatically selects the correct SQL implementation.

#### Operators by Field Type

| Field Type                 | Available Operators                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **text, email, url**       | `eq`, `ne`, `in`, `notIn`, `like`, `ilike`, `notLike`, `notIlike`, `contains`, `startsWith`, `endsWith`, `isNull`, `isNotNull`                                                               |
| **number**                 | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `between`, `isNull`, `isNotNull`                                                                                                        |
| **boolean**                | `eq`, `ne`, `isNull`, `isNotNull`                                                                                                                                                            |
| **date, datetime, time**   | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `between`, `isNull`, `isNotNull`                                                                                                        |
| **select**                 | `eq`, `ne`, `in`, `notIn`, `isNull`, `isNotNull`                                                                                                                                             |
| **select (multiple)**      | `contains`, `containsAll`, `containsAny`, `isEmpty`, `isNotEmpty`, `length`, `isNull`, `isNotNull`                                                                                           |
| **object**                 | `contains`, `containedBy`, `hasKey`, `hasKeys`, `hasAnyKey`, `pathExists`, `pathEquals`, `jsonPath`, `isEmpty`, `isNotEmpty`, `isNull`, `isNotNull`                                          |
| **array**                  | `contains`, `containsAll`, `containsAny`, `containedBy`, `length`, `lengthGt`, `lengthGte`, `lengthLt`, `lengthLte`, `isEmpty`, `isNotEmpty`, `some`, `every`, `none`, `isNull`, `isNotNull` |
| **json**                   | Same as **object**                                                                                                                                                                           |
| **relation (belongsTo)**   | `eq`, `ne`, `in`, `notIn`, `is`, `isNot`, `isNull`, `isNotNull`                                                                                                                              |
| **relation (hasMany/m2m)** | `some`, `none`, `every`                                                                                                                                                                      |
| **polymorphicRelation**    | `typeIs`, `typeIn`, `is`, `isNot`, `isNull`, `isNotNull`                                                                                                                                     |
| **blocks**                 | `hasBlock`, `blockCount`, `blockCountGt`, `blockCountLt`, `isEmpty`, `isNotEmpty`, `some`, `none`, `isNull`, `isNotNull`                                                                     |

#### Complete Operator Mapping (Primitives)

| Operator     | Column SQL          | JSONB SQL                         |
| ------------ | ------------------- | --------------------------------- |
| `eq`         | `col = value`       | `col#>>'{path}' = value`          |
| `ne`         | `col != value`      | `col#>>'{path}' != value`         |
| `gt`         | `col > value`       | `(col#>>'{path}')::type > value`  |
| `gte`        | `col >= value`      | `(col#>>'{path}')::type >= value` |
| `lt`         | `col < value`       | `(col#>>'{path}')::type < value`  |
| `lte`        | `col <= value`      | `(col#>>'{path}')::type <= value` |
| `in`         | `col IN (...)`      | `col#>>'{path}' IN (...)`         |
| `notIn`      | `col NOT IN (...)`  | `col#>>'{path}' NOT IN (...)`     |
| `like`       | `col LIKE value`    | `col#>>'{path}' LIKE value`       |
| `ilike`      | `col ILIKE value`   | `col#>>'{path}' ILIKE value`      |
| `contains`   | `col ILIKE %value%` | `col#>>'{path}' ILIKE %value%`    |
| `startsWith` | `col LIKE value%`   | `col#>>'{path}' LIKE value%`      |
| `endsWith`   | `col LIKE %value`   | `col#>>'{path}' LIKE %value`      |
| `isNull`     | `col IS NULL`       | `col#>'{path}' IS NULL`           |
| `isNotNull`  | `col IS NOT NULL`   | `col#>'{path}' IS NOT NULL`       |

#### JSONB-Only Operators (available on object/array/json fields)

| Operator                 | SQL                        | Description        |
| ------------------------ | -------------------------- | ------------------ |
| `@>` / `jsonContains`    | `col @> '{...}'::jsonb`    | JSONB contains     |
| `<@` / `jsonContainedBy` | `col <@ '{...}'::jsonb`    | JSONB contained by |
| `?` / `hasKey`           | `col ? 'key'`              | Has key            |
| `?&` / `hasKeys`         | `col ?& array[...]`        | Has all keys       |
| `?\|` / `hasAnyKey`      | `col ?\| array[...]`       | Has any key        |
| `@?` / `jsonPathExists`  | `col @? '$.path'`          | JSONPath exists    |
| `@@` / `jsonPathMatch`   | `col @@ '$.path == value'` | JSONPath predicate |

#### Type Casting for Comparisons

For numeric/date comparisons in JSONB, automatic type casting is applied:

```sql
-- Number field in JSONB
(col#>>'{path}')::numeric > 100

-- Date field in JSONB
(col#>>'{path}')::timestamp > '2024-01-01'

-- Boolean field in JSONB
(col#>>'{path}')::boolean = true
```

#### Array Fields in JSONB

```typescript
// Array of primitives
keywords: f.array({ of: f.text() })

// Operators
{ "seo.keywords": { contains: "typescript" } }
// SQL: seo->'keywords' ? 'typescript'

{ "seo.keywords": { containsAll: ["typescript", "react"] } }
// SQL: seo->'keywords' ?& array['typescript', 'react']

{ "seo.keywords": { isEmpty: true } }
// SQL: jsonb_array_length(seo->'keywords') = 0

{ "seo.keywords": { length: 5 } }
// SQL: jsonb_array_length(seo->'keywords') = 5
```

#### Nested Object Queries

```typescript
// Nested path syntax with dot notation
{ "settings.notifications.email": { eq: true } }
// SQL: settings#>>'{notifications,email}' = 'true'

// Deep nesting works too
{ "config.theme.colors.primary": { eq: "#ff0000" } }
// SQL: config#>>'{theme,colors,primary}' = '#ff0000'
```

```typescript
// packages/questpie/src/server/fields/operators/context-operators.ts

/**
 * Each field type provides operators for both contexts.
 * System selects appropriate variant based on field context.
 */
interface ContextualOperators {
  /** Operators for direct column access */
  column: OperatorMap;

  /** Operators for JSONB path access */
  jsonb: OperatorMap;
}

// Example: Text field operators
const textFieldOperators: ContextualOperators = {
  // Direct column operators
  column: {
    eq: (col, value) => eq(col, value),
    like: (col, value) => like(col, value),
    ilike: (col, value) => ilike(col, value),
    startsWith: (col, value) => like(col, `${value}%`),
    contains: (col, value) => ilike(col, `%${value}%`),
  },

  // JSONB path operators
  jsonb: {
    eq: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col}#>>'{${sql.raw(path)}}' = ${value}`;
    },
    like: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value}`;
    },
    ilike: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${value}`;
    },
    startsWith: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value + "%"}`;
    },
    contains: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + value + "%"}`;
    },
  },
};

// Number field operators
const numberFieldOperators: ContextualOperators = {
  column: {
    eq: (col, value) => eq(col, value),
    gt: (col, value) => gt(col, value),
    gte: (col, value) => gte(col, value),
    lt: (col, value) => lt(col, value),
    lte: (col, value) => lte(col, value),
    between: (col, [min, max]) => between(col, min, max),
  },

  jsonb: {
    eq: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric = ${value}`;
    },
    gt: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric > ${value}`;
    },
    gte: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric >= ${value}`;
    },
    lt: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric < ${value}`;
    },
    lte: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric <= ${value}`;
    },
    between: (col, [min, max], ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`(${col}#>>'{${sql.raw(path)}}')::numeric BETWEEN ${min} AND ${max}`;
    },
  },
};

// Object field operators
const objectFieldOperators: ContextualOperators = {
  column: {
    // JSONB containment operators
    contains: (col, value) => sql`${col} @> ${JSON.stringify(value)}::jsonb`,
    containedBy: (col, value) => sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
    hasKey: (col, key) => sql`${col} ? ${key}`,
    hasKeys: (col, keys) =>
      sql`${col} ?& array[${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )}]`,
    hasAnyKey: (col, keys) =>
      sql`${col} ?| array[${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )}]`,

    // Path existence
    pathExists: (col, path) =>
      sql`${col} #> ${`{${path.join(",")}}`} IS NOT NULL`,
    pathEquals: (col, { path, value }) =>
      sql`${col} #>> ${`{${path.join(",")}}`} = ${String(value)}`,

    // JSONPath (PostgreSQL 12+)
    jsonPath: (col, path) => sql`${col} @? ${path}`,
    jsonPathValue: (col, { path, value }) =>
      sql`${col} @@ ${`${path} == ${JSON.stringify(value)}`}`,

    isNull: (col) => isNull(col),
    isNotNull: (col) => isNotNull(col),
    isEmpty: (col) => sql`${col} = '{}'::jsonb`,
    isNotEmpty: (col) => sql`${col} != '{}'::jsonb`,
  },

  jsonb: {
    // When object is inside another JSONB, path is prepended
    contains: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify(value)}::jsonb`;
    },
    hasKey: (col, key, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' ? ${key}`;
    },
    pathExists: (col, subPath, ctx) => {
      const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
      return sql`${col} #> '{${sql.raw(fullPath)}}' IS NOT NULL`;
    },
    pathEquals: (col, { path: subPath, value }, ctx) => {
      const fullPath = [...ctx.jsonbPath!, ...subPath].join(",");
      return sql`${col} #>> '{${sql.raw(fullPath)}}' = ${String(value)}`;
    },
    isNull: (col, _, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' IS NULL`;
    },
    isNotNull: (col, _, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' IS NOT NULL`;
    },
  },
};

// Array field operators
const arrayFieldOperators: ContextualOperators = {
  column: {
    // Array containment
    contains: (col, value) => sql`${col} @> ${JSON.stringify([value])}::jsonb`,
    containsAll: (col, values) =>
      sql`${col} @> ${JSON.stringify(values)}::jsonb`,
    containsAny: (col, values) =>
      sql`${col} ?| array[${sql.join(
        values.map((v) => sql`${JSON.stringify(v)}`),
        sql`, `,
      )}]`,
    containedBy: (col, values) =>
      sql`${col} <@ ${JSON.stringify(values)}::jsonb`,

    // Array length
    length: (col, len) => sql`jsonb_array_length(${col}) = ${len}`,
    lengthGt: (col, len) => sql`jsonb_array_length(${col}) > ${len}`,
    lengthGte: (col, len) => sql`jsonb_array_length(${col}) >= ${len}`,
    lengthLt: (col, len) => sql`jsonb_array_length(${col}) < ${len}`,
    lengthLte: (col, len) => sql`jsonb_array_length(${col}) <= ${len}`,
    isEmpty: (col) => sql`jsonb_array_length(${col}) = 0`,
    isNotEmpty: (col) => sql`jsonb_array_length(${col}) > 0`,

    // Element queries
    some: (col, where, ctx) => {
      // EXISTS with jsonb_array_elements
      return sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col}) AS elem
        WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
      )`;
    },
    every: (col, where, ctx) => {
      // NOT EXISTS with negated condition
      return sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col}) AS elem
        WHERE NOT (${buildJsonbElementWhere(where, sql`elem`, ctx)})
      )`;
    },
    none: (col, where, ctx) => {
      return sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col}) AS elem
        WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
      )`;
    },

    isNull: (col) => isNull(col),
    isNotNull: (col) => isNotNull(col),
  },

  jsonb: {
    // Same operators but with path prefix
    contains: (col, value, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
    },
    containsAll: (col, values, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`${col} #> '{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
    },
    length: (col, len, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') = ${len}`;
    },
    isEmpty: (col, _, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`jsonb_array_length(${col} #> '{${sql.raw(path)}}') = 0`;
    },
    some: (col, where, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
        WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
      )`;
    },
    every: (col, where, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
        WHERE NOT (${buildJsonbElementWhere(where, sql`elem`, ctx)})
      )`;
    },
    none: (col, where, ctx) => {
      const path = ctx.jsonbPath!.join(",");
      return sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${col} #> '{${sql.raw(path)}}') AS elem
        WHERE ${buildJsonbElementWhere(where, sql`elem`, ctx)}
      )`;
    },
  },
};

// Polymorphic relation operators
const polymorphicRelationOperators: OperatorMap = {
  // Filter by type
  typeIs: (_, type, ctx) => {
    const typeCol =
      ctx.table[ctx.field.config.typeField ?? `${ctx.fieldName}Type`];
    return eq(typeCol, type);
  },
  typeIn: (_, types, ctx) => {
    const typeCol =
      ctx.table[ctx.field.config.typeField ?? `${ctx.fieldName}Type`];
    return inArray(typeCol, types);
  },

  // Check if related record exists with condition (type-specific)
  is: (_, { type, where }, ctx) => {
    const typeCol =
      ctx.table[ctx.field.config.typeField ?? `${ctx.fieldName}Type`];
    const idCol = ctx.table[ctx.field.config.idField ?? `${ctx.fieldName}Id`];

    if (!where || Object.keys(where).length === 0) {
      // Just check type
      return eq(typeCol, type);
    }

    // Check type AND related record matches
    return sql`
      ${typeCol} = ${type}
      AND EXISTS (
        SELECT 1 FROM ${sql.identifier(type)} AS related
        WHERE related.id = ${idCol}
        AND ${buildWhere(where, { ...ctx, table: sql.identifier("related") })}
      )
    `;
  },

  isNot: (_, { type, where }, ctx) => {
    const typeCol =
      ctx.table[ctx.field.config.typeField ?? `${ctx.fieldName}Type`];
    const idCol = ctx.table[ctx.field.config.idField ?? `${ctx.fieldName}Id`];

    if (!where || Object.keys(where).length === 0) {
      return ne(typeCol, type);
    }

    return sql`
      NOT (
        ${typeCol} = ${type}
        AND EXISTS (
          SELECT 1 FROM ${sql.identifier(type)} AS related
          WHERE related.id = ${idCol}
          AND ${buildWhere(where, { ...ctx, table: sql.identifier("related") })}
        )
      )
    `;
  },

  // Null checks
  isNull: (_, __, ctx) => {
    const idCol = ctx.table[ctx.field.config.idField ?? `${ctx.fieldName}Id`];
    return isNull(idCol);
  },
  isNotNull: (_, __, ctx) => {
    const idCol = ctx.table[ctx.field.config.idField ?? `${ctx.fieldName}Id`];
    return isNotNull(idCol);
  },
};
```

### Usage Examples

```typescript
// Object field queries
const users = await cms.collections.users.find({
  where: {
    // Object contains specific structure
    settings: { contains: { theme: "dark" } },

    // Has specific key
    settings: { hasKey: "notifications" },

    // Path-based query
    "settings.notifications.email": { eq: true },

    // Nested path exists
    settings: { pathExists: ["integrations", "slack"] },
  },
});

// Array field queries
const posts = await cms.collections.posts.find({
  where: {
    // Array contains value
    tags: { contains: "typescript" },

    // Array contains all values
    tags: { containsAll: ["typescript", "react"] },

    // Array length
    tags: { lengthGte: 3 },

    // Some element matches (for array of objects)
    comments: {
      some: { authorId: currentUserId },
    },

    // Every element matches
    items: {
      every: { status: "completed" },
    },

    // No element matches
    reviews: {
      none: { rating: { lt: 3 } },
    },
  },
});

// Polymorphic relation queries
const comments = await cms.collections.comments.find({
  where: {
    // Filter by type
    commentable: { typeIs: "posts" },

    // Filter by type with condition on related
    commentable: {
      is: {
        type: "posts",
        where: { status: "published" },
      },
    },

    // Multiple types
    commentable: { typeIn: ["posts", "pages"] },

    // Not a specific type with condition
    commentable: {
      isNot: {
        type: "products",
        where: { archived: true },
      },
    },
  },
});

// Combined: Array inside object
const pages = await cms.collections.pages.find({
  where: {
    // Query array inside object field
    "seo.keywords": { containsAll: ["seo", "marketing"] },
    "seo.keywords": { lengthGte: 3 },

    // Object inside array (blocks)
    content: {
      some: {
        blockType: "hero",
        "data.title": { contains: "Welcome" },
      },
    },
  },
});
```

### Query Example with Nested JSONB Fields

```typescript
const pages = q.collection("pages").fields((f) => ({
  title: f.text({ required: true }),
  // JSONB object with nested fields
  seo: f.object({
    fields: (f) => ({
      title: f.text({ maxLength: 60 }),
      description: f.textarea({ maxLength: 160 }),
      keywords: f.array({ of: f.text() }),
    }),
  }),
  // Blocks with nested structures
  content: f.blocks({
    allowedBlocks: ["hero", "text", "gallery"],
  }),
}));

// Query with nested JSONB operators
const results = await pages.find({
  where: {
    // Direct column
    title: { contains: "Welcome" },

    // Nested JSONB path - system auto-detects context
    "seo.title": { contains: "SEO" },
    "seo.description": { like: "%keyword%" },

    // Array in JSONB
    "seo.keywords": { contains: "typescript" },

    // Block content query
    content: {
      hasBlock: "hero",
      "$.data.title": { contains: "Hello" }, // JSONPath-like syntax
    },
  },
});

// Generated SQL:
// WHERE title ILIKE '%Welcome%'
//   AND seo#>>'{title}' ILIKE '%SEO%'
//   AND seo#>>'{description}' LIKE '%keyword%'
//   AND seo->'keywords' ? 'typescript'
//   AND EXISTS (SELECT 1 FROM jsonb_array_elements(content) AS block
//               WHERE block->>'blockType' = 'hero')
//   AND EXISTS (SELECT 1 FROM jsonb_array_elements(content) AS block
//               WHERE block#>>'{data,title}' ILIKE '%Hello%')
```

---

## 7.3 JSONB Indexing

Since we know the nested field structure, we can create optimized indexes.

### Index Types for JSONB

```typescript
// packages/questpie/src/server/collection/indexes.ts

interface JsonbIndexConfig {
  /** GIN index on entire JSONB column (for containment queries) */
  gin?: boolean;

  /** B-tree expression indexes on specific paths */
  paths?: Array<{
    path: string[];
    type?: "text" | "numeric" | "boolean" | "timestamp";
    unique?: boolean;
  }>;

  /** GIN index on specific paths (for array containment) */
  ginPaths?: Array<{
    path: string[];
  }>;
}

// Collection builder
const pages = q
  .collection("pages")
  .fields((f) => ({
    title: f.text({ required: true }),
    seo: f.object({
      fields: (f) => ({
        title: f.text({ index: true }), // Creates expression index
        description: f.textarea(),
        score: f.number({ index: true }), // Creates numeric expression index
      }),
    }),
    metadata: f.json(),
  }))
  .indexes(({ table, jsonbIndex }) => ({
    // Auto-generated from field config:
    // seo_title_idx: Expression index on seo->>'title'
    // seo_score_idx: Expression index on (seo->>'score')::numeric

    // Additional manual indexes:
    metadataGin: jsonbIndex(table.metadata, { gin: true }),

    // Custom path index
    seoKeywords: jsonbIndex(table.seo, {
      ginPaths: [{ path: ["keywords"] }],
    }),
  }));
```

### Generated Index SQL

```sql
-- GIN index on entire JSONB column
CREATE INDEX idx_pages_metadata_gin ON pages USING GIN (metadata);

-- Expression index on nested text path
CREATE INDEX idx_pages_seo_title ON pages ((seo->>'title'));

-- Expression index on nested numeric path
CREATE INDEX idx_pages_seo_score ON pages (((seo->>'score')::numeric));

-- GIN index on nested array
CREATE INDEX idx_pages_seo_keywords_gin ON pages USING GIN ((seo->'keywords'));

-- Unique constraint on JSONB path
CREATE UNIQUE INDEX idx_pages_seo_slug_unique ON pages ((seo->>'slug'));
```

### Auto-Index Detection from Field Config

```typescript
// When field has index: true inside object/array, auto-create expression index
function collectJsonbIndexes(
  fields: Record<string, FieldDefinition>,
  parentPath: string[] = [],
  columnName?: string,
): JsonbIndexSpec[] {
  const indexes: JsonbIndexSpec[] = [];

  for (const [name, field] of Object.entries(fields)) {
    const path = [...parentPath, name];

    // Check if field requests index
    if (field.config.index) {
      indexes.push({
        column: columnName ?? name,
        path: parentPath.length > 0 ? path.slice(1) : [], // Remove column name from path
        type: inferIndexType(field.type),
        unique: field.config.unique,
      });
    }

    // Recurse into nested fields
    const nestedFields = field.getNestedFields?.();
    if (nestedFields) {
      indexes.push(
        ...collectJsonbIndexes(nestedFields, path, columnName ?? name),
      );
    }
  }

  return indexes;
}
```

---

## 7.4 Auto-Prefetch for Nested Relations

Since field definitions include relations, the system **automatically knows** what to prefetch.
No manual `extractNestedIds` needed!

### Automatic Relation Discovery

```typescript
// packages/questpie/src/server/fields/prefetch.ts

interface NestedRelation {
  /** Path to the relation field */
  path: string[];

  /** Target collection */
  target: string;

  /** Relation type */
  type: "belongsTo" | "hasMany" | "manyToMany";

  /** Is inside JSONB? */
  inJsonb: boolean;

  /** Parent JSONB column (if inJsonb) */
  jsonbColumn?: string;
}

/**
 * Recursively discover all relations in field tree.
 * Works for object, array, and blocks fields.
 */
function discoverNestedRelations(
  fields: Record<string, FieldDefinition>,
  path: string[] = [],
  inJsonb = false,
  jsonbColumn?: string,
): NestedRelation[] {
  const relations: NestedRelation[] = [];

  for (const [name, field] of Object.entries(fields)) {
    const fieldPath = [...path, name];
    const isJsonbField =
      field.type === "object" ||
      field.type === "array" ||
      field.type === "blocks";
    const currentJsonbColumn = inJsonb
      ? jsonbColumn
      : isJsonbField
        ? name
        : undefined;

    // Is this a relation field?
    if (field.type === "relation") {
      relations.push({
        path: fieldPath,
        target: field.config.target,
        type: field.config.type,
        inJsonb,
        jsonbColumn,
      });
    }

    // Recurse into nested fields
    const nestedFields = field.getNestedFields?.();
    if (nestedFields) {
      relations.push(
        ...discoverNestedRelations(
          nestedFields,
          fieldPath,
          inJsonb || isJsonbField,
          currentJsonbColumn ?? jsonbColumn,
        ),
      );
    }

    // For blocks, discover relations in each block type
    if (field.type === "blocks") {
      const blockRegistry = field.config.blockRegistry;
      for (const [blockType, blockDef] of Object.entries(blockRegistry ?? {})) {
        relations.push(
          ...discoverNestedRelations(
            blockDef.fields,
            [...fieldPath, "$", "data"], // $ represents array item
            true,
            name,
          ),
        );
      }
    }
  }

  return relations;
}
```

### Automatic Prefetch Execution

```typescript
/**
 * Prefetch all nested relations from JSONB fields.
 * Called automatically when `with` includes JSONB fields with relations.
 */
async function prefetchNestedRelations(
  rows: any[],
  relations: NestedRelation[],
  ctx: QueryContext,
): Promise<Map<string, Map<string, any>>> {
  const prefetched = new Map<string, Map<string, any>>();

  // Group relations by target collection
  const byTarget = groupBy(relations, (r) => r.target);

  for (const [target, targetRelations] of Object.entries(byTarget)) {
    // Collect all IDs from all rows for this target
    const allIds = new Set<string>();

    for (const row of rows) {
      for (const relation of targetRelations) {
        const ids = extractIdsFromPath(row, relation.path, relation.inJsonb);
        ids.forEach((id) => allIds.add(id));
      }
    }

    if (allIds.size === 0) continue;

    // Batch fetch all related records
    const records = await ctx.cms.collections[target].find({
      where: { id: { in: [...allIds] } },
    });

    // Store in map for hydration
    const recordMap = new Map(records.data.map((r) => [r.id, r]));
    prefetched.set(target, recordMap);
  }

  return prefetched;
}

/**
 * Extract relation IDs from row, handling JSONB paths.
 */
function extractIdsFromPath(
  row: any,
  path: string[],
  inJsonb: boolean,
): string[] {
  const ids: string[] = [];

  function walk(value: any, remainingPath: string[]) {
    if (!value || remainingPath.length === 0) {
      // End of path - extract ID
      if (typeof value === "string") {
        ids.push(value);
      } else if (value?.id) {
        ids.push(value.id);
      }
      return;
    }

    const [segment, ...rest] = remainingPath;

    if (segment === "$") {
      // Array wildcard - iterate all items
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, rest));
      }
    } else {
      walk(value[segment], rest);
    }
  }

  walk(row, path);
  return ids;
}
```

### Usage - Automatic Prefetch

```typescript
// Block definition with relation - NO extractNestedIds needed!
// Use defineBlock() for all block definitions (consistent API)
const heroBlock = defineBlock("hero", {
  label: { en: "Hero" },
  fields: (f) => ({
    title: f.text({ required: true }),
    backgroundImage: f.relation("assets", { type: "belongsTo" }),
    author: f.relation("users", { type: "belongsTo" }),
  }),
});

const galleryBlock = defineBlock("gallery", {
  label: { en: "Gallery" },
  fields: (f) => ({
    images: f.array({
      of: f.object({
        fields: (f) => ({
          asset: f.relation("assets", { type: "belongsTo" }),
          caption: f.text(),
        }),
      }),
    }),
  }),
});

// Query - system auto-discovers and prefetches nested relations
const pages = await cms.collections.pages.find({
  with: {
    content: true, // Blocks field - auto-prefetches assets, users from blocks
  },
});

// Result: blocks have hydrated relations
pages.data[0].content[0].data.backgroundImage; // Full asset record, not just ID
pages.data[0].content[0].data.author; // Full user record
```

---

## 7.5 Block Definitions (BE-First, No Render)

Blocks are defined on BE with fields only. **No render function** - that's FE concern.
FE can override or provide custom renderers via registry.

### BE Block Definition

```typescript
// packages/questpie/src/server/blocks/block-builder.ts

/**
 * Block definition - BE only, no render.
 * Contains: fields, validation, metadata.
 */
interface BlockDefinition<TFields extends Record<string, FieldDefinition>> {
  readonly type: string;
  readonly fields: TFields;
  readonly schema: ZodSchema<InferBlockData<TFields>>;
  readonly metadata: BlockMetadata;

  /** Discovered nested relations (auto-generated) */
  readonly nestedRelations: NestedRelation[];
}

interface BlockMetadata {
  label: I18nText;
  description?: I18nText;
  icon?: string;
  category?: string;
}

/**
 * Define a block type.
 */
function defineBlock<TFields extends Record<string, FieldDefinition>>(
  type: string,
  config: {
    label: I18nText;
    description?: I18nText;
    icon?: string;
    category?: string;
    fields: (f: FieldBuilderProxy) => TFields;
  },
): BlockDefinition<TFields> {
  const fieldBuilder = createFieldBuilder(defaultRegistry);
  const fields = config.fields(fieldBuilder);

  // Auto-generate Zod schema from fields
  const shape: Record<string, ZodSchema> = {};
  for (const [name, field] of Object.entries(fields)) {
    shape[name] = field.toZodSchema();
  }
  const schema = z.object(shape);

  // Auto-discover nested relations
  const nestedRelations = discoverNestedRelations(fields, [], true, undefined);

  return {
    type,
    fields,
    schema,
    metadata: {
      label: config.label,
      description: config.description,
      icon: config.icon,
      category: config.category,
    },
    nestedRelations,
  };
}
```

### Block Registration on CMS

```typescript
// cms.ts
const heroBlock = defineBlock("hero", {
  label: { en: "Hero Section" },
  icon: "sparkle",
  category: "layout",
  fields: f => ({
    title: f.text({ required: true, localized: true }),
    subtitle: f.text({ localized: true }),
    backgroundImage: f.relation("assets", { type: "belongsTo" }),
    cta: f.object({
      fields: f => ({
        label: f.text({ required: true }),
        url: f.url({ required: true }),
        variant: f.select({
          options: [
            { value: "primary", label: "Primary" },
            { value: "secondary", label: "Secondary" },
          ],
        }),
      }),
    }),
  }),
});

const textBlock = defineBlock("text", {
  label: { en: "Text Section" },
  icon: "text",
  category: "content",
  fields: f => ({
    content: f.richText({ required: true, localized: true }),
    alignment: f.select({
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
      default: "left",
    }),
  }),
});

// Register blocks with CMS
const cms = q()
  .use(builtinFields)
  .use(adminModule.server)
  .blocks({
    hero: heroBlock,
    text: textBlock,
  })
  .config({...});
```

### FE Block Renderers (Optional Override)

```typescript
// admin.ts - FE
import { qa, coreAdminModule } from "@questpie/admin";

// Default: Admin generates form from block field definitions
// Override: Custom renderer for specific blocks

const admin = qa<AppCMS>()
  .use(coreAdminModule)
  .autoRegister()
  // Optional: Custom block renderer
  .blockRenderer("hero", {
    // Custom preview in block list
    preview: ({ data }) => (
      <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-500">
        <h2>{data.title}</h2>
        <p>{data.subtitle}</p>
      </div>
    ),
    // Custom form (optional - default auto-generated from fields)
    form: HeroBlockForm,
  });

// For most blocks, no custom renderer needed!
// Admin auto-generates form from BE field definitions.
```

### Type Inference for Blocks

```typescript
// Block data type is inferred from field definitions
type HeroBlockData = InferBlockData<typeof heroBlock.fields>;
// {
//   title: string;
//   subtitle: string | null;
//   backgroundImage: string; // Relation ID (or hydrated record with prefetch)
//   cta: {
//     label: string;
//     url: string;
//     variant: "primary" | "secondary" | null;
//   };
// }

// Collection with blocks field
const pages = q.collection("pages").fields((f) => ({
  title: f.text({ required: true }),
  content: f.blocks({
    allowedBlocks: ["hero", "text"],
  }),
}));

// Type-safe block data
type PageContent = (typeof pages.$infer.select)["content"];
// Array<
//   | { blockType: "hero"; id: string; data: HeroBlockData }
//   | { blockType: "text"; id: string; data: TextBlockData }
// >
```

---

## 7.6 Summary: What System Knows from Field Definitions

Because we define fields with their types and structure, the system **automatically knows**:

| What                 | How                                                  |
| -------------------- | ---------------------------------------------------- |
| **Validation**       | Zod schema generated from field definitions          |
| **JSON Schema**      | Derived from Zod via `z.toJSONSchema()`              |
| **Operators**        | Context-aware (column vs JSONB) per field type       |
| **Nested relations** | Discovered by walking field tree                     |
| **Prefetch**         | Auto-fetches relations found in JSONB fields         |
| **Indexes**          | Expression indexes on JSONB paths with `index: true` |
| **Admin UI**         | Auto-generated forms from field metadata             |
| **Types**            | Full TypeScript inference for input/output/select    |

No manual configuration needed for:

- ~~`extractNestedIds`~~ - auto-discovered from relation fields
- ~~`toJsonSchema`~~ - derived from Zod
- ~~Block render functions~~ - admin generates from fields
- ~~JSONB path operators~~ - context-aware generation

---

## 7.7 Auto-Generated Field APIs (Options, Search, Validation)

Since we know field types and their configs, we can **automatically generate type-safe API endpoints** for:

- Select options (static + async/server-side)
- Relation search/options
- Field validation
- Enum values

### Field API Endpoint Generation

```typescript
// packages/questpie/src/server/adapters/routes/field-api.ts

/**
 * Auto-generated endpoints for field operations.
 * Admin knows exactly what to call - fully type-safe!
 */

// GET /api/cms/collections/:collection/fields/:field/options
// Returns options for select/relation fields
handler: async (ctx) => {
  const { collection, field } = ctx.params;
  const { search, limit = 20, cursor } = ctx.query;

  const collectionDef = ctx.cms.collections[collection];
  const fieldDef = collectionDef.fields[field];

  if (fieldDef.type === "select") {
    // Static options from field config
    return json({
      options: fieldDef.config.options,
      hasMore: false,
    });
  }

  if (fieldDef.type === "relation") {
    // Dynamic options from related collection
    const targetCollection = fieldDef.config.target;
    const target = ctx.cms.collections[targetCollection];

    // Build search query
    const where = search
      ? {
          OR: target.searchableFields.map((f) => ({
            [f]: { contains: search },
          })),
        }
      : {};

    const results = await target.find({
      where,
      limit,
      cursor,
      columns: getDisplayColumns(fieldDef, target),
    });

    return json({
      options: results.data.map((r) => ({
        value: r.id,
        label: target.getTitle(r),
        data: r, // Full record for display
      })),
      hasMore: results.hasMore,
      nextCursor: results.nextCursor,
    });
  }

  throw new ApiError(400, `Field ${field} does not support options`);
};
```

### Type-Safe Client for Field APIs

```typescript
// packages/admin/src/client/api/field-api.ts

/**
 * Type-safe client for field APIs.
 * Inferred from CMS type - admin knows exact response types!
 */
export function createFieldApi<TApp extends Questpie<any>>() {
  return {
    /**
     * Get options for a select or relation field.
     * Return type is inferred from field definition!
     */
    async getOptions<
      TCollection extends keyof TApp["config"]["collections"],
      TField extends keyof TApp["config"]["collections"][TCollection]["fields"],
    >(
      collection: TCollection,
      field: TField,
      params?: {
        search?: string;
        limit?: number;
        cursor?: string;
      },
    ): Promise<FieldOptionsResponse<TApp, TCollection, TField>> {
      const response = await fetch(
        `/api/cms/collections/${collection}/fields/${field}/options?` +
          new URLSearchParams(params as any),
      );
      return response.json();
    },

    /**
     * Validate a field value server-side.
     * Useful for async validation (uniqueness, etc.)
     */
    async validate<
      TCollection extends keyof TApp["config"]["collections"],
      TField extends keyof TApp["config"]["collections"][TCollection]["fields"],
    >(
      collection: TCollection,
      field: TField,
      value: FieldInputType<TApp, TCollection, TField>,
      context?: { id?: string }, // For uniqueness check excluding current record
    ): Promise<ValidationResult> {
      const response = await fetch(
        `/api/cms/collections/${collection}/fields/${field}/validate`,
        {
          method: "POST",
          body: JSON.stringify({ value, context }),
        },
      );
      return response.json();
    },
  };
}

// Type helpers
type FieldOptionsResponse<TApp, TCollection, TField> =
  TApp["config"]["collections"][TCollection]["fields"][TField] extends {
    type: "select";
  }
    ? { options: SelectOption[]; hasMore: false }
    : TApp["config"]["collections"][TCollection]["fields"][TField] extends {
          type: "relation";
        }
      ? {
          options: RelationOption<
            TApp["config"]["collections"][TApp["config"]["collections"][TCollection]["fields"][TField]["config"]["target"]]
          >[];
          hasMore: boolean;
          nextCursor?: string;
        }
      : never;
```

### Admin Components Use Field APIs Automatically

```typescript
// packages/admin/src/client/fields/relation/RelationField.tsx

function RelationField({ collection, field, ...props }) {
  const api = useFieldApi<AppCMS>();

  // Async options loading - endpoint auto-determined from field config!
  const loadOptions = useCallback(async (search: string) => {
    const result = await api.getOptions(collection, field, { search });
    return result.options;
  }, [collection, field]);

  // Infinite scroll for large datasets
  const {
    options,
    loadMore,
    hasMore
  } = useInfiniteOptions(collection, field);

  return (
    <Combobox
      options={options}
      onSearch={loadOptions}
      onLoadMore={hasMore ? loadMore : undefined}
      {...props}
    />
  );
}
```

### Select Field with Async Options

```typescript
// Field definition supports both static and async options
const products = q.collection("products").fields((f) => ({
  name: f.text({ required: true }),

  // Static options
  status: f.select({
    options: [
      { value: "draft", label: "Draft" },
      { value: "active", label: "Active" },
    ],
  }),

  // Async options from external API
  category: f.select({
    // Options loaded from endpoint
    optionsEndpoint: "/api/categories",
    // Or function for custom logic
    loadOptions: async (search, ctx) => {
      const categories = await ctx.services.categoryApi.search(search);
      return categories.map((c) => ({
        value: c.id,
        label: c.name,
      }));
    },
    // Cache config
    optionsCache: { ttl: 60_000 },
  }),

  // Options from another collection (like relation but stores value, not ID)
  currency: f.select({
    optionsFrom: {
      collection: "currencies",
      valueField: "code", // Store "USD", not ID
      labelField: "name", // Display "US Dollar"
    },
  }),
}));
```

### Introspection Includes Field API Info

```typescript
// GET /api/cms/_introspect/collections/:name
{
  "name": "products",
  "fields": {
    "status": {
      "type": "select",
      "options": [...],          // Static options included
      "api": null                // No async API needed
    },
    "category": {
      "type": "select",
      "options": null,           // No static options
      "api": {
        "optionsEndpoint": "/api/cms/collections/products/fields/category/options",
        "searchable": true,
        "paginated": true
      }
    },
    "author": {
      "type": "relation",
      "target": "users",
      "api": {
        "optionsEndpoint": "/api/cms/collections/products/fields/author/options",
        "searchable": true,
        "searchFields": ["name", "email"],
        "displayFields": ["name", "email", "avatar"],
        "paginated": true
      }
    }
  }
}
```

### Benefits

1. **Zero config for admin** - components know exactly what endpoint to call
2. **Type-safe responses** - TypeScript knows the shape of options
3. **Automatic pagination** - large datasets handled gracefully
4. **Server-side search** - efficient for thousands of options
5. **Caching built-in** - reduce redundant requests
6. **Consistent patterns** - all fields work the same way

---

## 7.8 Custom Fields & Custom Drizzle Types

### Type-Safe Field Definition

The `field` function captures all type information at definition time:

```typescript
// packages/questpie/src/server/fields/define-field.ts

/**
 * Define a custom field with full type inference.
 *
 * @typeParam TType - Field type identifier (e.g., "color", "geometry")
 * @typeParam TConfig - Configuration options interface
 * @typeParam TValue - Runtime value type (what you get when reading)
 * @typeParam TInput - Input type (what you provide when writing) - defaults to TValue
 * @typeParam TColumn - Drizzle column type - inferred from toColumn return
 */
function field<
  TType extends string,
  TConfig extends object,
  TValue,
  TInput = TValue,
  TColumn extends AnyPgColumn = AnyPgColumn,
>(
  type: TType,
  implementation: {
    /**
     * Create Drizzle column. Return type defines the column type.
     * Use customType() for non-standard PostgreSQL types.
     */
    toColumn: (
      name: string,
      config: TConfig & BaseFieldConfig,
    ) => TColumn | ((name: string) => TColumn);

    /**
     * Create Zod schema for validation.
     * Return type must match TInput.
     */
    toZodSchema: (config: TConfig & BaseFieldConfig) => ZodType<TInput>;

    /**
     * Define operators for where clauses.
     * Operators receive value of type matching the operator.
     */
    getOperators: (config: TConfig & BaseFieldConfig) => ContextualOperators;

    /**
     * Get metadata for introspection.
     */
    getMetadata: (config: TConfig & BaseFieldConfig) => FieldMetadata;

    /**
     * Optional: Transform value after reading from DB.
     */
    fromDb?: (dbValue: unknown, config: TConfig & BaseFieldConfig) => TValue;

    /**
     * Optional: Transform value before writing to DB.
     */
    toDb?: (value: TInput, config: TConfig & BaseFieldConfig) => unknown;
  },
): FieldFactory<TType, TConfig, TValue, TInput, TColumn>;
```

### Custom Drizzle Column Types

For PostgreSQL types not natively supported by Drizzle, use `customType`:

```typescript
import { customType } from "drizzle-orm/pg-core";

/**
 * Create a custom Drizzle column type.
 * This is how you add PostGIS, CITEXT, TSVECTOR, etc.
 */
const geometry = customType<{
  data: GeoJSON; // TypeScript type for the value
  driverData: string; // What the driver returns (usually string)
  config: { srid?: number; type?: string };
}>({
  dataType(config) {
    const srid = config?.srid ?? 4326;
    const type = config?.type ?? "geometry";
    return `geometry(${type}, ${srid})`;
  },

  toDriver(value: GeoJSON): string {
    return `ST_GeomFromGeoJSON('${JSON.stringify(value)}')`;
  },

  fromDriver(value: string): GeoJSON {
    // PostGIS returns GeoJSON when using ST_AsGeoJSON
    return JSON.parse(value);
  },
});

// Usage in field definition
const geometryField = field("geometry", {
  toColumn(name, config) {
    return geometry(name, { srid: config.srid, type: config.geometryType });
  },
  // ...
});
```

### PostGIS Geometry Field - Complete Example

```typescript
// packages/questpie/src/server/fields/custom/geometry.ts

import { customType } from "drizzle-orm/pg-core";
import { field } from "../field.js";

// GeoJSON types
interface Point {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

interface Polygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

interface LineString {
  type: "LineString";
  coordinates: [number, number][];
}

type GeoJSON =
  | Point
  | Polygon
  | LineString
  | {
      type: string;
      coordinates: unknown;
    };

// Config interface
interface GeometryFieldConfig {
  /** PostGIS geometry type */
  geometryType?: "point" | "polygon" | "linestring" | "geometry";

  /** Spatial Reference System ID (default: 4326 = WGS84) */
  srid?: number;

  /** Create spatial index */
  spatialIndex?: boolean;
}

// Custom Drizzle column type for PostGIS geometry
const geometryColumn = customType<{
  data: GeoJSON;
  driverData: string;
  config: { srid: number; geometryType: string };
}>({
  dataType(config) {
    return `geometry(${config?.geometryType ?? "geometry"}, ${config?.srid ?? 4326})`;
  },

  toDriver(value: GeoJSON): unknown {
    // Return raw SQL for INSERT/UPDATE
    return sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})`;
  },

  fromDriver(value: string): GeoJSON {
    // Assumes query uses ST_AsGeoJSON
    if (typeof value === "string") {
      return JSON.parse(value);
    }
    return value as GeoJSON;
  },
});

// Field definition with full type inference
export const geometryField = field<
  "geometry",
  GeometryFieldConfig,
  GeoJSON, // TValue - what you read
  GeoJSON, // TInput - what you write
  ReturnType<typeof geometryColumn> // TColumn - Drizzle column type
>("geometry", {
  toColumn(name, config) {
    const col = geometryColumn(name, {
      srid: config.srid ?? 4326,
      geometryType: config.geometryType ?? "geometry",
    });

    if (config.required) {
      return col.notNull();
    }
    return col;
  },

  toZodSchema(config) {
    const pointSchema = z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]),
    });

    const polygonSchema = z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    });

    const lineStringSchema = z.object({
      type: z.literal("LineString"),
      coordinates: z.array(z.tuple([z.number(), z.number()])),
    });

    let schema: ZodType<GeoJSON>;

    switch (config.geometryType) {
      case "point":
        schema = pointSchema;
        break;
      case "polygon":
        schema = polygonSchema;
        break;
      case "linestring":
        schema = lineStringSchema;
        break;
      default:
        schema = z.union([pointSchema, polygonSchema, lineStringSchema]);
    }

    return config.required ? schema : schema.nullable();
  },

  getOperators(config) {
    const srid = config.srid ?? 4326;

    return {
      column: {
        // Distance queries (meters for geography)
        near: (
          col,
          { point, distance }: { point: [number, number]; distance: number },
        ) => {
          return sql`ST_DWithin(
            ${col}::geography,
            ST_SetSRID(ST_MakePoint(${point[0]}, ${point[1]}), ${srid})::geography,
            ${distance}
          )`;
        },

        // Distance value (for sorting)
        distanceFrom: (col, point: [number, number]) => {
          return sql`ST_Distance(
            ${col}::geography,
            ST_SetSRID(ST_MakePoint(${point[0]}, ${point[1]}), ${srid})::geography
          )`;
        },

        // Bounding box intersection (fast, uses index)
        withinBBox: (col, bbox: [number, number, number, number]) => {
          const [minLon, minLat, maxLon, maxLat] = bbox;
          return sql`${col} && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, ${srid})`;
        },

        // Geometry contains
        contains: (col, geojson: GeoJSON) => {
          return sql`ST_Contains(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Within geometry
        within: (col, geojson: GeoJSON) => {
          return sql`ST_Within(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Intersects geometry
        intersects: (col, geojson: GeoJSON) => {
          return sql`ST_Intersects(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Touches (boundaries intersect but interiors don't)
        touches: (col, geojson: GeoJSON) => {
          return sql`ST_Touches(${col}, ST_GeomFromGeoJSON(${JSON.stringify(geojson)}))`;
        },

        // Null checks
        isNull: (col) => isNull(col),
        isNotNull: (col) => isNotNull(col),
      },

      // JSONB context (geometry stored as GeoJSON in JSONB)
      jsonb: {
        // When in JSONB, geometry is stored as GeoJSON object
        // Need to convert to geometry for spatial operations
        near: (col, { point, distance }, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`ST_DWithin(
            ST_GeomFromGeoJSON(${col}#>'{${sql.raw(path)}}')::geography,
            ST_SetSRID(ST_MakePoint(${point[0]}, ${point[1]}), ${srid})::geography,
            ${distance}
          )`;
        },

        withinBBox: (col, bbox, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          const [minLon, minLat, maxLon, maxLat] = bbox;
          return sql`ST_GeomFromGeoJSON(${col}#>'{${sql.raw(path)}}') && 
            ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, ${srid})`;
        },

        contains: (col, geojson, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`ST_Contains(
            ST_GeomFromGeoJSON(${col}#>'{${sql.raw(path)}}'),
            ST_GeomFromGeoJSON(${JSON.stringify(geojson)})
          )`;
        },

        isNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
        },

        isNotNull: (col, _, ctx) => {
          const path = ctx.jsonbPath!.join(",");
          return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
        },
      },
    };
  },

  getMetadata(config) {
    return {
      type: "geometry",
      label: config.label,
      description: config.description,
      required: config.required ?? false,
      localized: false,
      unique: false,
      searchable: false,
      geometryType: config.geometryType ?? "geometry",
      srid: config.srid ?? 4326,
    };
  },

  // Optional: Custom select to convert to GeoJSON
  getSelectModifier(config) {
    return {
      // Wrap column with ST_AsGeoJSON for proper GeoJSON output
      wrapSelect: (col, alias) =>
        sql`ST_AsGeoJSON(${col})::jsonb AS ${sql.identifier(alias)}`,
    };
  },
});

// Spatial index helper
export function spatialIndex(column: AnyPgColumn) {
  return sql`CREATE INDEX IF NOT EXISTS idx_${column.name}_gist ON ${column.table} USING GIST (${column})`;
}
```

### Usage & Type Inference

```typescript
// Define collection with geometry field
const locations = q.collection("locations").fields((f) => ({
  name: f.text({ required: true }),
  position: f.geometry({
    geometryType: "point",
    srid: 4326,
    spatialIndex: true,
    required: true,
  }),
  serviceArea: f.geometry({
    geometryType: "polygon",
  }),
}));

// Types are fully inferred!
type LocationSelect = typeof locations.$infer.select;
// {
//   id: string;
//   name: string;
//   position: GeoJSON;        // Required Point
//   serviceArea: GeoJSON | null;  // Optional Polygon
// }

type LocationInsert = typeof locations.$infer.insert;
// {
//   name: string;
//   position: GeoJSON;        // Required
//   serviceArea?: GeoJSON | null;  // Optional
// }

// Query with spatial operators
const nearbyLocations = await locations.find({
  where: {
    position: {
      near: { point: [17.1077, 48.1486], distance: 5000 }, // 5km radius
    },
    serviceArea: {
      contains: { type: "Point", coordinates: [17.1, 48.15] },
    },
  },
  orderBy: {
    // Sort by distance
    position: { distanceFrom: [17.1077, 48.1486] },
  },
});

// The result has proper types
nearbyLocations.data[0].position; // GeoJSON (Point)
nearbyLocations.data[0].position.coordinates; // [number, number]
```

### Other Custom Type Examples

```typescript
// CITEXT (case-insensitive text)
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

const citextField = field<"citext", {}, string>("citext", {
  toColumn: (name, config) => {
    const col = citext(name);
    return config.required ? col.notNull() : col;
  },
  toZodSchema: (config) =>
    config.required ? z.string() : z.string().nullable(),
  getOperators: () => ({
    column: {
      // CITEXT comparisons are case-insensitive by default
      eq: (col, value) => eq(col, value),
      contains: (col, value) => sql`${col} ILIKE ${"%" + value + "%"}`,
      // ... standard string operators
    },
    jsonb: {
      /* ... */
    },
  }),
  getMetadata: (config) => ({
    type: "citext",
    required: config.required ?? false /* ... */,
  }),
});

// TSVECTOR (full-text search)
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

const tsvectorField = field<"tsvector", { language?: string }, string>(
  "tsvector",
  {
    toColumn: (name) => tsvector(name),
    toZodSchema: () => z.string(),
    getOperators: (config) => ({
      column: {
        matches: (col, query) =>
          sql`${col} @@ plainto_tsquery(${config.language ?? "english"}, ${query})`,
        matchesPhrase: (col, phrase) =>
          sql`${col} @@ phraseto_tsquery(${config.language ?? "english"}, ${phrase})`,
        matchesRaw: (col, tsquery) => sql`${col} @@ ${tsquery}::tsquery`,
      },
      jsonb: {
        /* tsvector in JSONB doesn't make sense */
      },
    }),
    getMetadata: (config) => ({
      type: "tsvector",
      required: false,
      language: config.language,
    }),
  },
);

// INET (IP addresses)
const inet = customType<{ data: string; driverData: string }>({
  dataType: () => "inet",
});

const inetField = field<"inet", {}, string>("inet", {
  toColumn: (name, config) => {
    const col = inet(name);
    return config.required ? col.notNull() : col;
  },
  toZodSchema: () => z.string().ip(), // Zod has IP validation
  getOperators: () => ({
    column: {
      eq: (col, value) => eq(col, value),
      containedBy: (col, network) => sql`${col} << ${network}::inet`, // IP in network
      contains: (col, network) => sql`${col} >> ${network}::inet`, // Network contains IP
      containedByOrEquals: (col, network) => sql`${col} <<= ${network}::inet`,
    },
    jsonb: {
      eq: (col, value, ctx) => {
        const path = ctx.jsonbPath!.join(",");
        return sql`(${col}#>>'{${sql.raw(path)}}')::inet = ${value}::inet`;
      },
      containedBy: (col, network, ctx) => {
        const path = ctx.jsonbPath!.join(",");
        return sql`(${col}#>>'{${sql.raw(path)}}')::inet << ${network}::inet`;
      },
    },
  }),
  getMetadata: () => ({ type: "inet", required: false }),
});
```

### Type Flow Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│  field<TType, TConfig, TValue, TInput, TColumn>               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TConfig ─────► toColumn() ─────► TColumn (Drizzle column type)     │
│       │                                                              │
│       ├───────► toZodSchema() ──► ZodType<TInput> (validation)      │
│       │                                                              │
│       └───────► getMetadata() ──► FieldMetadata (introspection)     │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Collection                                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  .fields(f => ({                                            │    │
│  │    position: f.geometry({ geometryType: "point" })          │    │
│  │  }))                                                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                           │                                          │
│                           ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  $infer.select = { position: GeoJSON }         ◄── TValue   │    │
│  │  $infer.insert = { position: GeoJSON }         ◄── TInput   │    │
│  │  table.position = PgColumn<geometry>           ◄── TColumn  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

# Type System & Inference

> **Critical Section:** This defines how types flow through the field builder system.
> Full conditional types ensure 100% type safety based on configuration options.

## Overview: What Config Affects Types

| Config Option | Affects                          | Example                                 |
| ------------- | -------------------------------- | --------------------------------------- |
| `mode`        | TValue, TColumn                  | `mode: "bigint"` → `bigint`, `PgBigInt` |
| `multiple`    | TValue                           | `multiple: true` → `string[]`           |
| `required`    | TInput, TOutput, TColumn.notNull | `required: true` → not null             |
| `default`     | TInput, TColumn.hasDefault       | `default: ""` → optional in input       |
| `input`       | TInput                           | `input: false` → `never` in input       |
| `output`      | TOutput                          | `output: false` → `never` in output     |

## Conditional Value Types (TValue)

Value type depends on field config options, not just field type:

```typescript
/**
 * Number field value type depends on mode.
 */
type InferNumberValue<TConfig extends NumberFieldConfig> =
  TConfig extends { mode: "bigint" }
    ? bigint
    : number;

/**
 * Select field value type depends on multiple.
 */
type InferSelectValue<TConfig extends SelectFieldConfig> =
  TConfig extends { multiple: true }
    ? string[]
    : string;

/**
 * Examples:
 */
f.number({ mode: "integer" })  // TValue = number
f.number({ mode: "bigint" })   // TValue = bigint
f.number({ mode: "decimal" })  // TValue = number (JS doesn't have decimal)

f.select({ options: [...] })              // TValue = string
f.select({ options: [...], multiple: true }) // TValue = string[]
```

## Conditional Column Types (TColumn)

Column type depends on mode AND required/default:

```typescript
/**
 * Text field column type.
 */
type InferTextColumn<TConfig extends TextFieldConfig> = TConfig extends {
  mode: "text";
}
  ? InferColumnModifiers<TConfig, PgTextColumn>
  : InferColumnModifiers<TConfig, PgVarcharColumn>;

/**
 * Number field column type.
 */
type InferNumberColumn<TConfig extends NumberFieldConfig> = TConfig extends {
  mode: "bigint";
}
  ? InferColumnModifiers<TConfig, PgBigIntColumn>
  : TConfig extends { mode: "smallint" }
    ? InferColumnModifiers<TConfig, PgSmallIntColumn>
    : TConfig extends { mode: "real" }
      ? InferColumnModifiers<TConfig, PgRealColumn>
      : TConfig extends { mode: "double" }
        ? InferColumnModifiers<TConfig, PgDoublePrecisionColumn>
        : TConfig extends { mode: "decimal" }
          ? InferColumnModifiers<TConfig, PgNumericColumn>
          : InferColumnModifiers<TConfig, PgIntegerColumn>; // default

/**
 * Apply notNull and hasDefault modifiers.
 */
type InferColumnModifiers<TConfig, TBaseColumn> = TConfig extends {
  required: true;
}
  ? TConfig extends { default: any }
    ? TBaseColumn & { notNull: true; hasDefault: true }
    : TBaseColumn & { notNull: true; hasDefault: false }
  : TConfig extends { default: any }
    ? TBaseColumn & { notNull: false; hasDefault: true }
    : TBaseColumn & { notNull: false; hasDefault: false };
```

## Input Type Inference (TInput)

Input type is what you provide when creating/updating:

```typescript
/**
 * Infer input type based on config.
 *
 * Rules:
 * 1. input: false → never (field excluded from input)
 * 2. input: 'optional' → TValue | undefined (can omit, can't set null)
 * 3. required: true + no default → TValue (required)
 * 4. required: true + default → TValue | undefined (optional, DB provides default)
 * 5. required: false → TValue | null | undefined (optional, nullable)
 *
 * Note: TValue is already conditional based on mode/multiple!
 */
type InferInputType<TConfig, TValue> =
  TConfig extends { input: false }
    ? never
    : TConfig extends { input: "optional" }
      ? TValue | undefined  // Can omit, but can't set null (NOT NULL in DB)
      : TConfig extends { required: true }
        ? TConfig extends { default: any }
          ? TValue | undefined
          : TValue
        : TValue | null | undefined;

/**
 * Examples with full inference chain:
 */
f.number({ mode: "bigint", required: true })
// TValue = bigint, TInput = bigint

f.number({ mode: "bigint", required: true, default: 0n })
// TValue = bigint, TInput = bigint | undefined

f.number({ mode: "bigint" })
// TValue = bigint, TInput = bigint | null | undefined

f.select({ options: [...], multiple: true, required: true })
// TValue = string[], TInput = string[]

// NEW: input: 'optional' - slug pattern
f.text({ required: true, input: "optional" })
// TValue = string, TInput = string | undefined (can omit, computed if missing)
// TOutput = string (always present, NOT NULL)
```

## Output Type Inference (TOutput)

Output type is what you get when reading:

```typescript
/**
 * Infer output type based on config.
 *
 * Rules:
 * 1. output: false → never (field excluded from output)
 * 2. required: true → TValue (never null)
 * 3. required: false → TValue | null (nullable)
 */
type InferOutputType<TConfig, TValue> = TConfig extends { output: false }
  ? never
  : TConfig extends { required: true }
    ? TValue
    : TValue | null;

/**
 * Examples:
 */
f.text({ required: true });
// TOutput = string

f.text({});
// TOutput = string | null

f.text({ required: true, output: false });
// TOutput = never (excluded from select)
```

## Complete Field Factory Definition

```typescript
/**
 * Define a field type with full conditional type inference.
 *
 * Type parameters:
 * @param TType - Field type identifier ("text", "number", etc.)
 * @param TConfigBase - Base config interface for this field type
 * @param TValueMap - Mapping from config to value type (for mode/multiple)
 * @param TColumnMap - Mapping from config to column type (for mode)
 */
function field<
  TType extends string,
  TConfigBase extends object,
  TValueMap extends ConfigToValueMap,
  TColumnMap extends ConfigToColumnMap,
>(
  type: TType,
  implementation: FieldImplementation<TType, TConfigBase>,
): FieldFactory<TType, TConfigBase, TValueMap, TColumnMap> {
  return <TConfig extends TConfigBase & BaseFieldConfig>(config: TConfig) => {
    // Infer types based on config
    type TValue = InferValueFromMap<TConfig, TValueMap>;
    type TColumn = InferColumnFromMap<TConfig, TColumnMap>;
    type TInput = InferInputType<TConfig, TValue>;
    type TOutput = InferOutputType<TConfig, TValue>;

    return {
      type,
      config,
      $types: {} as {
        value: TValue;
        input: TInput;
        output: TOutput;
        column: TColumn;
      },
      ...bindImplementation(implementation, config),
    } as FieldDefinition<TType, TConfig, TValue, TInput, TOutput, TColumn>;
  };
}

/**
 * Mapping types for conditional inference.
 */
type ConfigToValueMap = {
  default: unknown;
  [configPattern: string]: unknown;
};

type ConfigToColumnMap = {
  default: AnyPgColumn;
  [configPattern: string]: AnyPgColumn;
};
```

## Built-in Field Type Definitions

### Text Field

```typescript
const textFieldFactory = field<
  "text",
  TextFieldConfig,
  // Value map: mode → value type
  {
    default: string; // varchar and text both return string
  },
  // Column map: mode → column type
  {
    text: PgTextColumn;
    varchar: PgVarcharColumn;
    default: PgVarcharColumn;
  }
>("text", textFieldImplementation);

// Usage & inferred types:
f.text({ required: true });
// FieldDefinition<"text", { required: true }, string, string, string, PgVarcharColumn<notNull>>

f.text({ mode: "text", required: true });
// FieldDefinition<"text", { mode: "text", required: true }, string, string, string, PgTextColumn<notNull>>
```

### Number Field

```typescript
const numberFieldFactory = field<
  "number",
  NumberFieldConfig,
  // Value map: mode → value type
  {
    bigint: bigint;
    default: number; // integer, smallint, real, double, decimal all use number
  },
  // Column map: mode → column type
  {
    integer: PgIntegerColumn;
    smallint: PgSmallIntColumn;
    bigint: PgBigIntColumn;
    real: PgRealColumn;
    double: PgDoublePrecisionColumn;
    decimal: PgNumericColumn;
    default: PgIntegerColumn;
  }
>("number", numberFieldImplementation);

// Usage & inferred types:
f.number({ required: true });
// TValue = number, TColumn = PgIntegerColumn<notNull>

f.number({ mode: "bigint", required: true });
// TValue = bigint, TColumn = PgBigIntColumn<notNull>

f.number({ mode: "decimal", precision: 10, scale: 2 });
// TValue = number, TColumn = PgNumericColumn<nullable>
```

### Select Field

```typescript
const selectFieldFactory = field<
  "select",
  SelectFieldConfig,
  // Value map: multiple → value type
  {
    multiple: string[];
    default: string;
  },
  // Column map: multiple/enumType → column type
  {
    multiple: PgArrayColumn<PgVarcharColumn>;
    enumType: PgEnumColumn;
    default: PgVarcharColumn;
  }
>("select", selectFieldImplementation);

// Usage & inferred types:
f.select({ options: [...], required: true })
// TValue = string, TColumn = PgVarcharColumn<notNull>

f.select({ options: [...], multiple: true })
// TValue = string[], TColumn = PgArrayColumn<PgVarcharColumn>

f.select({ options: [...], enumType: true, enumName: "status" })
// TValue = string, TColumn = PgEnumColumn
```

## Collection Type Inference

```typescript
/**
 * Collection with fully inferred types from fields.
 */
interface Collection<TFields extends FieldsRecord> {
  readonly name: string;
  readonly fields: TFields;
  readonly table: InferTable<TFields>;
  readonly $infer: {
    select: InferSelect<TFields>;
    insert: InferInsert<TFields>;
    update: InferUpdate<TFields>;
    fields: keyof TFields;
  };
}

/**
 * Infer Drizzle table columns from fields.
 * Excludes fields that don't create columns (hasMany, manyToMany).
 */
type InferTable<TFields extends FieldsRecord> = PgTableWithColumns<{
  name: string;
  schema: undefined;
  columns: {
    [K in keyof TFields as TFields[K]["$types"]["column"] extends null
      ? never
      : K]: TFields[K]["$types"]["column"];
  };
}>;

/**
 * Infer SELECT result type.
 * Excludes fields with output: false.
 */
type InferSelect<TFields extends FieldsRecord> = {
  [K in keyof TFields as TFields[K]["$types"]["output"] extends never
    ? never
    : K]: TFields[K]["$types"]["output"];
};

/**
 * Infer INSERT input type.
 * Excludes fields with input: false.
 * Separates required vs optional fields.
 */
type InferInsert<TFields extends FieldsRecord> =
  // Required fields (required: true, no default)
  {
    [K in keyof TFields as IsRequiredInput<TFields[K]> extends true
      ? K
      : never]: NonNullable<TFields[K]["$types"]["input"]>;
  } & {
    // Optional fields (has default OR not required)
    [K in keyof TFields as IsRequiredInput<TFields[K]> extends true
      ? never
      : TFields[K]["$types"]["input"] extends never
        ? never
        : K]?: TFields[K]["$types"]["input"];
  };

type IsRequiredInput<TField extends FieldDefinition<any, any, any>> =
  TField["config"] extends { input: false }
    ? false
    : TField["config"] extends { required: true; default?: undefined }
      ? true
      : false;

/**
 * Infer UPDATE input type.
 * All fields optional (partial update).
 */
type InferUpdate<TFields extends FieldsRecord> = {
  [K in keyof TFields as TFields[K]["$types"]["input"] extends never
    ? never
    : K]?: TFields[K]["$types"]["input"];
};
```

## Complete Example with Type Flow

```typescript
const posts = q.collection("posts").fields((f) => ({
  // Required text, varchar column
  id: f.text({ required: true, default: () => crypto.randomUUID() }),
  // → TValue: string
  // → TInput: string | undefined (has default)
  // → TOutput: string
  // → TColumn: PgVarcharColumn<{ notNull: true, hasDefault: true }>

  title: f.text({ required: true, maxLength: 255 }),
  // → TValue: string
  // → TInput: string (required, no default)
  // → TOutput: string
  // → TColumn: PgVarcharColumn<{ notNull: true, hasDefault: false }>

  // Bigint for large counters
  viewCount: f.number({ mode: "bigint", default: 0n, input: false }),
  // → TValue: bigint
  // → TInput: never (input: false)
  // → TOutput: bigint
  // → TColumn: PgBigIntColumn<{ notNull: false, hasDefault: true }>

  // Multi-select tags stored as array
  tags: f.select({
    options: [
      { value: "tech", label: "Tech" },
      { value: "news", label: "News" },
    ],
    multiple: true,
  }),
  // → TValue: string[]
  // → TInput: string[] | null | undefined
  // → TOutput: string[] | null
  // → TColumn: PgArrayColumn<PgVarcharColumn>

  // Write-only password hash
  passwordHash: f.text({ required: true, output: false }),
  // → TValue: string
  // → TInput: string
  // → TOutput: never (excluded)
  // → TColumn: PgVarcharColumn<{ notNull: true }>
}));

// Fully inferred types
type PostSelect = typeof posts.$infer.select;
// {
//   id: string;
//   title: string;
//   viewCount: bigint;
//   tags: string[] | null;
//   // passwordHash NOT included
// }

type PostInsert = typeof posts.$infer.insert;
// {
//   title: string;              // Required (no default)
//   passwordHash: string;       // Required (no default)
//   id?: string;                // Optional (has default)
//   tags?: string[] | null;     // Optional
//   // viewCount NOT included (input: false)
// }
```

## Collection Type Inference

```typescript
/**
 * Collection with fully inferred types.
 */
interface Collection<
  TFields extends Record<string, FieldDefinition<any, any, any>>,
> {
  readonly name: string;
  readonly fields: TFields;

  /** Drizzle table with inferred column types */
  readonly table: InferTable<TFields>;

  /** Type inference helpers */
  readonly $infer: {
    /** Type for SELECT queries */
    select: InferSelect<TFields>;

    /** Type for INSERT (create) */
    insert: InferInsert<TFields>;

    /** Type for UPDATE */
    update: InferUpdate<TFields>;

    /** Field keys */
    fields: keyof TFields;
  };
}

/**
 * Infer Drizzle table type from fields.
 */
type InferTable<TFields> = PgTableWithColumns<{
  name: string;
  schema: undefined;
  columns: {
    [K in keyof TFields]: TFields[K]["$types"]["column"];
  };
}>;

/**
 * Infer SELECT result type.
 * Only includes fields with output: true (default).
 */
type InferSelect<TFields> = {
  [K in keyof TFields as TFields[K]["$types"]["output"] extends never
    ? never
    : K]: TFields[K]["$types"]["output"];
};

/**
 * Infer INSERT input type.
 * Only includes fields with input: true (default).
 * Respects required/optional based on config.
 */
type InferInsert<TFields> = {
  // Required fields (no default, required: true)
  [K in keyof TFields as TFields[K]["$types"]["input"] extends never
    ? never
    : TFields[K]["config"] extends { required: true; default?: undefined }
      ? K
      : never]: TFields[K]["$types"]["input"];
} & {
  // Optional fields (has default or not required)
  [K in keyof TFields as TFields[K]["$types"]["input"] extends never
    ? never
    : TFields[K]["config"] extends { required: true; default?: undefined }
      ? never
      : K]?: TFields[K]["$types"]["input"];
};

/**
 * Infer UPDATE input type.
 * All fields are optional (partial update).
 */
type InferUpdate<TFields> = {
  [K in keyof TFields as TFields[K]["$types"]["input"] extends never
    ? never
    : K]?: TFields[K]["$types"]["input"];
};
```

### Usage Example

```typescript
const posts = q.collection("posts").fields((f) => ({
  id: f.text({ required: true, default: () => crypto.randomUUID() }),
  title: f.text({ required: true, maxLength: 255 }),
  slug: f.text({ required: true, unique: true }),
  content: f.richText({}),
  views: f.number({ default: 0, input: false }), // Read-only
  password: f.text({ output: false }), // Write-only
  published: f.boolean({ default: false }),
  authorId: f.text({ required: true }),
}));

// Inferred types
type PostSelect = typeof posts.$infer.select;
// {
//   id: string;
//   title: string;
//   slug: string;
//   content: RichTextDoc | null;
//   views: number;
//   // password NOT included (output: false)
//   published: boolean;
//   authorId: string;
// }

type PostInsert = typeof posts.$infer.insert;
// {
//   title: string;          // Required
//   slug: string;           // Required
//   authorId: string;       // Required
//   id?: string;            // Optional (has default)
//   content?: RichTextDoc | null;  // Optional
//   // views NOT included (input: false)
//   password?: string;      // Optional
//   published?: boolean;    // Optional (has default)
// }

type PostUpdate = typeof posts.$infer.update;
// {
//   title?: string;
//   slug?: string;
//   content?: RichTextDoc | null;
//   // views NOT included (input: false)
//   password?: string;
//   published?: boolean;
//   authorId?: string;
// }

// Table type matches Drizzle expectations
const table = posts.table;
// PgTableWithColumns<{
//   columns: {
//     id: PgColumn<{ data: string; notNull: true; hasDefault: true }>;
//     title: PgColumn<{ data: string; notNull: true; hasDefault: false }>;
//     ...
//   }
// }>
```

## Typesafe Column Building

The `toColumn` method must return properly typed Drizzle columns based on config:

```typescript
// packages/questpie/src/server/fields/builtin/text.ts

const textField = field("text", {
  toColumn<TConfig extends TextFieldConfig>(
    name: string,
    config: TConfig,
  ): InferTextColumn<TConfig> {
    const { mode = "varchar", maxLength = 255 } = config;

    // Start with base column
    let column =
      mode === "text" ? text(name) : varchar(name, { length: maxLength });

    // Apply modifiers - each changes the type!
    if (config.required) {
      column = column.notNull();
      // Type is now: PgColumn<{ notNull: true, ... }>
    }

    if (config.default !== undefined) {
      column = column.default(config.default);
      // Type is now: PgColumn<{ hasDefault: true, ... }>
    }

    return column as InferTextColumn<TConfig>;
  },
});

// Type helper for text column inference
type InferTextColumn<TConfig> = TConfig extends { required: true }
  ? TConfig extends { default: any }
    ? PgVarcharColumn<{ notNull: true; hasDefault: true }>
    : PgVarcharColumn<{ notNull: true; hasDefault: false }>
  : TConfig extends { default: any }
    ? PgVarcharColumn<{ notNull: false; hasDefault: true }>
    : PgVarcharColumn<{ notNull: false; hasDefault: false }>;
```

## Access Control Type Inference

Field-level access control affects output types at compile time:

```typescript
/**
 * Access control type inference.
 *
 * Key principle: If access.read is a function (not just `true`),
 * the output type becomes optional because the field might be
 * filtered at runtime based on the function result.
 */

// Helper type: Does config have access.read as function?
type HasAccessFunction<TConfig> = TConfig extends {
  access: { read: (...args: any[]) => any };
}
  ? true
  : false;

/**
 * Infer output type with access control.
 *
 * Rules:
 * 1. output: false → never
 * 2. access.read is function → TValue | undefined (might be filtered)
 * 3. required: true → TValue
 * 4. required: false → TValue | null
 */
type InferOutputWithAccess<TConfig, TValue> = TConfig extends { output: false }
  ? never
  : HasAccessFunction<TConfig> extends true
    ? (TConfig extends { required: true } ? TValue : TValue | null) | undefined
    : TConfig extends { required: true }
      ? TValue
      : TValue | null;

/**
 * Examples:
 */
// No access control - standard output
f.text({ required: true });
// → TOutput = string

// Access control with `true` - always allowed, no type change
f.text({
  required: true,
  access: { read: true, update: true },
});
// → TOutput = string

// Access control with function - might be filtered
f.text({
  required: true,
  access: {
    read: ({ user }) => user?.role === "admin",
  },
});
// → TOutput = string | undefined

// Nullable field with access function
f.text({
  access: {
    read: ({ user, doc }) => user?.id === doc?.ownerId,
  },
});
// → TOutput = string | null | undefined

// access.create/update don't affect output, only input
f.text({
  required: true,
  access: {
    create: false,
    update: false,
  },
});
// → TInput = never (can't write via API)
// → TOutput = string (normal output)

/**
 * Input type with access control.
 *
 * Rules:
 * 1. access.create: false → excluded from create input
 * 2. access.update: false → excluded from update input
 * 3. access.create/update: function → included but enforced at runtime
 */
type InferInputWithAccess<
  TConfig,
  TValue,
  TOperation extends "create" | "update",
> = TConfig extends { access: { [K in TOperation]: false } }
  ? never
  : InferInputType<TConfig, TValue>;
```

## Virtual Field Type Inference

Virtual fields have special type behavior:

```typescript
/**
 * Virtual field type inference.
 *
 * Key principle: Virtual fields have no DB column.
 * - TInput = never by default (unless input: true for setter pattern)
 * - TOutput = TValue (computed on read)
 * - TColumn = null (no DB column)
 */

// Helper type: Is field virtual?
type IsVirtual<TConfig> = TConfig extends { virtual: true | SQL<any> }
  ? true
  : false;

/**
 * Infer input type for virtual fields.
 *
 * Rules:
 * 1. virtual: true/SQL + input: true → TValue | undefined (setter pattern)
 * 2. virtual: true/SQL + input not true → never (no input)
 * 3. non-virtual → normal input inference
 */
type InferVirtualInput<TConfig, TValue> =
  IsVirtual<TConfig> extends true
    ? TConfig extends { input: true }
      ? TValue | undefined
      : never
    : InferInputType<TConfig, TValue>;

/**
 * Infer column type for virtual fields.
 *
 * Virtual fields don't create DB columns.
 */
type InferVirtualColumn<TConfig, TColumn> =
  IsVirtual<TConfig> extends true ? null : TColumn;

/**
 * Examples:
 */
// Virtual with afterRead hook - computed from other fields
f.text({
  virtual: true,
  hooks: {
    afterRead: (_, { doc }) => `${doc.firstName} ${doc.lastName}`,
  },
});
// → TValue = string
// → TInput = never (can't set via input)
// → TOutput = string
// → TColumn = null

// Virtual with SQL expression - DB-computed aggregate
f.number({
  virtual: sql<number>`(SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id)`,
});
// → TValue = number
// → TInput = never
// → TOutput = number
// → TColumn = null (added to SELECT, not stored)

// Virtual with setter - allows input to update underlying fields
f.text({
  virtual: true,
  input: true, // Enable setter pattern
  hooks: {
    afterRead: (_, { doc }) => `${doc.firstName} ${doc.lastName}`,
    beforeChange: (value, { doc }) => {
      const [first, ...rest] = value.split(" ");
      doc.firstName = first;
      doc.lastName = rest.join(" ");
      return value;
    },
  },
});
// → TValue = string
// → TInput = string | undefined (setter enabled)
// → TOutput = string
// → TColumn = null

/**
 * Complete inference for virtual + access combined.
 */
f.number({
  virtual: sql<number>`(SELECT SUM(amount) FROM orders WHERE orders.user_id = users.id)`,
  access: {
    read: ({ user, doc }) => user?.id === doc?.id || user?.role === "admin",
  },
});
// → TValue = number
// → TInput = never (virtual)
// → TOutput = number | undefined (access function)
// → TColumn = null (virtual)
```

## Combined Type Inference Rules

Complete type inference considering all config options:

```typescript
/**
 * Master type inference combining all rules.
 */
type InferFieldTypes<TConfig, TBaseValue, TBaseColumn> = {
  value: InferValue<TConfig, TBaseValue>;
  input: InferInput<TConfig, InferValue<TConfig, TBaseValue>>;
  output: InferOutput<TConfig, InferValue<TConfig, TBaseValue>>;
  column: InferColumn<TConfig, TBaseColumn>;
};

/**
 * Value type inference (mode, multiple, etc.)
 */
type InferValue<TConfig, TBaseValue> = TBaseValue;
// Extended by each field type, e.g.:
// - NumberField: mode: "bigint" → bigint
// - SelectField: multiple: true → string[]

/**
 * Input type inference (virtual, required, default, access, input mode)
 */
type InferInput<TConfig, TValue> =
  // 1. Virtual fields: no input unless explicitly enabled
  TConfig extends { virtual: true | SQL<any> }
    ? TConfig extends { input: true }
      ? TValue | undefined
      : never
    : // 2. Input disabled
      TConfig extends { input: false }
      ? never
      : // 3. Input optional (slug pattern) - can omit, can't set null
        TConfig extends { input: "optional" }
        ? TValue | undefined
        : // 4. Access control blocks create/update
          TConfig extends { access: { create: false; update: false } }
          ? never
          : // 5. Required with no default = required in input
            TConfig extends { required: true }
            ? TConfig extends { default: any }
              ? TValue | undefined
              : TValue
            : // 6. Otherwise optional and nullable
                TValue | null | undefined;

/**
 * Output type inference (output, virtual, access, required)
 */
type InferOutput<TConfig, TValue> =
  // 1. Output disabled
  TConfig extends { output: false }
    ? never
    : // 2. Access read function = might be filtered
      TConfig extends { access: { read: (...args: any[]) => any } }
      ?
          | (TConfig extends { required: true } ? TValue : TValue | null)
          | undefined
      : // 3. Required = non-null
        TConfig extends { required: true }
        ? TValue
        : // 4. Otherwise nullable
          TValue | null;

/**
 * Column type inference (virtual, required, default)
 */
type InferColumn<TConfig, TBaseColumn> =
  // 1. Virtual = no column
  TConfig extends { virtual: true | SQL<any> }
    ? null
    : // 2. Apply notNull/hasDefault modifiers
      TConfig extends { required: true }
      ? TConfig extends { default: any }
        ? TBaseColumn & { notNull: true; hasDefault: true }
        : TBaseColumn & { notNull: true; hasDefault: false }
      : TConfig extends { default: any }
        ? TBaseColumn & { notNull: false; hasDefault: true }
        : TBaseColumn & { notNull: false; hasDefault: false };

/**
 * Complete example with all features:
 */
const users = q.collection("users").fields((f) => ({
  // Standard required
  id: f.text({ required: true, default: () => crypto.randomUUID() }),
  // → TInput: string | undefined, TOutput: string, TColumn: PgVarchar<notNull, hasDefault>

  // With access control (read function)
  email: f.email({
    required: true,
    access: {
      read: ({ user, doc }) => user?.id === doc?.id,
    },
  }),
  // → TInput: string, TOutput: string | undefined, TColumn: PgVarchar<notNull>

  // Virtual computed
  fullName: f.text({
    virtual: true,
    hooks: { afterRead: (_, { doc }) => `${doc.firstName} ${doc.lastName}` },
  }),
  // → TInput: never, TOutput: string, TColumn: null

  // Virtual SQL aggregate
  orderCount: f.number({
    virtual: sql<number>`(SELECT COUNT(*) FROM orders WHERE user_id = users.id)`,
  }),
  // → TInput: never, TOutput: number, TColumn: null

  // Read-only (input: false)
  createdAt: f.datetime({
    required: true,
    default: () => new Date(),
    input: false,
  }),
  // → TInput: never, TOutput: Date, TColumn: PgTimestamp<notNull, hasDefault>

  // Write-only (output: false)
  password: f.text({
    required: true,
    output: false,
    hooks: { beforeChange: (v) => bcrypt.hashSync(v, 10) },
  }),
  // → TInput: string, TOutput: never, TColumn: PgVarchar<notNull>

  // Optional input, required output (slug pattern)
  username: f.text({
    required: true,
    input: "optional",
    unique: true,
    hooks: {
      beforeCreate: (value, { doc }) =>
        value ?? doc.email.split("@")[0].toLowerCase(),
    },
  }),
  // → TInput: string | undefined (can omit, can't set null)
  // → TOutput: string (always present, NOT NULL)
  // → TColumn: PgVarchar<notNull>
}));

// Resulting types:
type UserSelect = typeof users.$infer.select;
// {
//   id: string;
//   email: string | undefined;  // access.read is function
//   fullName: string;
//   orderCount: number;
//   createdAt: Date;
//   username: string;           // always present
//   // password excluded (output: false)
// }

type UserInsert = typeof users.$infer.insert;
// {
//   email: string;             // required
//   password: string;          // required
//   id?: string;               // optional (has default)
//   username?: string;         // optional (input: 'optional', computed if missing)
//   // fullName excluded (virtual)
//   // orderCount excluded (virtual)
//   // createdAt excluded (input: false)
// }
```

## Input/Output Field Modes

```typescript
interface BaseFieldConfig {
  /**
   * Input behavior for create/update operations.
   *
   * - `true` (default): Included in input, follows `required` for validation
   * - `false`: Excluded from input entirely (TInput = never)
   * - `'optional'`: Included but always optional (TInput = T | undefined)
   *
   * Use `'optional'` for fields that are:
   * - Required at DB level (NOT NULL)
   * - But can be omitted in input (computed via hooks if not provided)
   */
  input?: boolean | "optional";

  /**
   * Include field in select output.
   * Set to false for write-only fields (passwords, tokens).
   * @default true
   */
  output?: boolean;

  /**
   * Field is required in DB (NOT NULL constraint).
   * Combined with `input`, determines input validation:
   * - required: true + input: true → must provide
   * - required: true + input: 'optional' → can omit (computed if missing)
   * - required: true + input: false → can't provide (always computed)
   */
  required?: boolean;

  /**
   * Default value.
   * Makes field optional in input even if required.
   */
  default?: unknown | (() => unknown);

  /**
   * Field can be null.
   * @default !required
   */
  nullable?: boolean;
}
```

## The Four Input Patterns

| Pattern               | `required` | `input`      | TInput                   | TOutput     | Use Case                               |
| --------------------- | ---------- | ------------ | ------------------------ | ----------- | -------------------------------------- |
| **Required**          | `true`     | `true`       | `T`                      | `T`         | Standard required field                |
| **Optional**          | `false`    | `true`       | `T \| null \| undefined` | `T \| null` | Nullable optional field                |
| **Excluded**          | `true`     | `false`      | `never`                  | `T`         | Always computed, user can't set        |
| **Optional Non-null** | `true`     | `'optional'` | `T \| undefined`         | `T`         | Computed if missing, user can override |

```typescript
// Examples
const fields = {
  // Pattern 1: Standard required - user must provide
  title: f.text({ required: true }),
  // TInput = string, TOutput = string

  // Pattern 2: Optional nullable - user may provide or set null
  bio: f.text({}),
  // TInput = string | null | undefined, TOutput = string | null

  // Pattern 3: Excluded - always computed, user can't set
  wordCount: f.number({
    required: true,
    input: false,
    hooks: {
      beforeChange: (_, { doc }) => countWords(doc.content),
    },
  }),
  // TInput = never, TOutput = number

  // Pattern 4: Optional non-null - computed if not provided (SLUG PATTERN)
  slug: f.text({
    required: true,
    input: "optional",
    unique: true,
    hooks: {
      beforeCreate: (value, { doc }) => value ?? slugify(doc.title),
    },
  }),
  // TInput = string | undefined (can omit, can't set null)
  // TOutput = string (always present)

  // Standard optional with default
  status: f.select({
    options: [...],
    default: "draft"
  }),
  // Input: string | undefined (optional), Output: string

  // Read-only computed field
  viewCount: f.number({
    default: 0,
    input: false
  }),
  // Input: never (not in input), Output: number

  // Write-only secret field
  apiToken: f.text({
    required: true,
    output: false
  }),
  // Input: string (required), Output: never (not in output)

  // Nullable optional field
  bio: f.textarea({
    nullable: true
  }),
  // Input: string | null | undefined, Output: string | null
};

// Helper: slugify function for slug pattern
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-")     // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "")         // Trim hyphens from start/end
    .replace(/-+/g, "-");            // Collapse multiple hyphens
}
```

> **Note:** There's no dedicated `slugField` - use `f.text()` with `input: 'optional'` and a `beforeCreate` hook instead. This is more flexible and explicit about the behavior.

---

# Relation Tables & Auto-Generation

## BelongsTo Relations

BelongsTo creates a FK column on the current table:

```typescript
// Field definition
author: f.relation("users", {
  type: "belongsTo",
  required: true,
});

// Generated column
authorId: varchar("author_id", { length: 36 })
  .notNull()
  .references(() => users.table.id, { onDelete: "cascade" });

// Type inference
// Input: string (ID) | { connect: { id: string } } | { create: {...} }
// Output: Related record (when included in 'with')
```

## HasMany Relations

HasMany doesn't create columns on the parent table - the FK is on the child:

```typescript
// On posts collection
comments: f.relation("comments", {
  type: "hasMany",
  foreignKey: "postId", // FK column on comments table
});

// Generated: nothing on posts table
// The comments collection must have:
postId: f.relation("posts", { type: "belongsTo" });

// Type inference
// Input: { connect: [...], create: [...], disconnect: [...] }
// Output: Array of related records (when included in 'with')
```

## ManyToMany Relations - Junction Table

ManyToMany requires a junction table. Options for handling:

### Option A: Explicit Junction Table (Recommended)

User creates a junction collection manually:

```typescript
// Junction collection
const postTags = q
  .collection("postTags")
  .fields((f) => ({
    postId: f.relation("posts", { type: "belongsTo", required: true }),
    tagId: f.relation("tags", { type: "belongsTo", required: true }),
    // Can add extra fields like 'order', 'createdAt'
    order: f.number({ default: 0 }),
  }))
  .indexes(({ table }) => ({
    pk: primaryKey({ columns: [table.postId, table.tagId] }),
  }));

// Usage in posts collection
tags: f.relation("tags", {
  type: "manyToMany",
  through: "postTags",
  sourceField: "postId",
  targetField: "tagId",
});
```

### Option B: Auto-Generated Junction Table

For simple M2M without extra fields, auto-generate:

```typescript
// Auto-generate mode
tags: f.relation("tags", {
  type: "manyToMany",
  through: true, // Auto-generate junction table
});

// Generated junction table: posts_tags
// Columns: post_id, tag_id
// Primary key: (post_id, tag_id)
// Indexes: post_id, tag_id
```

### Junction Table Generation Logic

```typescript
interface ManyToManyConfig {
  type: "manyToMany";

  /**
   * Junction table name or true for auto-generate.
   * Auto-generated name: {source}_{target} (alphabetical order)
   */
  through: string | true;

  /**
   * Source FK field in junction table.
   * @default {sourceCollection}Id
   */
  sourceField?: string;

  /**
   * Target FK field in junction table.
   * @default {targetCollection}Id
   */
  targetField?: string;

  /**
   * Auto-generate junction table if not exists.
   * @default true when through is string
   */
  autoCreateJunction?: boolean;
}

// In collection builder
function processM2MRelation(
  sourceName: string,
  targetName: string,
  config: ManyToManyConfig,
  registry: CollectionRegistry,
): void {
  const throughName =
    config.through === true
      ? [sourceName, targetName].sort().join("_")
      : config.through;

  // Check if junction exists
  if (!registry.has(throughName)) {
    if (config.autoCreateJunction !== false) {
      // Auto-generate junction collection
      const junction = q
        .collection(throughName)
        .fields((f) => ({
          [config.sourceField ?? `${sourceName}Id`]: f.relation(sourceName, {
            type: "belongsTo",
            required: true,
            onDelete: "cascade",
          }),
          [config.targetField ?? `${targetName}Id`]: f.relation(targetName, {
            type: "belongsTo",
            required: true,
            onDelete: "cascade",
          }),
        }))
        .indexes(({ table }) => ({
          pk: primaryKey({
            columns: [
              table[config.sourceField ?? `${sourceName}Id`],
              table[config.targetField ?? `${targetName}Id`],
            ],
          }),
        }))
        .options({
          timestamps: false,
          softDelete: false,
        });

      registry.register(throughName, junction);
    } else {
      throw new Error(`Junction table '${throughName}' not found`);
    }
  }
}
```

## Polymorphic Relations

Polymorphic relations create 2 columns (type + id), no separate table:

```typescript
// Field definition
commentable: f.polymorphicRelation({
  types: ["posts", "pages", "products"],
  label: "Commentable",
})

// Generated columns
commentable_type: varchar("commentable_type", { length: 100 }).notNull()
commentable_id: varchar("commentable_id", { length: 36 }).notNull()

// Index for performance
CREATE INDEX idx_comments_commentable
  ON comments(commentable_type, commentable_id);
```

### Polymorphic Type Inference

```typescript
interface PolymorphicRelationConfig {
  types: readonly string[];
  typeField?: string;
  idField?: string;
}

// Type inference for polymorphic
type InferPolymorphicOutput<TTypes extends readonly string[]> = {
  [K in TTypes[number]]: {
    type: K;
    id: string;
    record?: InferCollectionSelect<K>; // When loaded with 'with'
  };
}[TTypes[number]];

// Usage
commentable: f.polymorphicRelation({
  types: ["posts", "pages"] as const,
});

// Output type:
// { type: "posts"; id: string; record?: PostSelect }
// | { type: "pages"; id: string; record?: PageSelect }
```

### Polymorphic Query Operators

```typescript
// Query posts that are commentable
const postsComments = await comments.find({
  where: {
    commentable: {
      typeIs: "posts",
      has: { status: "published" }, // Filter on the related post
    },
  },
  with: {
    commentable: true, // Load the actual post/page/product
  },
});
```

## Complete Relation Type Summary

| Relation Type | Columns Created         | Junction Table         | Input Type                                              | Output Type         |
| ------------- | ----------------------- | ---------------------- | ------------------------------------------------------- | ------------------- |
| belongsTo     | FK column on this table | No                     | `ID \| { connect } \| { create }`                       | Related record      |
| hasMany       | None (FK on related)    | No                     | `{ connect, create, disconnect }`                       | Array of records    |
| manyToMany    | None                    | Yes (explicit or auto) | `{ connect, create, disconnect, set }`                  | Array of records    |
| polymorphic   | Type + ID columns       | No                     | `{ type, id } \| { type, connect } \| { type, create }` | Discriminated union |

---

# Migration Guide

## From Current to New API

### Step 1: Update CMS Initialization

```typescript
// Before
import { q } from "questpie";

const cms = q.config({...});

// After
import { q, builtinFields } from "questpie";

const cms = q()
  .use(builtinFields)
  .config({...});
```

### Step 2: Migrate Collection Fields

```typescript
// Before
import { varchar, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

const posts = q
  .collection("posts")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    content: jsonb("content"),
    published: boolean("published").default(false),
  })
  .localized(["content"])
  .relations(({ one, manyToMany, table }) => ({
    author: one("users", {
      fields: [table.authorId],
      references: ["id"],
    }),
    tags: manyToMany("tags", {
      through: "postTags",
      sourceField: "postId",
      targetField: "tagId",
    }),
  }));

// After
const posts = q.collection("posts").fields((f) => ({
  title: f.text({
    label: "Title",
    required: true,
    maxLength: 255,
  }),
  content: f.richText({
    label: "Content",
    localized: true,
  }),
  published: f.boolean({
    label: "Published",
    default: false,
  }),
  // Inline relations
  author: f.relation("users", {
    type: "belongsTo",
    label: "Author",
    required: true,
  }),
  tags: f.relation("tags", {
    type: "manyToMany",
    through: "postTags",
    label: "Tags",
  }),
}));
```

### Step 3: Simplify Admin Config

```typescript
// Before (verbose)
const postsAdmin = builder.collection("posts")
  .meta({ label: "Posts", icon: ArticleIcon })
  .fields(({ r }) => ({
    title: r.text({ label: "Title", required: true }),
    content: r.richText({ label: "Content" }),
    published: r.switch({ label: "Published" }),
    author: r.relation({ targetCollection: "users", label: "Author" }),
    tags: r.relation({ targetCollection: "tags", type: "multiple" }),
  }))
  .list(({ v, f }) => v.table({...}))
  .form(({ v, f }) => v.form({...}));

// After (minimal)
const postsAdmin = builder.collection("posts")
  .meta({ icon: ArticleIcon }) // Label from BE
  .list(({ v, f }) => v.table({
    columns: [f.title, f.author, f.published],
  }));
// .fields() not needed - auto-generated from BE!
```

### Step 4: Enable Auto-Registration (Optional)

```typescript
// Ultra-minimal for simple collections
const admin = qa<AppCMS>().use(coreAdminModule).autoRegister(); // All collections auto-configured!

// With selective overrides
const admin = qa<AppCMS>()
  .use(coreAdminModule)
  .autoRegister()
  .collection("posts", (cfg) =>
    cfg.meta({ icon: ArticleIcon }).list(({ v, f }) =>
      v.table({
        columns: [f.title, f.author, f.createdAt],
      }),
    ),
  );
```

---

# Migration Guide

> **Goal:** Systematicky migrovať existujúce kolekcie z raw Drizzle na Field Builder
> bez prerušenia funkcionality a s postupným prechodom.

## Migračná stratégia

### Princípy

1. **Backward compatible** - Field builder generuje rovnaké Drizzle columns
2. **Incremental migration** - kolekcie sa môžu migrovať postupne
3. **No schema changes** - DB schéma zostáva identická
4. **Tests must pass** - každá migrácia musí zachovať existujúce testy

### Fázy migrácie

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1: Infrastructure (1 week)                                        │
│  - Implement core field system                                           │
│  - Both syntaxes work simultaneously                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 2: Pilot Migration (1 collection)                                 │
│  - Pick simple collection (e.g., tags, categories)                       │
│  - Migrate + verify all tests pass                                       │
│  - Document issues and patterns                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 3: Bulk Migration (remaining collections)                         │
│  - Migrate collection by collection                                      │
│  - Run full test suite after each                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 4: Admin Migration                                                │
│  - Enable auto-registration                                              │
│  - Remove redundant admin field definitions                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Phase 5: Cleanup                                                        │
│  - Remove old syntax support (optional)                                  │
│  - Update documentation                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Collection Migration Checklist

Pre každú kolekciu:

```markdown
## Collection: [name]

### Pre-migration

- [ ] List all existing tests for this collection
- [ ] Document current Drizzle schema
- [ ] Note any custom query patterns

### Migration

- [ ] Convert `.fields({...})` to `.fields((f) => ({...}))`
- [ ] Convert each column to field builder equivalent
- [ ] Move `.relations()` into inline `f.relation()`
- [ ] Add labels/descriptions where missing

### Verification

- [ ] Run unit tests for this collection
- [ ] Run integration tests
- [ ] Verify generated Drizzle schema matches original
- [ ] Test CRUD operations manually
- [ ] Verify admin UI still works

### Post-migration

- [ ] Update admin config to use auto-generated fields
- [ ] Remove redundant admin field definitions
```

## Column to Field Mapping

| Drizzle Column                            | Field Builder                                     | Notes                |
| ----------------------------------------- | ------------------------------------------------- | -------------------- |
| `varchar(name, { length: N })`            | `f.text({ maxLength: N })`                        |                      |
| `varchar(name, { length: N }).notNull()`  | `f.text({ maxLength: N, required: true })`        |                      |
| `text(name)`                              | `f.text({ mode: "text" })`                        | Unlimited length     |
| `integer(name)`                           | `f.number()`                                      | Default mode         |
| `bigint(name, { mode: "number" })`        | `f.number({ mode: "bigint" })`                    |                      |
| `real(name)`                              | `f.number({ mode: "real" })`                      |                      |
| `numeric(name, { precision, scale })`     | `f.number({ mode: "decimal", precision, scale })` |                      |
| `boolean(name)`                           | `f.boolean()`                                     |                      |
| `timestamp(name)`                         | `f.datetime()`                                    |                      |
| `timestamp(name, { withTimezone: true })` | `f.datetime({ withTimezone: true })`              |                      |
| `date(name)`                              | `f.date()`                                        |                      |
| `time(name)`                              | `f.time()`                                        |                      |
| `jsonb(name)`                             | `f.json()` or `f.object({...})`                   | Use object for typed |
| `varchar(name).array()`                   | `f.select({ multiple: true })` or `f.array()`     |                      |

## Relation Migration

```typescript
// BEFORE: Separate .relations()
const posts = q
  .collection("posts")
  .fields({
    title: varchar("title", { length: 255 }).notNull(),
    authorId: uuid("author_id").notNull(),
  })
  .relations(({ one, manyToMany, table }) => ({
    author: one("users", {
      fields: [table.authorId],
      references: ["id"],
    }),
    tags: manyToMany("tags", {
      through: "postTags",
      fields: [table.id],
      references: ["postId"],
      targetFields: ["tagId"],
      targetReferences: ["id"],
    }),
  }));

// AFTER: Inline f.relation()
const posts = q.collection("posts").fields((f) => ({
  title: f.text({
    label: "Title",
    required: true,
    maxLength: 255,
  }),
  // authorId column is auto-created by belongsTo
  author: f.relation("users", {
    type: "belongsTo",
    label: "Author",
    required: true,
    // foreignKey defaults to "authorId"
  }),
  tags: f.relation("tags", {
    type: "manyToMany",
    through: "postTags",
    label: "Tags",
  }),
}));
```

## Handling Edge Cases

### Custom column names

```typescript
// BEFORE
const posts = q
  .collection("posts")
  .fields({
    created_by: uuid("created_by").notNull(),
  })
  .relations(({ one, table }) => ({
    creator: one("users", {
      fields: [table.created_by],
      references: ["id"],
    }),
  }));

// AFTER
const posts = q.collection("posts").fields((f) => ({
  creator: f.relation("users", {
    type: "belongsTo",
    foreignKey: "created_by", // Explicit FK column name
    required: true,
  }),
}));
```

### Computed/virtual columns

```typescript
// BEFORE: Generated column in Drizzle
const posts = q.collection("posts").fields({
  title: varchar("title", { length: 255 }).notNull(),
  // Manual subquery in select
});

// AFTER: Virtual field
const posts = q.collection("posts").fields((f) => ({
  title: f.text({ required: true, maxLength: 255 }),
  commentCount: f.number({
    virtual: sql<number>`(
      SELECT COUNT(*)::int FROM comments
      WHERE comments.post_id = posts.id
    )`,
  }),
}));
```

### Enum columns

```typescript
// BEFORE
const statusEnum = pgEnum("post_status", ["draft", "published", "archived"]);
const posts = q.collection("posts").fields({
  status: statusEnum("status").default("draft"),
});

// AFTER
const posts = q.collection("posts").fields((f) => ({
  status: f.select({
    options: [
      { value: "draft", label: "Draft" },
      { value: "published", label: "Published" },
      { value: "archived", label: "Archived" },
    ],
    default: "draft",
    enumType: true,
    enumName: "post_status", // Must match existing enum!
  }),
}));
```

## Verification Script

```typescript
// scripts/verify-migration.ts
import { sql } from "drizzle-orm";

/**
 * Verify that migrated collection produces identical schema.
 */
async function verifyCollectionMigration(
  collectionName: string,
  oldSchema: string,
  newSchema: string,
) {
  // Compare column definitions
  const oldColumns = parseSchema(oldSchema);
  const newColumns = parseSchema(newSchema);

  const differences: string[] = [];

  for (const [name, oldDef] of Object.entries(oldColumns)) {
    const newDef = newColumns[name];
    if (!newDef) {
      differences.push(`Missing column: ${name}`);
      continue;
    }
    if (oldDef.type !== newDef.type) {
      differences.push(
        `Type mismatch for ${name}: ${oldDef.type} → ${newDef.type}`,
      );
    }
    if (oldDef.nullable !== newDef.nullable) {
      differences.push(
        `Nullable mismatch for ${name}: ${oldDef.nullable} → ${newDef.nullable}`,
      );
    }
  }

  if (differences.length > 0) {
    console.error(`❌ ${collectionName} has schema differences:`);
    differences.forEach((d) => console.error(`   - ${d}`));
    return false;
  }

  console.log(`✅ ${collectionName} schema matches`);
  return true;
}
```

---

# Testing Strategy

> **Goal:** Zabezpečiť, že všetky existujúce testy fungujú počas a po migrácii.

## Princípy testovania

1. **Testy sa nemenia** - existujúce testy by mali prejsť bez úprav
2. **Pridávame nové testy** - pre field builder špecifickú funkcionalitu
3. **Schema parity** - generovaná schéma musí byť identická
4. **Runtime parity** - CRUD operácie musia fungovať rovnako

## Testovacia pyramída

```
                    ┌─────────────┐
                    │   E2E Tests │  ← Admin UI, API flows
                    │   (existujú)│
                   ─┴─────────────┴─
                  ┌─────────────────┐
                  │ Integration     │  ← Collection CRUD, relations
                  │ Tests (existujú)│
                 ─┴─────────────────┴─
                ┌───────────────────────┐
                │ Unit Tests            │  ← Field builders, operators
                │ (nové + existujúce)   │
               ─┴───────────────────────┴─
              ┌─────────────────────────────┐
              │ Schema Parity Tests (nové)  │  ← Verify identical schema
              └─────────────────────────────┘
```

## Nové test suites

### 1. Schema Parity Tests

```typescript
// packages/questpie/src/server/fields/__tests__/schema-parity.test.ts
import { describe, test, expect } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";

describe("Schema Parity", () => {
  describe("text field", () => {
    test("f.text() produces same schema as varchar()", () => {
      // Old way
      const oldColumn = varchar("title", { length: 255 }).notNull();

      // New way
      const field = f.text({ required: true, maxLength: 255 });
      const newColumn = field.toColumn("title");

      // Compare
      expect(getColumnDef(newColumn)).toEqual(getColumnDef(oldColumn));
    });

    test("f.text({ mode: 'text' }) produces same schema as text()", () => {
      const oldColumn = text("content");
      const field = f.text({ mode: "text" });
      const newColumn = field.toColumn("content");

      expect(getColumnDef(newColumn)).toEqual(getColumnDef(oldColumn));
    });
  });

  describe("number field", () => {
    test("f.number() produces same schema as integer()", () => {
      const oldColumn = integer("count").notNull();
      const field = f.number({ required: true });
      const newColumn = field.toColumn("count");

      expect(getColumnDef(newColumn)).toEqual(getColumnDef(oldColumn));
    });

    test("f.number({ mode: 'bigint' }) produces same schema as bigint()", () => {
      const oldColumn = bigint("id", { mode: "number" });
      const field = f.number({ mode: "bigint" });
      const newColumn = field.toColumn("id");

      expect(getColumnDef(newColumn)).toEqual(getColumnDef(oldColumn));
    });
  });

  describe("relation field", () => {
    test("belongsTo creates same FK column as manual uuid()", () => {
      const oldColumn = uuid("author_id").notNull();
      const field = f.relation("users", { type: "belongsTo", required: true });
      const newColumn = field.toColumn("author");

      // Should create authorId column
      expect(newColumn?.name).toBe("author_id");
      expect(getColumnDef(newColumn)).toEqual(getColumnDef(oldColumn));
    });
  });
});

// Helper to extract column definition for comparison
function getColumnDef(column: AnyPgColumn) {
  return {
    dataType: column.dataType,
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    // ... other relevant properties
  };
}
```

### 2. Operator Tests

```typescript
// packages/questpie/src/server/fields/__tests__/operators.test.ts
import { describe, test, expect } from "bun:test";

describe("Field Operators", () => {
  describe("text field operators", () => {
    const field = f.text({ required: true });
    const operators = field.getOperators(field.config);

    test("eq generates correct SQL", () => {
      const sql = operators.column.eq(mockColumn, "test", mockCtx);
      expect(sql.toString()).toContain("= 'test'");
    });

    test("contains generates ILIKE SQL", () => {
      const sql = operators.column.contains(mockColumn, "search", mockCtx);
      expect(sql.toString()).toContain("ILIKE '%search%'");
    });

    test("jsonb.eq generates correct path query", () => {
      const ctx = { ...mockCtx, jsonbPath: ["data", "title"] };
      const sql = operators.jsonb.eq(mockColumn, "test", ctx);
      expect(sql.toString()).toContain("#>>'{data,title}'");
    });
  });

  describe("number field operators", () => {
    const field = f.number({ required: true });
    const operators = field.getOperators(field.config);

    test("between generates correct SQL", () => {
      const sql = operators.column.between(mockColumn, [10, 20], mockCtx);
      expect(sql.toString()).toContain("BETWEEN 10 AND 20");
    });

    test("jsonb.gt casts to numeric", () => {
      const ctx = { ...mockCtx, jsonbPath: ["stats", "count"] };
      const sql = operators.jsonb.gt(mockColumn, 100, ctx);
      expect(sql.toString()).toContain("::numeric >");
    });
  });
});
```

### 3. Validation Tests

```typescript
// packages/questpie/src/server/fields/__tests__/validation.test.ts
import { describe, test, expect } from "bun:test";

describe("Field Validation", () => {
  describe("text field", () => {
    test("required field rejects null", () => {
      const field = f.text({ required: true });
      const schema = field.toZodSchema();

      expect(() => schema.parse(null)).toThrow();
      expect(() => schema.parse(undefined)).toThrow();
      expect(schema.parse("valid")).toBe("valid");
    });

    test("maxLength is enforced", () => {
      const field = f.text({ maxLength: 5 });
      const schema = field.toZodSchema();

      expect(() => schema.parse("too long")).toThrow();
      expect(schema.parse("ok")).toBe("ok");
    });

    test("pattern validation works", () => {
      const field = f.text({ pattern: /^[A-Z]+$/ });
      const schema = field.toZodSchema();

      expect(() => schema.parse("lowercase")).toThrow();
      expect(schema.parse("VALID")).toBe("VALID");
    });
  });

  describe("email field", () => {
    test("validates email format", () => {
      const field = f.email({ required: true });
      const schema = field.toZodSchema();

      expect(() => schema.parse("invalid")).toThrow();
      expect(schema.parse("test@example.com")).toBe("test@example.com");
    });
  });
});
```

### 4. Collection Integration Tests

```typescript
// packages/questpie/src/server/fields/__tests__/collection-integration.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

describe("Collection Integration", () => {
  let db: DrizzleClient;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  describe("posts collection (migrated)", () => {
    const posts = q.collection("posts").fields((f) => ({
      title: f.text({ required: true, maxLength: 255 }),
      content: f.text({ mode: "text" }),
      published: f.boolean({ default: false }),
      author: f.relation("users", { type: "belongsTo", required: true }),
    }));

    test("create works", async () => {
      const post = await posts.create({
        title: "Test Post",
        content: "Content here",
        authorId: testUserId,
      });

      expect(post.id).toBeDefined();
      expect(post.title).toBe("Test Post");
      expect(post.published).toBe(false); // default
    });

    test("find with where works", async () => {
      const results = await posts.find({
        where: {
          title: { contains: "Test" },
          published: { eq: false },
        },
      });

      expect(results.data.length).toBeGreaterThan(0);
    });

    test("find with relation filter works", async () => {
      const results = await posts.find({
        where: {
          author: { is: { role: "admin" } },
        },
      });

      expect(results.data).toBeDefined();
    });

    test("update works", async () => {
      const updated = await posts.update(testPostId, {
        published: true,
      });

      expect(updated.published).toBe(true);
    });

    test("delete works", async () => {
      await posts.delete(testPostId);

      const found = await posts.findById(testPostId);
      expect(found).toBeNull();
    });
  });
});
```

## Existujúce testy - čo sa mení

### Testy ktoré sa NEMENIA

```typescript
// Tieto testy by mali prejsť bez úprav:

// ✅ API endpoint testy
test("GET /api/posts returns posts", async () => {
  const res = await fetch("/api/posts");
  expect(res.status).toBe(200);
});

// ✅ CRUD operation testy
test("can create post", async () => {
  const post = await cms.collections.posts.create({...});
  expect(post.id).toBeDefined();
});

// ✅ Relation loading testy
test("can load post with author", async () => {
  const post = await cms.collections.posts.findById(id, {
    with: { author: true },
  });
  expect(post.author).toBeDefined();
});

// ✅ Where clause testy
test("can filter posts", async () => {
  const posts = await cms.collections.posts.find({
    where: { status: "published" },
  });
  expect(posts.data.length).toBeGreaterThan(0);
});
```

### Testy ktoré sa MÔŽU zmeniť

```typescript
// ⚠️ Testy ktoré priamo referencujú Drizzle columns
// (môžu potrebovať update ak sa mení internal API)

// Pred migráciou
test("direct column access", () => {
  const col = posts.table.title;
  expect(col.name).toBe("title");
});

// Po migrácii - rovnaké, ale column je generovaný
test("direct column access", () => {
  const col = posts.table.title; // Stále funguje
  expect(col.name).toBe("title");
});
```

## CI/CD integrácia

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run schema parity tests
        run: bun test packages/questpie/src/server/fields/__tests__/schema-parity

      - name: Run field unit tests
        run: bun test packages/questpie/src/server/fields/__tests__

      - name: Run collection integration tests
        run: bun test packages/questpie/src/server/collection/__tests__

      - name: Run existing test suite
        run: bun test

      - name: Verify no schema changes
        run: bun run verify-schema
```

## Checklist pre PR review

```markdown
## Migration PR Checklist

### Schema

- [ ] `bun run verify-schema` passes
- [ ] No new migrations needed (schema unchanged)

### Tests

- [ ] All existing tests pass
- [ ] New schema parity tests added
- [ ] New operator tests added (if new field type)

### Functionality

- [ ] CRUD operations work in admin UI
- [ ] All existing API endpoints work
- [ ] Relations load correctly

### Performance

- [ ] No new N+1 queries introduced
- [ ] Query performance unchanged (check slow query log)
```

---

# Summary

## Čo sa mení

| Aspect           | Before                  | After                      |
| ---------------- | ----------------------- | -------------------------- |
| Field definition | Raw Drizzle columns     | `f.text()`, `f.relation()` |
| Labels/metadata  | Only in admin           | In BE, introspected        |
| Relations        | Separate `.relations()` | Inline `f.relation()`      |
| Admin fields     | Must define all         | Auto-generated             |
| Validation       | Drizzle → Zod           | Field → Zod + JSON Schema  |
| Query operators  | Fixed set               | Field-defined, extensible  |
| Migration flow   | Unchanged               | Unchanged (sugar syntax)   |

## Benefits

1. **Single source of truth** - field metadata defined once on BE
2. **Less boilerplate** - ~50-70% reduction in admin config
3. **Type safety E2E** - FE knows exact types from BE
4. **Unified validation** - one schema, both sides
5. **Extensible** - custom fields, operators, renderers
6. **Query power** - field-aware filtering, PostGIS, JSON paths
7. **Auto-introspection** - zero-config admin for simple cases

## Estimated Effort

| Phase                        | Weeks           |
| ---------------------------- | --------------- |
| Phase 1: Core Field System   | 1               |
| Phase 2: Built-in Fields     | 1               |
| Phase 3: Relation Fields     | 1.5             |
| Phase 4: Complex Fields      | 1               |
| Phase 5: Operators           | 1.5             |
| Phase 6: Admin Introspection | 1.5             |
| Phase 7: Advanced Features   | 2               |
| **Total**                    | **~9-10 weeks** |

With parallelization possible: **6-7 weeks**
