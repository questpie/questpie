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
export interface FieldDefinition<
	TType extends string = string,
	TConfig extends BaseFieldConfig = BaseFieldConfig,
	TValue = unknown,
	TInput = TValue,
	TOutput = TValue,
	TColumn extends AnyPgColumn | null = AnyPgColumn | null,
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
	 * May return single column, multiple (e.g., polymorphic), or null (e.g., hasMany, virtual).
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
	 */
	getOperators(): ContextualOperators;

	/**
	 * Get metadata for admin introspection.
	 * Includes labels, descriptions, options, etc.
	 * Returns the appropriate FieldMetadata subtype based on field type.
	 */
	getMetadata(): FieldMetadata;

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
export interface FieldAccess {
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
	afterRead?: (value: TValue, ctx: FieldHookContext) => TValue | Promise<TValue>;

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
 */
export type OperatorFn<TValue = unknown> = (
	column: AnyPgColumn,
	value: TValue,
	ctx: QueryContext,
) => SQL;

/**
 * Map of operator name to function.
 */
export type OperatorMap = Record<string, OperatorFn | undefined>;

/**
 * Context-aware operators for both column and JSONB access.
 * System automatically selects appropriate variant based on field context.
 */
export interface ContextualOperators {
	/** Operators for direct column access */
	column: OperatorMap;

	/** Operators for JSONB path access */
	jsonb: OperatorMap;
}

// ============================================================================
// Field Metadata (for Introspection)
// ============================================================================

/**
 * Base metadata exposed for introspection.
 * Contains only data-relevant information - NO UI/admin config.
 * Admin package uses this to auto-generate UI, then applies its own overrides.
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
 * Relation field metadata
 */
export interface RelationFieldMetadata extends FieldMetadataBase {
	type: "relation";
	relationTarget: string;
	relationType: "belongsTo" | "hasMany" | "manyToMany";
}

/**
 * Polymorphic relation field metadata
 */
export interface PolymorphicRelationFieldMetadata extends FieldMetadataBase {
	type: "polymorphicRelation";
	relationType: "polymorphic";
	types: string[];
	typeField?: string;
	idField?: string;
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
 * Extensible via module augmentation for custom fields.
 */
export type FieldMetadata =
	| FieldMetadataBase
	| SelectFieldMetadata
	| RelationFieldMetadata
	| PolymorphicRelationFieldMetadata
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
export type InferInputType<TConfig extends BaseFieldConfig, TValue> =
	TConfig extends { virtual: true | SQL<unknown> }
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
export type InferOutputType<TConfig extends BaseFieldConfig, TValue> =
	TConfig extends { output: false }
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

/**
 * Generic FieldDefinition type for use when the specific field type is unknown.
 */
export type AnyFieldDefinition = FieldDefinition<
	string,
	BaseFieldConfig,
	unknown,
	unknown,
	unknown,
	AnyPgColumn | null
>;
