/**
 * Core Field Definition Types
 *
 * This module defines the core interfaces for the Field Builder system.
 * Each field type implements FieldDefinition to provide:
 * - Column generation for Drizzle
 * - Validation schema (Zod v4)
 * - Query operators (context-aware for column vs JSONB)
 * - Admin metadata for introspection
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";

// ============================================================================
// Core Field Definition Interface
// ============================================================================

/**
 * Core field definition interface using TState pattern.
 * Each field type implements this to provide:
 * - Column generation for Drizzle
 * - Validation schema (Zod v4 - JSON Schema derived via z.toJSONSchema())
 * - Query operators (context-aware for column vs JSONB)
 * - Admin metadata
 * - Field location (main, i18n, virtual, relation)
 *
 * Type parameter:
 * - TState: FieldDefinitionState containing all type information
 */
export interface FieldDefinition<TState extends FieldDefinitionState> {
	/** Field state - contains all type and configuration information */
	readonly state: TState;

	/** Phantom types for inference - used by collection $infer */
	readonly $types: {
		value: TState["value"];
		input: TState["input"];
		output: TState["output"];
		select: TState["select"];
		column: TState["column"];
		location: TState["location"];
	};

	/**
	 * Generate Drizzle column(s) for this field.
	 * May return single column, multiple (e.g., polymorphic), or null (e.g., virtual, relation).
	 */
	toColumn(name: string): TState["column"] | TState["column"][] | null;

	/**
	 * Generate Zod schema for input validation.
	 * JSON Schema is derived automatically via Zod v4's z.toJSONSchema().
	 * Supports async refinements for server-side validation.
	 *
	 * NOTE: toJsonSchema() is NOT needed on fields!
	 * Zod v4 provides z.toJSONSchema(schema) to convert any Zod schema.
	 * This is used at collection level to generate client validation schemas.
	 */
	toZodSchema(): ZodType<TState["input"]>;

	/**
	 * Get operators for query builder.
	 * Returns context-aware operators for both column and JSONB access.
	 * System automatically selects appropriate variant based on field context.
	 */
	getOperators(): TState["operators"];

	/**
	 * Get metadata for admin introspection.
	 * Includes labels, descriptions, options, etc.
	 * Returns the appropriate FieldMetadata subtype based on field type.
	 */
	getMetadata(): FieldMetadata;

	/**
	 * Optional: Get nested fields (for object/array types).
	 */
	getNestedFields?(): Record<string, FieldDefinition<FieldDefinitionState>>;

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
	fromDb?(dbValue: unknown): TState["value"];

	/**
	 * Optional: Transform value before writing to DB.
	 */
	toDb?(value: TState["input"]): unknown;
}

// ============================================================================
// Base Field Configuration
// ============================================================================

/**
 * Common configuration options for all field types.
 *
 * NOTE: NO admin/UI config here! BE fields are purely data-focused.
 * Admin package handles all UI concerns via its own override system.
 */
export interface BaseFieldConfig {
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

	// NOTE: unique, index, searchable REMOVED from field config!
	// These are collection-level concerns, not field-level:
	// - Use .indexes() on CollectionBuilder for unique/index constraints
	// - Use .searchable() on CollectionBuilder for search indexing
	// See: specifications/DECOUPLED_ARCHITECTURE.md

	/**
	 * Field-level access control.
	 * If access has functions (not just `true`), output type becomes optional.
	 */
	access?: FieldDefinitionAccess;

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

	// NOTE: `meta` is NOT defined here!
	// Each field type defines its own `meta?: XFieldMeta` with field-specific options.
	// External packages (like @questpie/admin) augment each field's meta interface
	// to add their own configuration (e.g., admin UI options).
	//
	// Example in text field:
	//   interface TextFieldMeta { /* base text options */ }
	//   // Admin augments:
	//   interface TextFieldMeta { admin?: { placeholder?: string } }
}

// ============================================================================
// Field Access Control
// ============================================================================

/**
 * Context provided to field-level access control functions.
 */
export interface FieldAccessContext {
	/** Current request */
	req: Request;

	/** Authenticated user (if any) */
	user?: unknown;

	/** Current document (for update/read) */
	doc?: Record<string, unknown>;

	/** Operation type */
	operation: "create" | "read" | "update" | "delete";
}

/**
 * Field-level access control for field definitions.
 * Evaluated at runtime to determine if user can access field.
 *
 * Type implications:
 * - If any access property is a function (not `true`), output becomes optional
 *   because the field might be filtered at runtime.
 * - `true` = always allowed, no type change
 * - `false` = never allowed (same as input: false / output: false)
 * - Function = runtime check, output becomes TOutput | undefined
 */
export interface FieldDefinitionAccess {
	/**
	 * Can read this field?
	 * If function returns false, field is omitted from response.
	 * @default true
	 */
	read?: boolean | ((ctx: FieldAccessContext) => boolean | Promise<boolean>);

	/**
	 * Can set this field on create?
	 * If false, field is removed from input before save.
	 * @default true
	 */
	create?: boolean | ((ctx: FieldAccessContext) => boolean | Promise<boolean>);

	/**
	 * Can update this field?
	 * If false, field changes are ignored on update.
	 * @default true
	 */
	update?: boolean | ((ctx: FieldAccessContext) => boolean | Promise<boolean>);
}

// ============================================================================
// Field Hooks
// ============================================================================

/**
 * Context provided to field hooks.
 */
export interface FieldHookContext<TConfig = BaseFieldConfig> {
	/** Field name */
	field: string;

	/** Collection name */
	collection: string;

	/** Operation type */
	operation: "create" | "read" | "update";

	/** Current request */
	req: Request;

	/** Authenticated user */
	user?: unknown;

	/** Full document (other fields) */
	doc: Record<string, unknown>;

	/** Original value (for update) */
	originalValue?: unknown;

	/** Database client (for async validation) */
	db: unknown;

	/** Field configuration (for accessing field-specific options in hooks) */
	config: TConfig;
}

/**
 * Field-level hooks.
 * Hooks transform or validate values but DON'T change the type.
 * Return type must match input type.
 */
export interface FieldHooks<TValue = unknown> {
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

// ============================================================================
// Operators
// ============================================================================

/**
 * Query context provided to operators.
 */
export interface QueryContext {
	/** JSONB path for nested field access */
	jsonbPath?: string[];

	/** Current locale for i18n queries */
	locale?: string;

	/** Database instance */
	db?: unknown;
}

/**
 * Operator function type.
 * Generates SQL condition from column and value.
 *
 * @template TValue - The value type this operator accepts
 * @template TResult - The SQL result type (defaults to boolean for WHERE conditions)
 */
export type OperatorFn<TValue = unknown, TResult = boolean> = (
	column: AnyPgColumn,
	value: TValue,
	ctx: QueryContext,
) => SQL<TResult>;

/**
 * Helper to create a typed operator function.
 * Makes the value type explicit and ensures proper type inference.
 *
 * @example
 * ```ts
 * const textOps = {
 *   eq: operator<string>((col, value) => eq(col, value)),
 *   contains: operator<string>((col, value) =>
 *     sql<boolean>`${col} LIKE '%' || ${value} || '%'`
 *   ),
 * };
 * ```
 */
export function operator<TValue, TResult = boolean>(
	fn: (col: AnyPgColumn, value: TValue, ctx: QueryContext) => SQL<TResult>,
): OperatorFn<TValue, TResult> {
	return fn;
}

/**
 * Map of operator name to function.
 */
export type OperatorMap = Record<string, OperatorFn<any, any> | undefined>;

/**
 * Context-aware operators for both column and JSONB access.
 * System automatically selects appropriate variant based on field context.
 *
 * @template TColumnOps - Column operator map type (for type inference)
 * @template TJsonbOps - JSONB operator map type (for type inference)
 */
export interface ContextualOperators<
	TColumnOps extends OperatorMap = OperatorMap,
	TJsonbOps extends OperatorMap = OperatorMap,
> {
	/** Operators for direct column access */
	column: TColumnOps;

	/** Operators for JSONB path access */
	jsonb: TJsonbOps;
}

// ============================================================================
// Common Operator Sets
// ============================================================================

/**
 * Extract the parameter type from an operator function.
 */
export type ExtractOperatorParamType<TFn> =
	TFn extends OperatorFn<infer TValue, any> ? TValue : never;

/**
 * Convert operator map to where input type (operator keys → parameter types).
 */
export type OperatorsToWhereInput<TOps extends OperatorMap> = {
	[K in keyof TOps]?: ExtractOperatorParamType<TOps[K]>;
};

// ============================================================================
// Field Metadata (for Introspection)
// ============================================================================

/**
 * Base metadata interface - shared across all field types.
 *
 * NOTE: This is NOT used directly! Each field type defines its own meta interface
 * that can be augmented by external packages.
 *
 * Pattern:
 * 1. Field defines: `interface TextFieldMeta {}`
 * 2. Admin augments: `interface TextFieldMeta { admin?: { placeholder?: string } }`
 * 3. Field config uses: `meta?: TextFieldMeta`
 *
 * This allows type-safe, field-specific admin configuration.
 *
 * @deprecated Use field-specific meta interfaces (TextFieldMeta, BooleanFieldMeta, etc.)
 */
export type FieldMetadataMeta = {};

/**
 * Base metadata exposed for introspection.
 * Contains only data-relevant information - NO UI/admin config.
 * Admin package uses this to auto-generate UI, then applies its own overrides.
 *
 * NOTE: unique and searchable REMOVED!
 * These are collection-level concerns handled by:
 * - .indexes() for unique constraints
 * - .searchable() for search indexing
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

	/**
	 * Extensible metadata for external packages.
	 * Augmented by packages like @questpie/admin to add UI configuration.
	 */
	meta?: FieldMetadataMeta;
}

/**
 * Select field metadata
 */
export interface SelectFieldMetadata extends FieldMetadataBase {
	type: "select";
	options: Array<{ value: string | number; label: I18nText }>;
	multiple?: boolean;
}

/**
 * Inferred relation type.
 */
export type InferredRelationType =
	| "belongsTo"
	| "hasMany"
	| "manyToMany"
	| "multiple"
	| "morphTo"
	| "morphMany";

/**
 * Referential action for FK constraints.
 */
export type ReferentialAction =
	| "cascade"
	| "set null"
	| "restrict"
	| "no action";

/**
 * Relation field metadata (unified - includes polymorphic).
 */
export interface RelationFieldMetadata extends FieldMetadataBase {
	type: "relation";
	relationType: InferredRelationType;
	/** Target collection name(s) - array for polymorphic, "__deferred__" if lazy */
	targetCollection: string | string[];
	/** FK column name on target (for hasMany) */
	foreignKey?: string;
	/** Junction collection name (for manyToMany), "__deferred__" if lazy */
	through?: string;
	/** Source field on junction */
	sourceField?: string;
	/** Target field on junction */
	targetField?: string;
	/** MorphTo field name (for morphMany) */
	morphName?: string;
	/** Type value for morphMany */
	morphType?: string;
	/** On delete action */
	onDelete?: ReferentialAction;
	/** On update action */
	onUpdate?: ReferentialAction;
	/** Relation name for disambiguation */
	relationName?: string;
	/**
	 * Indicates this is an upload field (file/asset relation).
	 * When true, admin UI should render upload component instead of relation picker.
	 * This flag enables reliable detection regardless of target collection name.
	 */
	isUpload?: boolean;
	/** Internal: Original config.to for runtime resolution */
	_toConfig?: unknown;
	/** Internal: Original config.through for runtime resolution */
	_throughConfig?: unknown;
}

/**
 * Object/Array field metadata
 */
export interface NestedFieldMetadata extends FieldMetadataBase {
	type: "object" | "array" | "blocks";
	nestedFields?: Record<string, FieldMetadata>;
}

/**
 * Union type of all field metadata types.
 * Custom fields can use FieldMetadataBase which has `type: string`.
 *
 * TODO: Consider making this extensible via a registry pattern:
 * ```ts
 * export interface FieldMetadataRegistry {
 *   base: FieldMetadataBase;
 *   select: SelectFieldMetadata;
 *   relation: RelationFieldMetadata;
 *   nested: NestedFieldMetadata;
 * }
 * export type FieldMetadata = FieldMetadataRegistry[keyof FieldMetadataRegistry];
 * // Then external packages can augment FieldMetadataRegistry
 * ```
 */
export type FieldMetadata =
	| FieldMetadataBase
	| SelectFieldMetadata
	| RelationFieldMetadata
	| NestedFieldMetadata;

// ============================================================================
// Select/Join Modifiers (for advanced fields like relations)
// ============================================================================

/**
 * Modifier for SELECT clause.
 * Used by computed/virtual fields to add expressions.
 */
export interface SelectModifier {
	/** SQL expression to add to SELECT */
	expression: SQL;

	/** Alias for the expression */
	alias: string;
}

/**
 * Builder for JOIN clauses.
 * Used by relation fields to build joins.
 */
export interface JoinBuilder {
	/** Target table name */
	table: string;

	/** Join type */
	type: "inner" | "left" | "right";

	/** Join condition */
	on: SQL;
}

// ============================================================================
// Type Inference Helpers
// ============================================================================

/**
 * Infer input type from field config.
 * Handles required, nullable, virtual, input options.
 */
export type InferInputType<
	TConfig extends BaseFieldConfig,
	TValue,
> = TConfig extends { virtual: true | SQL<unknown> }
	? TConfig extends { input: true }
		? TValue | undefined // Explicitly enabled input for virtual
		: never // Default: no input for virtual
	: TConfig extends { input: false }
		? never
		: TConfig extends { input: "optional" }
			? TValue | undefined
			: TConfig extends { required: true }
				? TValue
				: TValue | null | undefined;

/**
 * Infer output type from field config.
 * Handles output: false and access.read functions.
 */
export type InferOutputType<
	TConfig extends BaseFieldConfig,
	TValue,
> = TConfig extends { output: false }
	? never
	: TConfig extends { access: { read: (...args: unknown[]) => unknown } }
		? TValue | undefined // Runtime check = might be filtered
		: TValue;

/**
 * Infer column type from field config.
 * Virtual fields have null columns.
 */
export type InferColumnType<
	TConfig extends BaseFieldConfig,
	TColumn,
> = TConfig extends { virtual: true | SQL<unknown> } ? null : TColumn;

// ============================================================================
// Field Definition Generic Type
// ============================================================================

// ============================================================================
// Field Definition State (TState Pattern)
// ============================================================================

/**
 * Field location determines which table the field belongs to
 */
export type FieldLocation = "main" | "i18n" | "virtual" | "relation";

/**
 * Core field definition state interface.
 * Uses TState pattern for better type composition and extensibility.
 *
 * Similar to CollectionBuilderState - accumulates field configuration
 * through the type system for precise inference.
 */
export interface FieldDefinitionState {
	/** Field type identifier (e.g., "text", "number", "relation") */
	type: string;

	/** Field configuration - any config extending BaseFieldConfig */
	config: Record<string, any>;

	/** Base runtime value type */
	value: unknown;

	/** Input type for create/update (affected by required, default, etc.) */
	input: unknown;

	/** Output type for select (affected by output, access, etc.) */
	output: unknown;

	/** Select type for CRUD (defaults to output when not overridden) */
	select: unknown;

	/** Drizzle column type (null for virtual/relation fields) */
	column: AnyPgColumn | null;

	/** Field location - determines which table the field belongs to */
	location: FieldLocation;

	/** Field operators for WHERE clause (column + jsonb variants) */
	operators: ContextualOperators<any, any>;

	/** Optional: Field metadata for introspection */
	metadata?: FieldMetadata;
}

/**
 * Empty field state for initialization
 */
export type EmptyFieldState = {
	type: string;
	config: BaseFieldConfig;
	value: unknown;
	input: unknown;
	output: unknown;
	select: unknown;
	column: AnyPgColumn | null;
	location: "main";
};

// ============================================================================
// Field Extraction Type Helpers (for unified .fields() API)
// ============================================================================

/**
 * Extract fields by location from field definitions.
 * Used to separate main table fields, i18n fields, virtual fields, and relations.
 */
export type ExtractFieldsByLocation<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TLocation extends FieldLocation,
> = {
	[K in keyof TFields as TFields[K] extends FieldDefinition<infer TState>
		? TState["location"] extends TLocation
			? K
			: never
		: never]: TFields[K];
};

/**
 * Extract main table fields (location: "main")
 */
export type ExtractMainFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = ExtractFieldsByLocation<TFields, "main">;

/**
 * Extract localized fields (location: "i18n")
 */
export type ExtractI18nFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = ExtractFieldsByLocation<TFields, "i18n">;

/**
 * Extract virtual fields (location: "virtual")
 */
export type ExtractVirtualFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = ExtractFieldsByLocation<TFields, "virtual">;

/**
 * Extract relation fields (location: "relation")
 */
export type ExtractRelationFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = ExtractFieldsByLocation<TFields, "relation">;

/**
 * Extract column types from field definitions.
 * Maps each field to its Drizzle column type.
 */
export type ExtractColumnsFromFields<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFields as TFields[K] extends FieldDefinition<infer TState>
		? TState["column"] extends null
			? never // Skip virtual/relation fields
			: K
		: never]: TFields[K] extends FieldDefinition<infer TState>
		? TState["column"]
		: never;
};

/**
 * Generic FieldDefinition type for use when the specific field type is unknown.
 * Uses a default FieldDefinitionState with all unknown types.
 *
 * NOTE: `config` uses `Record<string, any>` (matching FieldDefinitionState)
 * to allow any field config to be assigned. This avoids requiring casts when
 * using specialized configs like ObjectFieldConfig or ArrayFieldConfig which
 * have required properties (`fields`, `of`) not present in BaseFieldConfig.
 */
export type AnyFieldDefinition = FieldDefinition<{
	type: string;
	config: Record<string, any>;
	value: unknown;
	input: unknown;
	output: unknown;
	select: unknown;
	column: AnyPgColumn | null;
	location: FieldLocation;
	operators: ContextualOperators<any, any>;
}>;
