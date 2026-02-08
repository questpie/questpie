/**
 * Build Field Definitions from Schema
 *
 * Maps server introspection schema to admin field definitions.
 * Used by AutoForm to dynamically render forms based on server schema
 * when explicit field config is not provided.
 */

import type {
  CollectionSchema,
  FieldMetadata,
  GlobalSchema,
  NestedFieldMetadata,
  RelationFieldMetadata,
  RelationSchema,
  SelectFieldMetadata,
} from "questpie";
import type { AnyAdminMeta } from "../../augmentation";
import type { FieldBuilder, FieldDefinition } from "../builder/field/field";
import { formatLabel } from "../lib/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Field registry type - maps field type names to FieldBuilder instances
 * This is what Admin.getFields() returns
 */
export type FieldRegistry = Record<string, FieldBuilder<any>>;

/**
 * Options for building field definitions
 */
export interface BuildFieldDefinitionsOptions {
  /**
   * Field names to exclude from generation
   */
  exclude?: string[];

  /**
   * Only generate these field names
   */
  include?: string[];

  /**
   * Override generated config for specific fields
   */
  overrides?: Record<string, Partial<Record<string, unknown>>>;
}

/**
 * Result of building field definitions
 */
export type FieldDefinitionsResult = Record<string, FieldDefinition>;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Build admin field definitions from server collection schema.
 *
 * Maps server field metadata to admin FieldDefinition objects:
 * - Uses `metadata.type` to look up field in registry
 * - Applies `metadata.meta.admin` overrides
 * - Handles relation type mapping (belongsTo -> single, hasMany -> multiple)
 *
 * @param schema - Collection schema from server introspection
 * @param registry - Field registry from admin config (admin.getFields())
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * // In a component with admin context
 * const admin = useAdminStore(selectAdmin);
 * const { data: schema } = useCollectionSchema("posts");
 * const fields = buildFieldDefinitionsFromSchema(
 *   schema,
 *   admin.getFields(),
 * );
 * ```
 */
export function buildFieldDefinitionsFromSchema(
  schema: CollectionSchema | GlobalSchema | null | undefined,
  registry: FieldRegistry,
  options: BuildFieldDefinitionsOptions = {},
): FieldDefinitionsResult {
  if (!schema) return {};

  const relations = "relations" in schema ? schema.relations : {};

  const result: FieldDefinitionsResult = {};

  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    // Skip excluded fields
    if (options.exclude?.includes(fieldName)) continue;

    // Skip if not in include list (when include is specified)
    if (options.include && !options.include.includes(fieldName)) continue;

    // Skip system fields that shouldn't be in forms
    if (isSystemField(fieldName)) continue;

    const fieldDef = buildFieldDefinition(
      fieldName,
      fieldSchema,
      relations,
      registry,
      options.overrides?.[fieldName],
    );

    if (fieldDef) {
      result[fieldName] = fieldDef;
    }
  }

  return result;
}

// ============================================================================
// Field Definition Builder
// ============================================================================

/**
 * Build a single field definition from schema
 */
function buildFieldDefinition(
  fieldName: string,
  fieldSchema: { metadata: FieldMetadata },
  relations: Record<string, RelationSchema>,
  registry: FieldRegistry,
  overrides?: Partial<Record<string, unknown>>,
): FieldDefinition | null {
  const { metadata } = fieldSchema;
  const fieldType = resolveFieldType(metadata);

  // Get field builder from registry
  const fieldBuilder = registry[fieldType];
  if (!fieldBuilder) {
    // Unknown field type - skip silently
    // Custom fields might not be registered in admin yet
    return null;
  }

  // Build field config from metadata
  const config = buildFieldConfig(
    fieldName,
    metadata,
    relations,
    registry,
    fieldType,
  );

  // Apply admin overrides from server meta
  // The meta.admin property is added via module augmentation on field-specific meta interfaces
  const adminConfig = (metadata.meta as { admin?: AnyAdminMeta } | undefined)
    ?.admin;
  if (adminConfig) {
    applyAdminConfig(config, adminConfig);
  }

  // Apply local overrides
  if (overrides) {
    Object.assign(config, overrides);
  }

  // Create field definition with options
  return fieldBuilder.$options(config);
}

/**
 * Build field config from metadata
 */
function buildFieldConfig(
  fieldName: string,
  metadata: FieldMetadata,
  relations: Record<string, RelationSchema>,
  registry: FieldRegistry,
  fieldType: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    label: metadata.label ?? formatLabel(fieldName),
    description: metadata.description,
    required: metadata.required,
    localized: metadata.localized,
    readOnly: metadata.readOnly,
  };

  // Apply validation constraints from base metadata
  if (metadata.validation) {
    Object.assign(config, metadata.validation);
  }

  // Handle field-type-specific config via type guard
  if (isSelectMetadata(metadata)) {
    applySelectConfig(config, metadata);
  } else if (isRelationMetadata(metadata)) {
    if (fieldType === "upload") {
      applyUploadConfig(config, metadata, relations[fieldName]);
    } else {
      applyRelationConfig(config, metadata, relations[fieldName]);
    }
  } else if (isNestedMetadata(metadata)) {
    applyNestedConfig(config, metadata, relations, registry);
  } else if (metadata.type === "richText") {
    applyRichTextConfig(config, metadata as unknown as Record<string, unknown>);
  }

  applyExtraMetadata(config, metadata);

  return config;
}

// ============================================================================
// Type Guards
// ============================================================================

function isSelectMetadata(m: FieldMetadata): m is SelectFieldMetadata {
  return m.type === "select";
}

function isRelationMetadata(m: FieldMetadata): m is RelationFieldMetadata {
  return m.type === "relation";
}

function isNestedMetadata(m: FieldMetadata): m is NestedFieldMetadata {
  return m.type === "object" || m.type === "array" || m.type === "blocks";
}

// ============================================================================
// Config Appliers (mutate config object)
// ============================================================================

/**
 * Apply select field config
 */
function applySelectConfig(
  config: Record<string, unknown>,
  metadata: SelectFieldMetadata,
): void {
  config.options = metadata.options.map((opt) => ({
    value: opt.value,
    label: opt.label ?? String(opt.value),
  }));
  if (metadata.multiple !== undefined) {
    config.multiple = metadata.multiple;
  }
}

/**
 * Apply relation field config
 */
function applyRelationConfig(
  config: Record<string, unknown>,
  metadata: RelationFieldMetadata,
  relationSchema?: RelationSchema,
): void {
  // Map relation type to single/multiple
  const isSingle = ["belongsTo", "morphTo"].includes(metadata.relationType);

  config.targetCollection = metadata.targetCollection;
  config.type = isSingle ? "single" : "multiple";
  // Pass through relation metadata for advanced use
  config.relationType = metadata.relationType;

  if (metadata.through ?? relationSchema?.through) {
    config.through = metadata.through ?? relationSchema?.through;
  }
  if (metadata.foreignKey ?? relationSchema?.foreignKey) {
    config.foreignKey = metadata.foreignKey ?? relationSchema?.foreignKey;
  }
}

function applyUploadConfig(
  config: Record<string, unknown>,
  metadata: RelationFieldMetadata,
  relationSchema?: RelationSchema,
): void {
  const isMultiple = [
    "hasMany",
    "manyToMany",
    "multiple",
    "morphMany",
  ].includes(metadata.relationType);

  config.to = metadata.targetCollection;
  config.multiple = isMultiple;

  if (metadata.through ?? relationSchema?.through) {
    config.through = metadata.through ?? relationSchema?.through;
  }
  if (metadata.foreignKey ?? relationSchema?.foreignKey) {
    config.foreignKey = metadata.foreignKey ?? relationSchema?.foreignKey;
  }
}

function applyNestedConfig(
  config: Record<string, unknown>,
  metadata: NestedFieldMetadata,
  relations: Record<string, RelationSchema>,
  registry: FieldRegistry,
): void {
  if (!metadata.nestedFields) return;

  if (metadata.type === "object") {
    const nestedDefs = buildNestedFieldDefinitions(
      metadata.nestedFields,
      relations,
      registry,
    );
    config.fields = () => nestedDefs;
    return;
  }

  if (metadata.type === "array") {
    const itemMetadata = metadata.nestedFields.item as
      | FieldMetadata
      | undefined;
    if (!itemMetadata) return;

    if (
      itemMetadata.type === "object" &&
      (itemMetadata as NestedFieldMetadata).nestedFields
    ) {
      const itemFields = buildNestedFieldDefinitions(
        (itemMetadata as NestedFieldMetadata).nestedFields ?? {},
        relations,
        registry,
      );
      config.item = () => itemFields;
      return;
    }

    const itemType = mapArrayItemType(itemMetadata.type);
    if (itemType) {
      config.itemType = itemType;
      if (itemMetadata.type === "select") {
        applySelectConfig(config, itemMetadata as SelectFieldMetadata);
      }
    }
  }
}

function applyExtraMetadata(
  config: Record<string, unknown>,
  metadata: FieldMetadata,
) {
  const reservedKeys = new Set([
    "type",
    "label",
    "description",
    "required",
    "localized",
    "readOnly",
    "writeOnly",
    "validation",
    "meta",
    "nestedFields",
    "features",
  ]);

  for (const [key, value] of Object.entries(
    metadata as unknown as Record<string, unknown>,
  )) {
    if (reservedKeys.has(key)) continue;
    if (key.startsWith("_")) continue;
    if (value === undefined) continue;
    config[key] = value;
  }
}

function applyRichTextConfig(
  config: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  if (metadata.maxCharacters !== undefined) {
    config.maxCharacters = metadata.maxCharacters;
    config.showCharacterCount = true;
  }
  if (metadata.placeholder !== undefined) {
    config.placeholder = metadata.placeholder;
  }
  if (metadata.allowImages !== undefined) {
    config.enableImages = metadata.allowImages;
  }
  if (metadata.imageCollection !== undefined) {
    config.imageCollection = metadata.imageCollection;
  }
}

function buildNestedFieldDefinitions(
  nestedFields: Record<string, FieldMetadata>,
  relations: Record<string, RelationSchema>,
  registry: FieldRegistry,
): FieldDefinitionsResult {
  const result: FieldDefinitionsResult = {};

  for (const [nestedName, nestedMetadata] of Object.entries(nestedFields)) {
    const fieldType = resolveFieldType(nestedMetadata);
    const fieldBuilder = registry[fieldType];
    if (!fieldBuilder) continue;

    const config = buildFieldConfig(
      nestedName,
      nestedMetadata,
      relations,
      registry,
      fieldType,
    );

    const adminConfig = (
      nestedMetadata.meta as { admin?: AnyAdminMeta } | undefined
    )?.admin;
    if (adminConfig) {
      applyAdminConfig(config, adminConfig);
    }

    result[nestedName] = fieldBuilder.$options(config);
  }

  return result;
}

function resolveFieldType(metadata: FieldMetadata): string {
  if (metadata.type === "relation") {
    const relationMeta = metadata as RelationFieldMetadata;
    // Check isUpload flag first (explicit marker from upload field)
    // Fallback to targetCollection === "assets" for backwards compatibility
    if (relationMeta.isUpload || relationMeta.targetCollection === "assets") {
      return "upload";
    }
  }
  return metadata.type;
}

function mapArrayItemType(type: string): string | null {
  const allowed = new Set(["text", "number", "email", "textarea", "select"]);
  return allowed.has(type) ? type : null;
}

/**
 * Apply admin config overrides from server meta.admin
 *
 * Since each field type has its own admin meta with only valid properties,
 * we simply copy all defined properties from adminConfig to config.
 */
function applyAdminConfig(
  config: Record<string, unknown>,
  adminConfig: AnyAdminMeta,
): void {
  // Copy all defined properties from admin config
  // Each field type's admin meta only contains valid properties for that type
  for (const [key, value] of Object.entries(adminConfig)) {
    if (value !== undefined) {
      config[key] = value;
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if a field is a system field that shouldn't be in forms
 */
function isSystemField(fieldName: string): boolean {
  const systemFields = [
    "id",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "_title",
    "_locale",
  ];
  return systemFields.includes(fieldName);
}

