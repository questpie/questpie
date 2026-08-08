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
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type {
	ArrayWhereInput,
	ElementWhereValueOf,
} from "#questpie/server/fields/operators/builtin.js";
import type {
	OperatorMap,
	OperatorsToWhereInput,
} from "#questpie/server/fields/types.js";
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import { number } from "#questpie/server/modules/core/fields/number.js";
import { text } from "#questpie/server/modules/core/fields/text.js";

// ============================================================================
// Field Select — dispatch via accumulated state properties
// ============================================================================

/** Local `any` guard — keeps the selector self-contained (no test-util dep). */
type _IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Extract select type from Field<TState>.
 *
 * State encodes everything directly:
 * - state itself is `any` (a `Field<any>` def) → never (no information-free `any` leak)
 * - virtual relations/uploads → never (no FK column)
 * - output: false → never
 * - notNull: true → data type
 * - else → data | null
 *
 * NOTE: a bare `FieldState` (concrete state, `data: unknown`) is left to resolve
 * to `unknown | null` — internal CRUD operates on erased `Field<FieldState>`
 * definitions and relies on that shape; only the `any`-state leak is sealed.
 */
type V2FieldSelect<TState extends FieldState> =
	_IsAny<TState> extends true
		? never
		: // Virtual relation/upload fields have no FK column
			TState extends { virtual: true; type: "relation" | "upload" }
			? never
			: TState extends { output: false }
				? never
				: TState extends { notNull: true }
					? TState["data"]
					: TState["data"] | null;

/**
 * Extract where clause type from Field<TState>.
 *
 * A field's where-input value is DECOUPLED from its stored `data` (CL-07):
 *
 *  1. When the field declares a `whereInput` map (op-name → filter value) it is
 *     the source of truth (a select → its literal union, a typed json → its
 *     shape), keyed straight through as `{ [K]?: whereInput[K] }`.
 *  2. An `.array()` field derives its where-input LAZILY from its `innerState` —
 *     `ArrayWhereInput` keyed off the inner element's scalar filter value, so a
 *     `number[]` filters on `number` and a `datetime().array()` on `DateInput`
 *     (NOT the stored `Date[]`). Deriving here, only on the where path, keeps the
 *     element-value dig OUT of every array field's eager state intersection.
 *  3. Otherwise we derive values from the OperatorSetDefinition on `operators`
 *     (text/number/date/boolean/relation — dates stay `DateInput`). Delegating
 *     that arm to OperatorsToWhereInput keeps the (exact-key) operator→input map
 *     instantiated once per distinct operator SET (~10 exist), not per field.
 */
type V2FieldWhere<TState extends FieldState> = TState extends {
	whereInput: infer TWhere extends Record<string, unknown>;
}
	? { [K in keyof TWhere]?: TWhere[K] }
	: TState extends { isArray: true; innerState: infer TInner }
		? {
				[K in keyof ArrayWhereInput<
					ElementWhereValueOf<TInner>
				>]?: ArrayWhereInput<ElementWhereValueOf<TInner>>[K];
			}
		: TState extends {
					operators: { column: infer TColumnOps extends OperatorMap };
			  }
			? OperatorsToWhereInput<TColumnOps>
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

/** revision: framework-owned canonical row revision */
const _systemRevisionField = number().required().default(1);

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
type RevisionField = typeof _systemRevisionField;
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
	(TOptions extends { optimisticConcurrency: true }
		? { readonly revision: RevisionField }
		: {}) &
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
	TOptions extends { timestamps?: boolean; optimisticConcurrency?: true },
> = ("id" extends keyof TUserFields ? {} : { readonly id: IdField }) &
	(TOptions extends { timestamps: false }
		? {}
		: ("createdAt" extends keyof TUserFields
				? {}
				: { readonly createdAt: TimestampField }) &
				("updatedAt" extends keyof TUserFields
					? {}
					: { readonly updatedAt: TimestampField })) &
	(TOptions extends { optimisticConcurrency: true }
		? { readonly revision: RevisionField }
		: {});

export type GlobalFieldDefinitionsWithSystem<
	TUserFields extends Record<string, any>,
	TOptions extends { timestamps?: boolean; optimisticConcurrency?: true },
> = GlobalAutoInsertedFields<TUserFields, TOptions> & TUserFields;
