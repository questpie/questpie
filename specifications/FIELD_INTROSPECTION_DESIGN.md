# Field Introspection & Type-Safe Admin Rendering

## Overview

This specification describes a unified system where:

1. Server field definitions are the **single source of truth**
2. Admin UI config is added via **type-safe metadata augmentation**
3. Field type → Client renderer mapping is done via **registries**
4. Collection/field **access control is introspectable**
5. Admin `.fields()` is **replaced with automatic introspection**

---

## Current State Analysis

### Server Side (`questpie`)

```
FieldDefinition<TState>
├── state: FieldDefinitionState
│   ├── type: string ("text", "relation", etc.)
│   ├── config: BaseFieldConfig & FieldSpecificConfig
│   ├── value/input/output: Type info
│   ├── column: Drizzle column | null
│   ├── location: "main" | "i18n" | "virtual" | "relation"
│   └── metadata?: FieldMetadata (cached)
├── toColumn(name): Column generation
├── toZodSchema(): Validation schema
├── getOperators(): Query operators
├── getMetadata(): FieldMetadata (computed)
└── getNestedFields?(): For object/array fields
```

**Key Files:**

- `packages/questpie/src/server/fields/types.ts` - Core interfaces
- `packages/questpie/src/server/fields/define-field.ts` - Field factory
- `packages/questpie/src/server/fields/registry.ts` - Field registry
- `packages/questpie/src/server/fields/builtin/*.ts` - Built-in fields

### Admin Side (`@questpie/admin`)

```
FieldDefinition<TName, TOptions>
├── name: string (field TYPE, e.g., "text")
├── ~options: TOptions (merged config)
├── field: { component: React.ComponentType }
├── cell?: { component: React.ComponentType }
└── createZod?: (opts) => ZodSchema
```

**Key Files:**

- `packages/admin/src/client/builder/field/field.ts` - Field definition
- `packages/admin/src/client/builder/proxies.ts` - Registry proxies
- `packages/admin/src/client/builder/collection/collection-builder.ts` - Collection builder
- `packages/admin/src/client/views/collection/cells/*.tsx` - Cell renderers

---

## Proposed Architecture

### 1. Unified Field Metadata with Augmentation

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/questpie/src/server/fields/types.ts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base field metadata - data-focused, no UI concerns.
 * Extensible via module augmentation.
 */
export interface FieldMetadataBase {
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

  /** Validation constraints */
  validation?: FieldValidationConstraints;

  /**
   * Admin UI configuration.
   * Augmented by @questpie/admin package.
   * @see AdminFieldConfig
   */
  admin?: AdminFieldConfig;
}

/**
 * Validation constraints extracted from field config.
 */
export interface FieldValidationConstraints {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

/**
 * Admin-specific field configuration.
 * Empty interface - augmented by @questpie/admin.
 */
export interface AdminFieldConfig {}

// ═══════════════════════════════════════════════════════════════════════════
// Per-field-type metadata interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface TextFieldMetadata extends FieldMetadataBase {
  type: "text";
  mode?: "varchar" | "text";
  admin?: TextFieldAdminConfig;
}

export interface TextareaFieldMetadata extends FieldMetadataBase {
  type: "textarea";
  admin?: TextareaFieldAdminConfig;
}

export interface NumberFieldMetadata extends FieldMetadataBase {
  type: "number";
  integer?: boolean;
  admin?: NumberFieldAdminConfig;
}

export interface SelectFieldMetadata extends FieldMetadataBase {
  type: "select";
  options: Array<{ value: string | number; label: I18nText }>;
  multiple?: boolean;
  admin?: SelectFieldAdminConfig;
}

export interface RelationFieldMetadata extends FieldMetadataBase {
  type: "relation";
  relationType: "belongsTo" | "hasMany" | "manyToMany" | "multiple";
  targetCollection: string | string[];
  foreignKey?: string;
  through?: string;
  sourceField?: string;
  targetField?: string;
  onDelete?: ReferentialAction;
  admin?: RelationFieldAdminConfig;
}

export interface ObjectFieldMetadata extends FieldMetadataBase {
  type: "object";
  nestedFields?: Record<string, FieldMetadata>;
  admin?: ObjectFieldAdminConfig;
}

export interface ArrayFieldMetadata extends FieldMetadataBase {
  type: "array";
  itemField?: FieldMetadata;
  admin?: ArrayFieldAdminConfig;
}

export interface BlocksFieldMetadata extends FieldMetadataBase {
  type: "blocks";
  allowedBlocks?: string[];
  admin?: BlocksFieldAdminConfig;
}

/**
 * Union type of all field metadata.
 * Extensible via module augmentation for custom fields.
 */
export type FieldMetadata =
  | TextFieldMetadata
  | TextareaFieldMetadata
  | NumberFieldMetadata
  | SelectFieldMetadata
  | RelationFieldMetadata
  | ObjectFieldMetadata
  | ArrayFieldMetadata
  | BlocksFieldMetadata
  | FieldMetadataBase; // Fallback for unknown types

// ═══════════════════════════════════════════════════════════════════════════
// Admin config interfaces (empty, augmented by admin package)
// ═══════════════════════════════════════════════════════════════════════════

export interface TextFieldAdminConfig extends AdminFieldConfig {}
export interface TextareaFieldAdminConfig extends AdminFieldConfig {}
export interface NumberFieldAdminConfig extends AdminFieldConfig {}
export interface SelectFieldAdminConfig extends AdminFieldConfig {}
export interface RelationFieldAdminConfig extends AdminFieldConfig {}
export interface ObjectFieldAdminConfig extends AdminFieldConfig {}
export interface ArrayFieldAdminConfig extends AdminFieldConfig {}
export interface BlocksFieldAdminConfig extends AdminFieldConfig {}
```

### 2. Admin Package Augmentation

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/admin/src/augmentation.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { ComponentType } from "react";
import type { I18nText } from "./i18n/types";

declare module "@questpie/questpie" {
  // ─────────────────────────────────────────────────────────────────────────
  // Base admin config (applies to all fields)
  // ─────────────────────────────────────────────────────────────────────────

  interface AdminFieldConfig {
    /** Custom form component override */
    component?: ComponentType<FieldComponentProps>;

    /** Custom cell component override */
    cell?: ComponentType<CellComponentProps>;

    /** Field width in form (CSS value or number for pixels) */
    width?: string | number;

    /** Column span in grid layout (1-12) */
    colspan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

    /** Field group for form organization */
    group?: string;

    /** Display order within group */
    order?: number;

    /** Conditional visibility */
    hidden?: boolean | ((values: Record<string, unknown>) => boolean);

    /** Conditional read-only state */
    readOnly?: boolean | ((values: Record<string, unknown>) => boolean);

    /** Conditional disabled state */
    disabled?: boolean | ((values: Record<string, unknown>) => boolean);

    /** Placeholder text */
    placeholder?: I18nText;

    /** Help text shown below field */
    helpText?: I18nText;

    /** Show in list view columns by default */
    showInList?: boolean;

    /** Column width in list view */
    listWidth?: string | number;

    /** Sortable in list view */
    sortable?: boolean;

    /** Filterable in list view */
    filterable?: boolean;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Field-specific admin config
  // ─────────────────────────────────────────────────────────────────────────

  interface TextFieldAdminConfig extends AdminFieldConfig {
    /** Input type (text, email, url, tel, etc.) */
    inputType?: "text" | "email" | "url" | "tel" | "search";

    /** Show character counter */
    showCounter?: boolean;

    /** Prefix text/icon */
    prefix?: string | ComponentType;

    /** Suffix text/icon */
    suffix?: string | ComponentType;
  }

  interface TextareaFieldAdminConfig extends AdminFieldConfig {
    /** Number of visible rows */
    rows?: number;

    /** Auto-resize to content */
    autoResize?: boolean;

    /** Show character counter */
    showCounter?: boolean;

    /** Enable rich text mode */
    richText?: boolean;
  }

  interface NumberFieldAdminConfig extends AdminFieldConfig {
    /** Show increment/decrement buttons */
    showButtons?: boolean;

    /** Step value for buttons */
    step?: number;

    /** Number format (decimal places, thousands separator, etc.) */
    format?: Intl.NumberFormatOptions;

    /** Prefix (e.g., "$", "€") */
    prefix?: string;

    /** Suffix (e.g., "kg", "%") */
    suffix?: string;
  }

  interface SelectFieldAdminConfig extends AdminFieldConfig {
    /** Allow creating new options */
    creatable?: boolean;

    /** Enable search/filter */
    searchable?: boolean;

    /** Clear button */
    clearable?: boolean;

    /** Async options loader */
    loadOptions?: (search: string) => Promise<SelectOption[]>;

    /** Display as radio/checkbox group instead of dropdown */
    displayAs?: "dropdown" | "radio" | "checkbox";
  }

  interface RelationFieldAdminConfig extends AdminFieldConfig {
    /** Fields to display in relation picker */
    displayFields?: string[];

    /** Title field for display */
    titleField?: string;

    /** Allow creating new related records inline */
    allowCreate?: boolean;

    /** Allow editing related records inline */
    allowEdit?: boolean;

    /** Preload options (vs lazy load) */
    preload?: boolean;

    /** Maximum items for multiple relations */
    maxItems?: number;

    /** Display as table for hasMany/manyToMany */
    displayAs?: "select" | "table" | "cards";

    /** Sortable items (for ordered relations) */
    sortable?: boolean;
  }

  interface ObjectFieldAdminConfig extends AdminFieldConfig {
    /** Collapsible section */
    collapsible?: boolean;

    /** Default collapsed state */
    defaultCollapsed?: boolean;

    /** Display as card/section/inline */
    displayAs?: "card" | "section" | "inline";
  }

  interface ArrayFieldAdminConfig extends AdminFieldConfig {
    /** Allow reordering items */
    sortable?: boolean;

    /** Collapsible items */
    collapsible?: boolean;

    /** Add button label */
    addLabel?: I18nText;

    /** Empty state message */
    emptyMessage?: I18nText;

    /** Display as table/cards/list */
    displayAs?: "list" | "table" | "cards";
  }

  interface BlocksFieldAdminConfig extends AdminFieldConfig {
    /** Available block types (overrides allowedBlocks) */
    blocks?: string[];

    /** Show block type selector */
    showBlockSelector?: boolean;

    /** Allow drag & drop reordering */
    sortable?: boolean;

    /** Collapsible blocks */
    collapsible?: boolean;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Component prop types
// ─────────────────────────────────────────────────────────────────────────

export interface FieldComponentProps<TValue = unknown> {
  name: string;
  value: TValue;
  onChange: (value: TValue) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  metadata: FieldMetadata;
  // ... other props from FieldContext
}

export interface CellComponentProps<TValue = unknown> {
  value: TValue;
  row: Record<string, unknown>;
  metadata: FieldMetadata;
}

export interface SelectOption {
  value: string | number;
  label: I18nText;
  disabled?: boolean;
}
```

### 3. Server Field Definition with Admin Config

````typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/questpie/src/server/fields/types.ts - Extended BaseFieldConfig
// ═══════════════════════════════════════════════════════════════════════════

export interface BaseFieldConfig {
  // ─── Data Config ───────────────────────────────────────────────────────

  /** Display label (i18n supported) */
  label?: I18nText;

  /** Help text / description */
  description?: I18nText;

  /** Field is required */
  required?: boolean;

  /** Field can be null */
  nullable?: boolean;

  /** Default value */
  default?: unknown | (() => unknown);

  /** Input behavior */
  input?: boolean | "optional";

  /** Include in output */
  output?: boolean;

  /** Field is localized */
  localized?: boolean;

  /** Create unique constraint */
  unique?: boolean;

  /** Create index */
  index?: boolean;

  /** Include in search */
  searchable?: boolean;

  /** Access control */
  access?: FieldDefinitionAccess;

  /** Virtual field config */
  virtual?: true | SQL<unknown>;

  /** Field hooks */
  hooks?: FieldHooks;

  // ─── Admin Config (Type-Safe via Augmentation) ─────────────────────────

  /**
   * Admin UI configuration.
   *
   * This property is typed via module augmentation from @questpie/admin.
   * When admin package is installed, this gets full type support.
   * Without admin package, this is typed as `AdminFieldConfig` (empty interface).
   *
   * @example
   * ```ts
   * f.text({
   *   label: "Title",
   *   required: true,
   *   admin: {
   *     width: 400,
   *     placeholder: "Enter title...",
   *     showInList: true,
   *   }
   * })
   * ```
   */
  admin?: AdminFieldConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// Field-specific configs inherit admin augmentation
// ═══════════════════════════════════════════════════════════════════════════

export interface TextFieldConfig extends BaseFieldConfig {
  mode?: "varchar" | "text";
  maxLength?: number;
  minLength?: number;
  pattern?: string | RegExp;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;

  /** Admin config for text field (augmented) */
  admin?: TextFieldAdminConfig;
}

export interface RelationFieldConfig extends BaseFieldConfig {
  to: string | (() => string);
  hasMany?: boolean;
  through?: string | (() => string);
  sourceField?: string;
  targetField?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  relationName?: string;

  /** Admin config for relation field (augmented) */
  admin?: RelationFieldAdminConfig;
}

// ... similar for all field types
````

### 4. Collection & Access Introspection

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/questpie/src/server/collection/introspection.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { Collection } from "./builder/collection";
import type { FieldMetadata } from "../fields/types";
import type { CRUDContext } from "./crud/types";

/**
 * Introspected collection schema for admin consumption.
 */
export interface CollectionSchema {
  /** Collection name */
  name: string;

  /** Display label */
  label?: I18nText;

  /** Description */
  description?: I18nText;

  /** Icon identifier */
  icon?: string;

  /** Field schemas */
  fields: Record<string, FieldSchema>;

  /** Access information */
  access: CollectionAccessInfo;

  /** Collection options */
  options: {
    timestamps: boolean;
    softDelete: boolean;
    versioning: boolean;
    singleton?: boolean;
  };

  /** Title field configuration */
  title?: {
    field?: string;
    template?: string;
  };

  /** Relations metadata */
  relations: Record<string, RelationSchema>;
}

/**
 * Introspected field schema.
 */
export interface FieldSchema {
  /** Field name (key) */
  name: string;

  /** Full metadata including admin config */
  metadata: FieldMetadata;

  /** Field location */
  location: "main" | "i18n" | "virtual" | "relation";

  /** Field-level access */
  access?: FieldAccessInfo;
}

/**
 * Collection access information.
 */
export interface CollectionAccessInfo {
  /** Can user see this collection at all? */
  visible: boolean;

  /** Access level */
  level: "none" | "filtered" | "full";

  /** Operations access */
  operations: {
    create: AccessResult;
    read: AccessResult;
    update: AccessResult;
    delete: AccessResult;
  };
}

/**
 * Field access information.
 */
export interface FieldAccessInfo {
  read: AccessResult;
  create: AccessResult;
  update: AccessResult;
}

/**
 * Access evaluation result.
 */
export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason?: string }
  | { allowed: "filtered"; where?: unknown };

/**
 * Relation schema for admin.
 */
export interface RelationSchema {
  name: string;
  type: "belongsTo" | "hasMany" | "manyToMany";
  targetCollection: string;
  foreignKey?: string;
  through?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Introspection functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Introspect a collection for admin consumption.
 * Evaluates access control and returns schema with permissions.
 */
export async function introspectCollection(
  collection: Collection<any>,
  context: CRUDContext,
): Promise<CollectionSchema> {
  const { state } = collection;
  const fieldDefinitions = state.fieldDefinitions || {};

  // Evaluate collection-level access
  const access = await evaluateCollectionAccess(collection, context);

  // Build field schemas
  const fields: Record<string, FieldSchema> = {};
  for (const [name, fieldDef] of Object.entries(fieldDefinitions)) {
    const metadata = fieldDef.getMetadata();
    const fieldAccess = await evaluateFieldAccess(fieldDef, context);

    fields[name] = {
      name,
      metadata,
      location: fieldDef.state.location,
      access: fieldAccess,
    };
  }

  return {
    name: state.name,
    label: state.label,
    description: state.description,
    icon: state.icon,
    fields,
    access,
    options: {
      timestamps: state.options?.timestamps ?? false,
      softDelete: state.options?.softDelete ?? false,
      versioning: state.options?.versioning ?? false,
      singleton: state.options?.singleton,
    },
    title: state.title
      ? {
          field: state.title.fieldName,
          template: state.title.template,
        }
      : undefined,
    relations: extractRelationSchemas(state.relations),
  };
}

/**
 * Evaluate collection-level access for current user.
 */
async function evaluateCollectionAccess(
  collection: Collection<any>,
  context: CRUDContext,
): Promise<CollectionAccessInfo> {
  const { access } = collection.state.options || {};

  // No access config = full access
  if (!access) {
    return {
      visible: true,
      level: "full",
      operations: {
        create: { allowed: true },
        read: { allowed: true },
        update: { allowed: true },
        delete: { allowed: true },
      },
    };
  }

  const operations = {
    create: await evaluateAccess(access.create, context, "create"),
    read: await evaluateAccess(access.read, context, "read"),
    update: await evaluateAccess(access.update, context, "update"),
    delete: await evaluateAccess(access.delete, context, "delete"),
  };

  // Determine visibility and level
  const hasAnyAccess = Object.values(operations).some(
    (r) => r.allowed !== false,
  );
  const hasFilteredAccess = Object.values(operations).some(
    (r) => r.allowed === "filtered",
  );
  const hasFullAccess = Object.values(operations).every(
    (r) => r.allowed === true,
  );

  return {
    visible: hasAnyAccess,
    level: hasFullAccess ? "full" : hasFilteredAccess ? "filtered" : "none",
    operations,
  };
}

/**
 * Evaluate a single access rule.
 */
async function evaluateAccess(
  rule: boolean | AccessFunction | undefined,
  context: CRUDContext,
  operation: string,
): Promise<AccessResult> {
  // No rule = allowed
  if (rule === undefined || rule === true) {
    return { allowed: true };
  }

  // Explicit false = denied
  if (rule === false) {
    return { allowed: false };
  }

  // Function = evaluate
  if (typeof rule === "function") {
    const result = await rule(context);

    // Boolean result
    if (typeof result === "boolean") {
      return result ? { allowed: true } : { allowed: false };
    }

    // Where condition = filtered access
    if (result && typeof result === "object") {
      return { allowed: "filtered", where: result };
    }

    return { allowed: false };
  }

  return { allowed: true };
}
```

### 5. Admin Introspection API Endpoint

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/questpie/src/server/adapters/routes/admin-schema.ts
// ═══════════════════════════════════════════════════════════════════════════

import { introspectCollection } from "../../collection/introspection";
import type { Questpie } from "../../config/cms";
import type { CRUDContext } from "../../collection/crud/types";

/**
 * Admin schema endpoint.
 * Returns introspected schemas for all accessible collections.
 */
export function createAdminSchemaRoutes(cms: Questpie<any>) {
  return {
    /**
     * GET /admin/schema
     * Returns all collection schemas with access info.
     */
    async getSchema(context: CRUDContext) {
      const collections: Record<string, CollectionSchema> = {};

      for (const [name, collection] of Object.entries(cms.collections)) {
        const schema = await introspectCollection(collection, context);

        // Only include visible collections
        if (schema.access.visible) {
          collections[name] = schema;
        }
      }

      return {
        collections,
        globals: await introspectGlobals(cms, context),
      };
    },

    /**
     * GET /admin/schema/:collection
     * Returns schema for a specific collection.
     */
    async getCollectionSchema(collectionName: string, context: CRUDContext) {
      const collection = cms.collections[collectionName];
      if (!collection) {
        throw new ApiError({ code: "NOT_FOUND" });
      }

      const schema = await introspectCollection(collection, context);

      if (!schema.access.visible) {
        throw new ApiError({ code: "FORBIDDEN" });
      }

      return schema;
    },
  };
}
```

### 6. Admin Field Registry with Auto-Matching

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/admin/src/client/registry/field-renderer-registry.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { ComponentType } from "react";
import type {
  FieldMetadata,
  FieldComponentProps,
  CellComponentProps,
} from "@questpie/questpie";

/**
 * Field renderer registration.
 */
interface FieldRenderer<TMetadata extends FieldMetadata = FieldMetadata> {
  /** Unique renderer identifier */
  id: string;

  /** Field type(s) this renderer handles */
  types: string | string[];

  /** Priority (higher = preferred) */
  priority?: number;

  /** Condition for when this renderer applies */
  match?: (metadata: TMetadata) => boolean;

  /** Form component */
  component: ComponentType<FieldComponentProps>;

  /** Cell component for list view */
  cell?: ComponentType<CellComponentProps>;

  /** Validation schema factory */
  createZod?: (metadata: TMetadata) => ZodSchema;
}

/**
 * Field renderer registry.
 * Maps server field types to client renderers.
 */
class FieldRendererRegistry {
  private renderers: Map<string, FieldRenderer[]> = new Map();

  /**
   * Register a field renderer.
   */
  register<TMetadata extends FieldMetadata>(
    renderer: FieldRenderer<TMetadata>,
  ): this {
    const types = Array.isArray(renderer.types)
      ? renderer.types
      : [renderer.types];

    for (const type of types) {
      const existing = this.renderers.get(type) || [];
      existing.push(renderer as FieldRenderer);
      existing.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      this.renderers.set(type, existing);
    }

    return this;
  }

  /**
   * Get the best matching renderer for a field.
   */
  resolve(metadata: FieldMetadata): FieldRenderer | undefined {
    const typeRenderers = this.renderers.get(metadata.type) || [];

    // Find first renderer that matches
    for (const renderer of typeRenderers) {
      if (!renderer.match || renderer.match(metadata)) {
        return renderer;
      }
    }

    // Fallback to base type renderer
    return this.renderers.get("*")?.[0];
  }

  /**
   * Get all registered types.
   */
  types(): string[] {
    return Array.from(this.renderers.keys());
  }
}

// Global registry singleton
export const fieldRendererRegistry = new FieldRendererRegistry();

// ═══════════════════════════════════════════════════════════════════════════
// Built-in renderer registrations
// ═══════════════════════════════════════════════════════════════════════════

// Text fields
fieldRendererRegistry.register({
  id: "text",
  types: ["text", "email", "url"],
  component: TextField,
  cell: TextCell,
  createZod: (meta) => {
    let schema = z.string();
    if (meta.validation?.maxLength)
      schema = schema.max(meta.validation.maxLength);
    if (meta.validation?.minLength)
      schema = schema.min(meta.validation.minLength);
    if (meta.validation?.pattern)
      schema = schema.regex(new RegExp(meta.validation.pattern));
    return meta.required ? schema : schema.nullish();
  },
});

// Rich text variant (higher priority when admin.richText is true)
fieldRendererRegistry.register({
  id: "textarea-rich",
  types: "textarea",
  priority: 10,
  match: (meta) => meta.admin?.richText === true,
  component: RichTextField,
  cell: RichTextCell,
});

// Standard textarea
fieldRendererRegistry.register({
  id: "textarea",
  types: "textarea",
  component: TextareaField,
  cell: TextCell,
});

// Relations with different display modes
fieldRendererRegistry.register({
  id: "relation-select",
  types: "relation",
  match: (meta) => meta.relationType === "belongsTo" || !meta.admin?.displayAs,
  component: RelationSelectField,
  cell: RelationCell,
});

fieldRendererRegistry.register({
  id: "relation-table",
  types: "relation",
  match: (meta) =>
    (meta.relationType === "hasMany" || meta.relationType === "manyToMany") &&
    meta.admin?.displayAs === "table",
  component: RelationTableField,
  cell: RelationListCell,
});

// ... more registrations
```

### 7. Simplified Admin Collection Builder

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/admin/src/client/builder/collection/collection-builder-v2.ts
// ═══════════════════════════════════════════════════════════════════════════

import type { CollectionSchema, FieldSchema } from "@questpie/questpie";
import { fieldRendererRegistry } from "../registry/field-renderer-registry";

/**
 * Simplified collection builder.
 * Fields are introspected automatically - only layout needs configuration.
 */
export class CollectionBuilderV2<TState extends CollectionBuilderStateV2> {
  constructor(public readonly state: TState) {}

  /**
   * Configure list view.
   * Fields are auto-resolved from introspected schema.
   */
  list<TConfig extends ListViewConfig<TState["schema"]>>(
    config: TConfig | ((ctx: ListViewContext<TState["schema"]>) => TConfig),
  ): CollectionBuilderV2<SetProperty<TState, "list", TConfig>> {
    const resolvedConfig =
      typeof config === "function" ? config(this.createListContext()) : config;

    return new CollectionBuilderV2({
      ...this.state,
      list: resolvedConfig,
    } as any);
  }

  /**
   * Configure form view.
   * Fields are auto-resolved from introspected schema.
   */
  form<TConfig extends FormViewConfig<TState["schema"]>>(
    config: TConfig | ((ctx: FormViewContext<TState["schema"]>) => TConfig),
  ): CollectionBuilderV2<SetProperty<TState, "form", TConfig>> {
    const resolvedConfig =
      typeof config === "function" ? config(this.createFormContext()) : config;

    return new CollectionBuilderV2({
      ...this.state,
      form: resolvedConfig,
    } as any);
  }

  /**
   * Override specific field renderers.
   * Use when you need custom components beyond what's in the registry.
   */
  overrideField<TFieldName extends keyof TState["schema"]["fields"]>(
    fieldName: TFieldName,
    override: FieldOverride,
  ): CollectionBuilderV2<TState> {
    return new CollectionBuilderV2({
      ...this.state,
      fieldOverrides: {
        ...this.state.fieldOverrides,
        [fieldName]: override,
      },
    } as any);
  }

  private createListContext(): ListViewContext<TState["schema"]> {
    const fields = this.state.schema.fields;

    // Create field proxy for autocomplete
    const f = {} as FieldProxy<TState["schema"]["fields"]>;
    for (const key of Object.keys(fields)) {
      (f as any)[key] = key;
    }

    return {
      f,
      schema: this.state.schema,
    };
  }

  private createFormContext(): FormViewContext<TState["schema"]> {
    const fields = this.state.schema.fields;

    const f = {} as FieldProxy<TState["schema"]["fields"]>;
    for (const key of Object.keys(fields)) {
      (f as any)[key] = key;
    }

    return {
      f,
      schema: this.state.schema,
      layout: layoutHelpers,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Type definitions
// ═══════════════════════════════════════════════════════════════════════════

interface CollectionBuilderStateV2 {
  name: string;
  schema: CollectionSchema;
  list?: ListViewConfig<any>;
  form?: FormViewConfig<any>;
  fieldOverrides?: Record<string, FieldOverride>;
}

interface ListViewConfig<TSchema extends CollectionSchema> {
  /** Columns to display */
  columns?: Array<
    | keyof TSchema["fields"]
    | {
        field: keyof TSchema["fields"];
        width?: string | number;
        label?: I18nText;
      }
  >;

  /** Default sort */
  defaultSort?: {
    field: keyof TSchema["fields"];
    direction: "asc" | "desc";
  };

  /** Searchable fields */
  searchFields?: Array<keyof TSchema["fields"]>;

  /** Filter fields shown in sidebar */
  filterFields?: Array<keyof TSchema["fields"]>;

  /** Row actions */
  rowActions?: RowAction[];

  /** Bulk actions */
  bulkActions?: BulkAction[];
}

interface FormViewConfig<TSchema extends CollectionSchema> {
  /** Form layout */
  layout?: FormLayout<TSchema>;

  /** Sidebar fields */
  sidebar?: {
    fields?: Array<keyof TSchema["fields"]>;
    position?: "left" | "right";
  };

  /** Field hooks for client-side reactivity */
  hooks?: {
    [K in keyof TSchema["fields"]]?: FieldHooks;
  };
}

interface FormLayout<TSchema extends CollectionSchema> {
  type: "simple" | "tabs" | "sections";
  items: Array<{
    id?: string;
    label?: I18nText;
    fields: Array<keyof TSchema["fields"]>;
    condition?: (values: Record<string, unknown>) => boolean;
  }>;
}

interface FieldHooks {
  /** Called when field value changes */
  onChange?: (value: unknown, ctx: FieldHookContext) => void | Promise<void>;

  /** Derive value from other fields (makes field read-only) */
  derive?: (values: Record<string, unknown>) => unknown;

  /** Validate on client side */
  validate?: (
    value: unknown,
    values: Record<string, unknown>,
  ) => string | undefined;

  /** Transform value before form submission */
  transform?: (value: unknown) => unknown;
}

interface FieldOverride {
  /** Custom form component */
  component?: ComponentType<FieldComponentProps>;

  /** Custom cell component */
  cell?: ComponentType<CellComponentProps>;

  /** Override admin config */
  adminConfig?: Partial<AdminFieldConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Usage Example
// ═══════════════════════════════════════════════════════════════════════════

/*
// Server-side field definition (with admin config)
const posts = collection("posts")
  .fields((f) => ({
    title: f.text({
      label: "Title",
      required: true,
      maxLength: 200,
      admin: {
        placeholder: "Enter post title...",
        showInList: true,
        sortable: true,
      },
    }),
    content: f.textarea({
      label: "Content",
      localized: true,
      admin: {
        richText: true,
        rows: 20,
      },
    }),
    author: f.relation({
      to: "users",
      required: true,
      admin: {
        displayFields: ["name", "email"],
        titleField: "name",
        allowCreate: false,
      },
    }),
    status: f.select({
      options: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
      ],
      required: true,
      admin: {
        displayAs: "radio",
      },
    }),
    publishedAt: f.datetime({
      admin: {
        hidden: (values) => values.status !== "published",
      },
    }),
  }))
  .build();

// Admin-side configuration (minimal - fields introspected!)
const postsAdmin = admin.collection("posts")
  .list(({ f }) => ({
    columns: [f.title, f.author, f.status, f.publishedAt],
    defaultSort: { field: f.createdAt, direction: "desc" },
    searchFields: [f.title, f.content],
  }))
  .form(({ f, layout }) => ({
    layout: layout.tabs([
      { id: "content", label: "Content", fields: [f.title, f.content] },
      { id: "settings", label: "Settings", fields: [f.status, f.publishedAt] },
    ]),
    sidebar: {
      fields: [f.author],
    },
    hooks: {
      [f.publishedAt]: {
        derive: (values) => values.status === "published" ? new Date() : null,
      },
    },
  }));
*/
```

---

## Type Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER SIDE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌──────────────────────┐                          │
│  │ BaseFieldConfig │────▶│ TextFieldConfig      │                          │
│  │   + admin?      │     │   + maxLength        │                          │
│  └─────────────────┘     │   + admin?: TextFieldAdminConfig                │
│                          └──────────────────────┘                          │
│                                    │                                        │
│                                    ▼                                        │
│                          ┌──────────────────────┐                          │
│                          │ FieldDefinition      │                          │
│                          │   .getMetadata()     │                          │
│                          └──────────────────────┘                          │
│                                    │                                        │
│                                    ▼                                        │
│                          ┌──────────────────────┐                          │
│                          │ TextFieldMetadata    │                          │
│                          │   type: "text"       │                          │
│                          │   admin?: {...}      │◀─── Augmented by admin   │
│                          └──────────────────────┘                          │
│                                    │                                        │
│                                    ▼                                        │
│                          ┌──────────────────────┐                          │
│                          │ introspectCollection │                          │
│                          │   → CollectionSchema │                          │
│                          └──────────────────────┘                          │
│                                    │                                        │
└────────────────────────────────────│────────────────────────────────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │  /admin/schema API  │
                          └──────────┬──────────┘
                                     │
┌────────────────────────────────────│────────────────────────────────────────┐
│                              ADMIN SIDE                                      │
├────────────────────────────────────│────────────────────────────────────────┤
│                                    ▼                                        │
│                          ┌──────────────────────┐                          │
│                          │ CollectionSchema     │                          │
│                          │   fields: {...}      │                          │
│                          │   access: {...}      │                          │
│                          └──────────────────────┘                          │
│                                    │                                        │
│                   ┌────────────────┼────────────────┐                      │
│                   ▼                ▼                ▼                      │
│          ┌───────────────┐ ┌───────────────┐ ┌───────────────┐            │
│          │FieldRenderer  │ │FieldRenderer  │ │FieldRenderer  │            │
│          │Registry       │ │Registry       │ │Registry       │            │
│          │  type:"text"  │ │  type:"rel"   │ │  type:"select"│            │
│          └───────────────┘ └───────────────┘ └───────────────┘            │
│                   │                │                │                      │
│                   └────────────────┼────────────────┘                      │
│                                    ▼                                        │
│                          ┌──────────────────────┐                          │
│                          │ Resolved Components  │                          │
│                          │   FormComponent      │                          │
│                          │   CellComponent      │                          │
│                          │   ZodSchema          │                          │
│                          └──────────────────────┘                          │
│                                    │                                        │
│                   ┌────────────────┼────────────────┐                      │
│                   ▼                ▼                ▼                      │
│          ┌───────────────┐ ┌───────────────┐ ┌───────────────┐            │
│          │  List View    │ │  Form View    │ │  Filters      │            │
│          │  (columns)    │ │  (fields)     │ │  (sidebar)    │            │
│          └───────────────┘ └───────────────┘ └───────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Validation Flow: JSON Schema from Backend

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌──────────────────────┐                          │
│  │ Field Definition│────▶│ toZodSchema()        │                          │
│  │   f.text({...}) │     │   Full Zod schema    │                          │
│  └─────────────────┘     │   - async refinements│                          │
│                          │   - DB uniqueness    │                          │
│                          │   - custom validators│                          │
│                          └──────────┬───────────┘                          │
│                                     │                                       │
│                          ┌──────────▼───────────┐                          │
│                          │ z.toJSONSchema()     │                          │
│                          │   Zod v4 built-in    │                          │
│                          └──────────┬───────────┘                          │
│                                     │                                       │
│                          ┌──────────▼───────────┐                          │
│                          │ CollectionSchema     │                          │
│                          │   + validationSchema │◀── JSON Schema           │
│                          └──────────────────────┘                          │
│                                     │                                       │
└─────────────────────────────────────│───────────────────────────────────────┘
                                      │
                           GET /admin/schema/:collection
                                      │
┌─────────────────────────────────────│───────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────│───────────────────────────────────────┤
│                                     ▼                                       │
│                          ┌──────────────────────┐                          │
│                          │ validationSchema     │                          │
│                          │   (JSON Schema)      │                          │
│                          └──────────┬───────────┘                          │
│                                     │                                       │
│                          ┌──────────▼───────────┐                          │
│                          │ Ajv / @cfworker/...  │                          │
│                          │   JSON Schema        │                          │
│                          │   validator          │                          │
│                          └──────────┬───────────┘                          │
│                                     │                                       │
│                   ┌─────────────────┼─────────────────┐                    │
│                   ▼                 ▼                 ▼                    │
│          ┌───────────────┐ ┌───────────────┐ ┌───────────────┐            │
│          │ Form onChange │ │ Form onSubmit │ │ Inline errors │            │
│          │ (debounced)   │ │ (before send) │ │ (instant)     │            │
│          └───────────────┘ └───────────────┘ └───────────────┘            │
│                                     │                                       │
│                                     │ Submit to API                         │
│                                     ▼                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────│───────────────────────────────────────┐
│                         BACKEND VALIDATION                                   │
├─────────────────────────────────────│───────────────────────────────────────┤
│                                     ▼                                       │
│                          ┌──────────────────────┐                          │
│                          │ Full Zod Validation  │                          │
│                          │   - JSON Schema      │                          │
│                          │   - async refinement │                          │
│                          │   - DB checks        │                          │
│                          │   - custom rules     │                          │
│                          └──────────────────────┘                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Backend: Generate JSON Schema

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/questpie/src/server/collection/introspection.ts
// ═══════════════════════════════════════════════════════════════════════════

import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

/**
 * Extended collection schema with validation.
 */
export interface CollectionSchema {
  name: string;
  label?: I18nText;
  fields: Record<string, FieldSchema>;
  access: CollectionAccessInfo;
  options: CollectionOptions;

  /**
   * JSON Schema for client-side validation.
   * Generated from Zod schemas via z.toJSONSchema().
   *
   * Contains only synchronous, portable validation rules.
   * Async/DB validations happen server-side only.
   */
  validation: {
    /** JSON Schema for create operations */
    insert: JSONSchema;

    /** JSON Schema for update operations */
    update: JSONSchema;
  };
}

/**
 * Extended field schema with validation.
 */
export interface FieldSchema {
  name: string;
  metadata: FieldMetadata;
  location: FieldLocation;
  access?: FieldAccessInfo;

  /**
   * JSON Schema for this specific field.
   * Useful for inline/per-field validation.
   */
  validation?: JSONSchema;
}

/**
 * Generate JSON Schema from collection's Zod schemas.
 */
function generateValidationSchemas(collection: Collection<any>): {
  insert: JSONSchema;
  update: JSONSchema;
} {
  const { insertSchema, updateSchema } = collection.state.schemas || {};

  return {
    insert: insertSchema
      ? z.toJSONSchema(insertSchema, {
          // Options for JSON Schema generation
          target: "draft-2020-12",
          // Strip async refinements (not portable)
          stripAsyncRefinements: true,
        })
      : {},
    update: updateSchema
      ? z.toJSONSchema(updateSchema, {
          target: "draft-2020-12",
          stripAsyncRefinements: true,
        })
      : {},
  };
}

/**
 * Generate JSON Schema for a single field.
 */
function generateFieldValidation(
  fieldDef: FieldDefinition<any>,
): JSONSchema | undefined {
  try {
    const zodSchema = fieldDef.toZodSchema();
    return z.toJSONSchema(zodSchema, {
      target: "draft-2020-12",
      stripAsyncRefinements: true,
    });
  } catch {
    return undefined;
  }
}
```

### Frontend: JSON Schema Validation

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/admin/src/client/validation/json-schema-validator.ts
// ═══════════════════════════════════════════════════════════════════════════

import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { JSONSchema } from "zod/v4/core";

// Singleton Ajv instance with formats
const ajv = new Ajv({
  allErrors: true, // Collect all errors, not just first
  verbose: true, // Include data in errors
  strict: false, // Allow additional keywords
  coerceTypes: false, // Don't auto-coerce types
});
addFormats(ajv);

/**
 * Compiled validator cache.
 */
const validatorCache = new Map<string, Ajv.ValidateFunction>();

/**
 * Validate data against JSON Schema.
 */
export function validateJsonSchema(
  schema: JSONSchema,
  data: unknown,
  cacheKey?: string,
): ValidationResult {
  // Get or compile validator
  let validate = cacheKey ? validatorCache.get(cacheKey) : undefined;

  if (!validate) {
    validate = ajv.compile(schema);
    if (cacheKey) {
      validatorCache.set(cacheKey, validate);
    }
  }

  // Validate
  const valid = validate(data);

  if (valid) {
    return { success: true, data };
  }

  // Transform errors to field paths
  const errors = transformAjvErrors(validate.errors || []);

  return { success: false, errors };
}

/**
 * Validation result type.
 */
export interface ValidationResult {
  success: boolean;
  data?: unknown;
  errors?: FieldError[];
}

export interface FieldError {
  path: string; // e.g., "author", "tags.0.name"
  message: string; // Human-readable message
  keyword: string; // JSON Schema keyword that failed
  params?: unknown; // Additional error params
}

/**
 * Transform Ajv errors to field errors.
 */
function transformAjvErrors(errors: Ajv.ErrorObject[]): FieldError[] {
  return errors.map((error) => ({
    path:
      error.instancePath.slice(1).replace(/\//g, ".") ||
      error.params?.missingProperty ||
      "",
    message: error.message || "Validation failed",
    keyword: error.keyword,
    params: error.params,
  }));
}
```

### Frontend: Form Integration

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// packages/admin/src/client/hooks/use-form-validation.ts
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useCallback } from "react";
import {
  validateJsonSchema,
  type FieldError,
} from "../validation/json-schema-validator";
import type { CollectionSchema } from "@questpie/questpie";

interface UseFormValidationOptions {
  /** Collection schema from introspection */
  schema: CollectionSchema;

  /** Is this an update operation? */
  isUpdate?: boolean;

  /** Debounce validation (ms) */
  debounceMs?: number;
}

/**
 * Hook for form validation using JSON Schema from backend.
 */
export function useFormValidation(options: UseFormValidationOptions) {
  const { schema, isUpdate = false } = options;

  // Select appropriate schema
  const jsonSchema = useMemo(
    () => (isUpdate ? schema.validation.update : schema.validation.insert),
    [schema, isUpdate],
  );

  // Cache key for compiled validator
  const cacheKey = useMemo(
    () => `${schema.name}:${isUpdate ? "update" : "insert"}`,
    [schema.name, isUpdate],
  );

  /**
   * Validate entire form data.
   */
  const validate = useCallback(
    (data: Record<string, unknown>): FieldError[] => {
      const result = validateJsonSchema(jsonSchema, data, cacheKey);
      return result.success ? [] : result.errors || [];
    },
    [jsonSchema, cacheKey],
  );

  /**
   * Validate a single field.
   */
  const validateField = useCallback(
    (
      fieldName: string,
      value: unknown,
      allValues: Record<string, unknown>,
    ): string | undefined => {
      // Get field-specific schema if available
      const fieldSchema = schema.fields[fieldName]?.validation;

      if (fieldSchema) {
        const result = validateJsonSchema(fieldSchema, value);
        return result.errors?.[0]?.message;
      }

      // Fall back to full form validation, extract field error
      const errors = validate({ ...allValues, [fieldName]: value });
      return errors.find((e) => e.path === fieldName)?.message;
    },
    [schema, validate],
  );

  return {
    validate,
    validateField,
    jsonSchema,
  };
}
```

### Validation Layers Summary

| Layer                | What                   | How               | When                  |
| -------------------- | ---------------------- | ----------------- | --------------------- |
| **Frontend Instant** | Type, format, required | JSON Schema (Ajv) | onChange (debounced)  |
| **Frontend Submit**  | Full client validation | JSON Schema (Ajv) | onSubmit (before API) |
| **Backend Full**     | Everything + async     | Zod (full)        | API handler           |

### What's in JSON Schema vs Zod-only

| Validation              | JSON Schema (FE) | Zod (BE) |
| ----------------------- | ---------------- | -------- |
| Type checking           | ✅                | ✅        |
| Required fields         | ✅                | ✅        |
| Min/max length          | ✅                | ✅        |
| Min/max value           | ✅                | ✅        |
| Pattern (regex)         | ✅                | ✅        |
| Email/URL format        | ✅                | ✅        |
| Enum values             | ✅                | ✅        |
| Array min/max items     | ✅                | ✅        |
| Nested object schema    | ✅                | ✅        |
| Async refinements       | ❌                | ✅        |
| DB uniqueness check     | ❌                | ✅        |
| Cross-field validation  | ❌                | ✅        |
| Custom async validators | ❌                | ✅        |
| Transform/coerce        | ❌                | ✅        |

---

## Migration Path

### Phase 1: Add Admin Config to Server Fields

- Add `admin?: AdminFieldConfig` to `BaseFieldConfig`
- Add per-field-type admin config interfaces (empty initially)
- No breaking changes - existing code continues to work

### Phase 2: Admin Package Augmentation

- Create `augmentation.ts` with module augmentation
- Add full type definitions for admin configs
- Update field definitions to use augmented types

### Phase 3: Introspection API

- Implement `introspectCollection()` function
- Add `/admin/schema` API endpoint
- Include access control evaluation

### Phase 4: Field Renderer Registry

- Create `FieldRendererRegistry` class
- Register built-in renderers
- Implement resolver with priority/matching

### Phase 5: Simplified Admin Builder

- Create `CollectionBuilderV2` with introspection
- Update admin to use introspected schemas
- Deprecate (but keep) old `.fields()` method

### Phase 6: Migration Tools

- Create codemod for migrating existing `.fields()` configs
- Update documentation
- Release with migration guide

---

## Benefits

1. **Single Source of Truth** - Field config defined once on server
2. **Type Safety** - Full TypeScript support via module augmentation
3. **Less Boilerplate** - No need to re-define fields in admin
4. **Consistency** - Field names, types, validation automatically match
5. **Access Control** - Introspectable permissions for UI decisions
6. **Extensibility** - Custom field types and renderers via registries
7. **Backwards Compatible** - Old `.fields()` API still works as override
