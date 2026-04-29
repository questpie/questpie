/**
 * Field Type Selectors
 *
 * Pure type-level functions that extract concerns from field definitions.
 * Each field "owns" its type resolution — the collection and CRUD layers
 * just compose these selectors.
 *
 * Dispatches via Field<TState> phantom `_` property.
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
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import { number } from "#questpie/server/modules/core/fields/number.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import type {
	ExtractOperatorParamType,
	OperatorMap,
} from "#questpie/server/fields/types.js";

// ============================================================================
// Field Select — dispatch via accumulated state properties
// ============================================================================

/**
 * Extract select type from Field<TState>.
 *
 * State encodes everything directly:
 * - virtual relations/uploads → never (no FK column)
 * - output: false → never
 * - notNull: true → data type
 * - else → data | null
 */
type V2FieldSelect<TState extends FieldState> =
	// Virtual relation/upload fields have no FK column
	TState extends { virtual: true; type: "relation" | "upload" }
		? never
		: TState extends { output: false }
			? never
			: TState extends { notNull: true }
				? TState["data"]
				: TState["data"] | null;

/**
 * Extract where clause type from Field<TState>.
 * Reads operators from the OperatorSetDefinition on TState.
 */
type V2FieldWhere<TState extends FieldState> = TState extends {
	operators: { column: infer TColumnOps extends OperatorMap };
}
	? {
			[K in keyof TColumnOps]?: ExtractOperatorParamType<TColumnOps[K]>;
		}
	: never;

// ============================================================================
// FieldSelect — "what value does this field contribute to a row?"
// ============================================================================

/**
 * Extract the select type for a single field.
 *
 * Dispatches via Field<TState> phantom `_` property.
 */
export type FieldSelect<TFieldDef, _TApp = unknown> = TFieldDef extends {
	readonly _: infer TState extends FieldState;
}
	? V2FieldSelect<TState>
	: never;

// ============================================================================
// FieldWhere — "how do I filter on this field?"
// ============================================================================

/**
 * Extract the where clause type for a single field.
 *
 * Dispatches via Field<TState> operators from OperatorSetDefinition.
 */
export type FieldWhere<TFieldDef, _TApp = unknown> = TFieldDef extends {
	readonly _: infer TState extends FieldState;
}
	? V2FieldWhere<TState>
	: never;

// ============================================================================
// System Field Instances
// ============================================================================

/**
 * System field definitions.
 * Operators, select types, input types — all inferred from Field<TState>.
 */

/** id: text, required, has default */
const _systemIdField = text()
	.required()
	.default(() => "");

/** _title: text, required, virtual (computed) */
const _systemTitleField = text().required().virtual();

/** createdAt / updatedAt: datetime, required, has default */
const _systemTimestampField = datetime()
	.required()
	.default(() => new Date());

/** deletedAt: datetime, nullable */
const _systemNullableTimestampField = datetime();

/** Upload text fields (key, filename, mimeType): text, required */
const _systemUploadTextField = text().required();

/** Upload size field: number, required */
const _systemUploadNumberField = number().required();

/** Upload visibility field: text, required, default "public" */
const _systemUploadVisibilityField = text()
	.required()
	.default("public" as const);

// Extract types from real field instances
type IdField = typeof _systemIdField;
type TitleField = typeof _systemTitleField;
type TimestampField = typeof _systemTimestampField;
type NullableTimestampField = typeof _systemNullableTimestampField;
type UploadTextField = typeof _systemUploadTextField;
type UploadNumberField = typeof _systemUploadNumberField;
type UploadVisibilityField = typeof _systemUploadVisibilityField;

// ============================================================================
// Auto-Inserted Fields — system fields as real Field instances
// ============================================================================

/**
 * System fields auto-inserted into fieldDefinitions by the collection builder.
 * Only inserts fields not already defined by the user.
 */
type BaseSystemFields = {
	readonly id: IdField;
	readonly _title: TitleField;
};

type TimestampSystemFields<TOptions extends CollectionOptions> =
	TOptions extends { timestamps: false }
		? {}
		: {
				readonly createdAt: TimestampField;
				readonly updatedAt: TimestampField;
			};

type SoftDeleteSystemFields<TOptions extends CollectionOptions> =
	TOptions extends { softDelete: true }
		? {
				readonly deletedAt: NullableTimestampField;
			}
		: {};

type UploadSystemFields<TUpload extends UploadOptions | undefined> =
	TUpload extends UploadOptions
		? {
				readonly key: UploadTextField;
				readonly filename: UploadTextField;
				readonly mimeType: UploadTextField;
				readonly size: UploadNumberField;
				readonly visibility: UploadVisibilityField;
			}
		: {};

type AllSystemFields<
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined,
> = BaseSystemFields &
	TimestampSystemFields<TOptions> &
	SoftDeleteSystemFields<TOptions> &
	UploadSystemFields<TUpload>;

export type AutoInsertedFields<
	TUserFields extends Record<string, any>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined,
> = {
	readonly [K in keyof AllSystemFields<
		TOptions,
		TUpload
	> as K extends keyof TUserFields ? never : K]: AllSystemFields<
		TOptions,
		TUpload
	>[K];
};

/**
 * Merges user-defined field definitions with auto-inserted system fields.
 */
export type FieldDefinitionsWithSystem<
	TUserFields extends Record<string, any>,
	TOptions extends CollectionOptions,
	TUpload extends UploadOptions | undefined,
> = AutoInsertedFields<TUserFields, TOptions, TUpload> & TUserFields;

// ============================================================================
// Global Auto-Inserted Fields
// ============================================================================

type GlobalAutoInsertedFields<
	TUserFields extends Record<string, any>,
	TOptions extends { timestamps?: boolean },
> = ("id" extends keyof TUserFields ? {} : { readonly id: IdField }) &
	(TOptions extends { timestamps: false }
		? {}
		: ("createdAt" extends keyof TUserFields
				? {}
				: { readonly createdAt: TimestampField }) &
				("updatedAt" extends keyof TUserFields
					? {}
					: { readonly updatedAt: TimestampField }));

export type GlobalFieldDefinitionsWithSystem<
	TUserFields extends Record<string, any>,
	TOptions extends { timestamps?: boolean },
> = GlobalAutoInsertedFields<TUserFields, TOptions> & TUserFields;
