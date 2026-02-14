/**
 * Field Type Selectors (V2)
 *
 * Pure type-level functions that extract concerns from FieldDefinition<TState>.
 * Each field "owns" its type resolution — the collection and CRUD layers
 * just compose these selectors.
 *
 * TApp acts as a type-level "store" (like Redux for types):
 *   TApp = { collections: { users: typeof users, posts: typeof posts, ... } }
 *
 * Any field can "select" from TApp to resolve cross-collection references.
 *
 * Three main selectors:
 *   FieldSelect<TFieldDef, TApp>         — "what value sits in the row?"
 *   FieldWhere<TFieldDef, TApp>          — "how do I filter on this field?"
 *   FieldRelationConfig<TFieldDef>       — "does this contribute to `with`?"
 */

import type {
	CollectionOptions,
	UploadOptions,
} from "#questpie/server/collection/builder/types.js";
import { datetimeField } from "#questpie/server/fields/builtin/datetime.js";
import { numberField } from "#questpie/server/fields/builtin/number.js";
import { textField } from "#questpie/server/fields/builtin/text.js";
import {
	createFieldDefinition,
	type InferSelectType,
} from "#questpie/server/fields/field.js";
import type {
	BaseFieldConfig,
	ExtractOperatorParamType,
	FieldDefinition,
	FieldDefinitionState,
} from "#questpie/server/fields/types.js";

// ============================================================================
// Relation Sub-type Inference
// ============================================================================

/**
 * Infer the relation sub-type from its config.
 * The field knows what kind of relation it is from its config alone.
 */
export type InferRelationSubtype<TConfig> = TConfig extends {
	morphName: string;
}
	? "morphMany"
	: TConfig extends { to: Record<string, any> }
		? "morphTo"
		: TConfig extends { hasMany: true; through: any }
			? "manyToMany"
			: TConfig extends { hasMany: true }
				? "hasMany"
				: TConfig extends { multiple: true }
					? "multiple"
					: "belongsTo";

// ============================================================================
// Relation FK Select — what value sits in the row for a relation field?
// ============================================================================

/**
 * Extract morphTo type discriminator keys from the `to` config.
 * e.g. { users: "users", posts: "posts" } → "users" | "posts"
 */
type MorphToTypeKeys<TConfig> = TConfig extends { to: infer TTo }
	? TTo extends Record<string, any>
		? Extract<keyof TTo, string>
		: string
	: string;

/**
 * Base FK type per relation sub-type (before nullable applied).
 * - belongsTo:  string (single UUID FK)
 * - multiple:   string[] (jsonb array of UUIDs)
 * - morphTo:    { type: "users" | "posts"; id: string } (type-safe discriminator)
 * - toMany:     never (no column on this table)
 */
type RelationFKBase<TConfig> =
	InferRelationSubtype<TConfig> extends "belongsTo"
		? string
		: InferRelationSubtype<TConfig> extends "multiple"
			? string[]
			: InferRelationSubtype<TConfig> extends "morphTo"
				? { type: MorphToTypeKeys<TConfig>; id: string }
				: never; // hasMany, manyToMany, morphMany → no FK column

/**
 * FK select type with nullable applied from config.
 * Returns `never` for toMany relations (they have no column).
 */
export type InferRelationFKSelect<TConfig> =
	RelationFKBase<TConfig> extends never
		? never
		: TConfig extends { required: true }
			? RelationFKBase<TConfig>
			: RelationFKBase<TConfig> | null;

// ============================================================================
// FieldSelect — "what value does this field contribute to a row?"
// ============================================================================

/** Unwrap factory functions: () => T → T, or pass through T */
type ResolveFieldConfig<T> = T extends (...args: any[]) => infer R ? R : T;

/** Build typed object shape from an object field's config.fields */
type ObjectFieldShape<TConfig, TApp> = TConfig extends { fields: infer TFields }
	? {
			[K in keyof ResolveFieldConfig<TFields>]: FieldSelect<
				ResolveFieldConfig<TFields>[K],
				TApp
			>;
		}
	: Record<string, unknown>;

/** Extract element type from an array field's config.of */
type ArrayFieldElement<TConfig, TApp> = TConfig extends { of: infer TOf }
	? FieldSelect<ResolveFieldConfig<TOf>, TApp>
	: unknown;

/**
 * Upload FK select type narrowed from config.
 * - Single upload (no through): string FK, nullability via InferSelectType
 * - Many-to-many upload (with through): never (no FK column, loaded via `with`)
 */
type InferUploadFKSelect<TConfig> = TConfig extends { through: string }
	? never
	: TConfig extends BaseFieldConfig
		? InferSelectType<TConfig, string>
		: string | null;

/**
 * Extract the select type for a single field.
 *
 * Dispatches on TState["type"]:
 *   "relation" → InferRelationFKSelect (narrowed per config)
 *   "upload"   → InferUploadFKSelect (string FK or never for m2m)
 *   "object"   → recursive ObjectFieldShape, nullability via InferSelectType
 *   "array"    → recursive ArrayFieldElement[], nullability via InferSelectType
 *   *          → TState["select"] (text→string, number→number, etc.)
 *
 * For object/array, we compute the concrete inner value type from config, then
 * delegate nullability to InferSelectType — the same path every other field uses.
 * This avoids duplicating the output/required/nullable/access.read logic.
 *
 * Returns `never` for fields that don't produce a column (hasMany, manyToMany, morphMany).
 * The collection-level type filters these out.
 *
 * Note: "blocks" fields use TState["select"] which is already the generic blocks type.
 * The app-aware block document type (BlocksSelectFromApp) is handled at the
 * collection level in crud/types.ts since it needs TApp context.
 */
export type FieldSelect<
	TFieldDef,
	_TApp = unknown,
> = TFieldDef extends FieldDefinition<infer TState>
	? TState extends FieldDefinitionState
		? TState["type"] extends "relation"
			? InferRelationFKSelect<TState["config"]>
			: TState["type"] extends "upload"
				? InferUploadFKSelect<TState["config"]>
				: TState["type"] extends "object"
					? InferSelectType<
							TState["config"],
							ObjectFieldShape<TState["config"], _TApp>
						>
					: TState["type"] extends "array"
						? InferSelectType<
								TState["config"],
								ArrayFieldElement<TState["config"], _TApp>[]
							>
						: TState["select"]
		: never
	: never;

// ============================================================================
// FieldWhere — "how do I filter on this field?"
// ============================================================================

/**
 * Extract the where clause type for a single field.
 *
 * Reads from TState["operators"]["column"] — each field owns its where operators.
 * For relation fields, returns the FK operators directly from the field's operators.
 * Relation filter operators (is, isNot, some, none) are added at the CRUD composition level.
 *
 * Returns `never` for fields that don't support filtering (blocks, toMany relations without FK).
 */
export type FieldWhere<
	TFieldDef,
	_TApp = unknown,
> = TFieldDef extends FieldDefinition<infer TState>
	? TState extends FieldDefinitionState
		? TState extends { operators: { column: infer TColumnOps } }
			? TState["type"] extends "blocks"
				? never // blocks don't support where
				: TColumnOps extends Record<string, any>
					? {
							[K in keyof TColumnOps]?: ExtractOperatorParamType<TColumnOps[K]>;
						}
					: never
			: never // no operators = not queryable
		: never
	: never;

// ============================================================================
// System Field Instances — real field definitions, not phantom types
// ============================================================================

/**
 * System field definitions created from real field factories.
 * Operators, select types, input types — all inferred automatically.
 *
 * These are runtime values whose *types* are used by AutoInsertedFields.
 * Using real factories means the type system infers operators from getOperators().
 */

/** id: text, required, has default */
const _systemIdField = createFieldDefinition(textField, {
	required: true,
	default: () => "",
} as const);

/** _title: text, required, virtual (computed) */
const _systemTitleField = createFieldDefinition(textField, {
	required: true,
	virtual: true,
} as const);

/** createdAt / updatedAt: datetime, required, has default */
const _systemTimestampField = createFieldDefinition(datetimeField, {
	required: true,
	default: () => new Date(),
} as const);

/** deletedAt: datetime, nullable */
const _systemNullableTimestampField = createFieldDefinition(
	datetimeField,
	{} as const,
);

/** Upload text fields (key, filename, mimeType): text, required */
const _systemUploadTextField = createFieldDefinition(textField, {
	required: true,
} as const);

/** Upload size field: number, required */
const _systemUploadNumberField = createFieldDefinition(numberField, {
	required: true,
} as const);

/** Upload visibility field: text, required, default "public" — public/private enum stored as text */
const _systemUploadVisibilityField = createFieldDefinition(textField, {
	required: true,
	default: "public",
} as const);

// Extract types from real field instances
type IdField = typeof _systemIdField;
type TitleField = typeof _systemTitleField;
type TimestampField = typeof _systemTimestampField;
type NullableTimestampField = typeof _systemNullableTimestampField;
type UploadTextField = typeof _systemUploadTextField;
type UploadNumberField = typeof _systemUploadNumberField;
type UploadVisibilityField = typeof _systemUploadVisibilityField;

// ============================================================================
// Auto-Inserted Fields — system fields as real FieldDefinitions
// ============================================================================

/**
 * System fields auto-inserted into fieldDefinitions by the collection builder.
 * Only inserts fields not already defined by the user.
 *
 * - id:        always (unless user defines their own)
 * - _title:    always
 * - createdAt: unless options.timestamps === false
 * - updatedAt: unless options.timestamps === false
 * - deletedAt: only if options.softDelete === true
 * - upload:    only if upload options are set
 */
export type AutoInsertedFields<
	TUserFields extends Record<string, any>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined,
> = ("id" extends keyof TUserFields // id — skip if user defined their own
	? {}
	: { readonly id: IdField }) &
	// _title — always
	("_title" extends keyof TUserFields ? {} : { readonly _title: TitleField }) &
	// timestamps — unless disabled
	(TOptions extends { timestamps: false }
		? {}
		: ("createdAt" extends keyof TUserFields
				? {}
				: {
						readonly createdAt: TimestampField;
					}) &
				("updatedAt" extends keyof TUserFields
					? {}
					: {
							readonly updatedAt: TimestampField;
						})) &
	// softDelete
	(TOptions extends { softDelete: true }
		? "deletedAt" extends keyof TUserFields
			? {}
			: {
					readonly deletedAt: NullableTimestampField;
				}
		: {}) &
	// upload fields
	(TUpload extends UploadOptions
		? ("key" extends keyof TUserFields
				? {}
				: {
						readonly key: UploadTextField;
					}) &
				("filename" extends keyof TUserFields
					? {}
					: {
							readonly filename: UploadTextField;
						}) &
				("mimeType" extends keyof TUserFields
					? {}
					: {
							readonly mimeType: UploadTextField;
						}) &
				("size" extends keyof TUserFields
					? {}
					: {
							readonly size: UploadNumberField;
						}) &
				("visibility" extends keyof TUserFields
					? {}
					: {
							readonly visibility: UploadVisibilityField;
						})
		: {});

/**
 * Merges user-defined field definitions with auto-inserted system fields.
 * User fields always win — if user defines `id`, the auto-inserted one is skipped.
 */
export type FieldDefinitionsWithSystem<
	TUserFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined,
> = AutoInsertedFields<TUserFields, TOptions, TUpload> & TUserFields;
