/**
 * Core Field Definition Types
 *
 * This module defines the core interfaces for the Field Builder system.
 * Each field type provides:
 * - Column generation for Drizzle
 * - Validation schema (Zod v4)
 * - Query operators (context-aware for column vs JSONB)
 * - Admin metadata for introspection
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

// ============================================================================
// Field Type Registry — Plugin-Extensible
// ============================================================================

declare global {
	namespace Questpie {
		interface FieldTypeRegistry {}
	}
}

/**
 * Open augmentation point for field type names.
 * Augment via `declare global { namespace Questpie { interface FieldTypeRegistry { ... } } }`
 */
export interface FieldTypeRegistry extends Questpie.FieldTypeRegistry {}

/**
 * Union of all registered field type names.
 * Falls back to `string` when no types are registered (empty FieldTypeRegistry).
 */
export type FieldType = [keyof FieldTypeRegistry] extends [never]
	? string
	: keyof FieldTypeRegistry;

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
export interface FieldHookContext<TConfig = Record<string, unknown>> {
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
// Collection Where Placeholder (branded type-level interpolation)
// ============================================================================

/**
 * Branded placeholder for operator param types that need cross-collection
 * resolution. Used as a type-level template variable:
 *
 *   operator<CollectionWherePlaceholder>(() => sql`TRUE`)
 *
 * When `FieldWhere` extracts operator param types, it passes this through.
 * The CRUD composition layer detects it and interpolates using the field's
 * config (which carries `to: "collection_name"`):
 *
 *   CollectionWherePlaceholder → Where<TargetCollection, TApp>
 *
 * This keeps the field as the single source of truth for what operators exist,
 * while letting the CRUD layer (which has `Where` + `TApp`) resolve the types.
 */
declare const __collectionWhereBrand: unique symbol;
export type CollectionWherePlaceholder = {
	readonly [__collectionWhereBrand]: true;
};

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
	meta?: Record<string, unknown>;
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
	/** Form layout for object fields (sections, tabs, grid). Added by admin plugin. */
	form?: { fields: unknown[] };
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
// Field Location
// ============================================================================

/**
 * Field location determines which table the field belongs to
 */
export type FieldLocation = "main" | "i18n" | "virtual" | "relation";

// ============================================================================
// Field Extraction Type Helpers
// ============================================================================

/**
 * Infer FieldLocation from FieldState properties.
 * - localized: true → "i18n"
 * - virtual: true + type: "relation" → "relation"
 * - virtual: true → "virtual"
 * - else → "main"
 */
export type InferLocationFromFieldState<
	TState extends import("./field-class-types.js").FieldState,
> = TState extends { localized: true }
	? "i18n"
	: TState extends { virtual: true; type: "relation" }
		? "relation"
		: TState extends { virtual: true }
			? "virtual"
			: "main";

/**
 * Extract fields by location from field definitions.
 */
export type ExtractFieldsByLocation<
	TFields extends Record<string, any>,
	TLocation extends FieldLocation,
> = {
	[K in keyof TFields as string extends K
		? never
		: number extends K
			? never
			: TFields[K] extends {
						readonly _: infer TState extends
							import("./field-class-types.js").FieldState;
				  }
				? InferLocationFromFieldState<TState> extends TLocation
					? K
					: never
				: never]: TFields[K];
};

/**
 * Extract main table fields (location: "main")
 */
export type ExtractMainFields<TFields extends Record<string, any>> =
	ExtractFieldsByLocation<TFields, "main">;

/**
 * Extract localized fields (location: "i18n")
 */
export type ExtractI18nFields<TFields extends Record<string, any>> =
	ExtractFieldsByLocation<TFields, "i18n">;

/**
 * Extract virtual fields (location: "virtual")
 */
export type ExtractVirtualFields<TFields extends Record<string, any>> =
	ExtractFieldsByLocation<TFields, "virtual">;

/**
 * Extract relation fields (location: "relation")
 */
export type ExtractRelationFields<TFields extends Record<string, any>> =
	ExtractFieldsByLocation<TFields, "relation">;
