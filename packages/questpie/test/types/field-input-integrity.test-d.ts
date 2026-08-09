/**
 * Field & Input Integrity Type Tests (type-supremacy Wave A, lane C)
 *
 * Covers:
 * 1. `.default()` value constrained to the field's data type (Drizzle-identical)
 * 2. Field hooks values typed to the field's data type
 * 3. Sealed operator maps — unknown where operators are compile errors
 * 4. `create({})` integrity on relation-less collections (inert relations fallback)
 * 5. `SelectResult` columns omission mode (TrueKeys/FalseKeys split, id pinned)
 *
 * Run with: bunx tsc --noEmit
 */

import { sql } from "drizzle-orm";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	CollectionRelationsFromApp,
	CollectionSelect,
	SelectResult,
	Where,
} from "#questpie/server/collection/crud/types.js";
import type { CollectionAPI } from "#questpie/server/config/integrated/questpie-api.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import { boolean } from "#questpie/server/modules/core/fields/boolean.js";
import { datetime } from "#questpie/server/modules/core/fields/datetime.js";
import { json } from "#questpie/server/modules/core/fields/json.js";
import { number } from "#questpie/server/modules/core/fields/number.js";
import { object } from "#questpie/server/modules/core/fields/object.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import { text } from "#questpie/server/modules/core/fields/text.js";

import type { Equal, Expect, Extends, HasKey, Not } from "./type-test-utils.js";

// ============================================================================
// Fixtures
// ============================================================================

const statusOptions = [
	{ value: "draft", label: { en: "Draft" } },
	{ value: "published", label: { en: "Published" } },
] as const;

// Relation-less collection — relations must infer as the EMPTY map
const plainToys = collection("plain_toys").fields(({ f }) => ({
	name: f.text(255).required(),
	sku: f.text().required(),
	status: f.select(statusOptions),
	minutes: f.number().default(12),
	notes: f.textarea(),
}));

// Collection with belongsTo + hasMany relations
const owners = collection("owners").fields(({ f }) => ({
	name: f.text().required(),
	toy: f.relation("plain_toys").required(),
	toys: f.relation("plain_toys").hasMany({ foreignKey: "toy" }),
}));

type TCollections = {
	plain_toys: typeof plainToys;
	owners: typeof owners;
};
type TApp = { collections: TCollections };

// ============================================================================
// 1) .default() — value constrained to TState["data"]
// ============================================================================

// Valid defaults compile
const _dBool = boolean().default(true);
const _dBoolFn = boolean().default(() => false);
const _dNumber = number().default(0);
const _dText = text().default("hello");
const _dSelect = select(statusOptions).default("draft");
const _dDatetime = datetime().default(() => new Date());
// SQL escape hatch stays available (Drizzle-identical)
const _dSql = text().default(sql`now()`);
// json stays permissive by design (data: JsonValue)
const _dJson = json().default({});
const _dJsonArr = json().default([]);

// Invalid defaults are compile errors
// @ts-expect-error — boolean field cannot default to a string
const _dBoolBad = boolean().default("yes");
// @ts-expect-error — number field cannot default to a string
const _dNumberBad = number().default("zero");
// @ts-expect-error — select default must be one of the option values
const _dSelectBad = select(statusOptions).default("not-an-option");
// @ts-expect-error — datetime field cannot default to a number
const _dDatetimeBad = datetime().default(123);
// @ts-expect-error — factory return type must match the data type
const _dFnBad = number().default(() => "zero");

// Wrapper preservation: type-specific methods survive .default()
const _dChain = text().default("x").min(2).required();

// .default() before .required() — chain order independent
const _dChainOrder = text(255).default("default").required();

// Array fields: default must be an array of the inner data type
const objField = object({
	label: text().required(),
	href: text().required(),
	isExternal: boolean(),
});
const _dObjArray = objField
	.array()
	.default([{ label: "Home", href: "/", isExternal: null }]);
// @ts-expect-error — element shape must match the object data type
const _dObjArrayBad = objField.array().default([{ label: 1 }]);

// hasDefault state transition still applies (default → insert-optional)
type DToysInsert = typeof plainToys.$infer.insert;
type _minutesOptional = Expect<
	Equal<undefined extends DToysInsert["minutes"] ? true : false, true>
>;

// ============================================================================
// 2) Field hooks — values typed to TState["data"]
// ============================================================================

// v is string on text fields — string methods compile
const _hText = text().hooks({
	beforeChange: (v) => v.trim(),
	afterRead: (v) => v.toUpperCase(),
});

// v is number on number fields
const _hNumber = number().hooks({
	beforeChange: (v) => v + 1,
});

// Hook value type is the select literal union (wrapped-field mapped signature)
const selectField = select(statusOptions);
type SelectHooksArg = Parameters<typeof selectField.hooks>[0];
type SelectBeforeChange = NonNullable<SelectHooksArg["beforeChange"]>;
type _hSelectValue = Expect<
	Equal<Parameters<SelectBeforeChange>[0], "draft" | "published">
>;

// Return type must match the data type
// @ts-expect-error — beforeChange on a number field must return a number
const _hNumberBad = number().hooks({ beforeChange: (_v) => "nope" });

// ============================================================================
// 3) Sealed operator maps — exact keys, no [x: string]: any leak
// ============================================================================

type TextState = ReturnType<typeof text> extends Field<infer S> ? S : never;
type TextOpsKeys = keyof TextState["operators"]["column"];
// keyof no longer collapses to string
type _textOpsExact = Expect<Not<Extends<string, TextOpsKeys>>>;
type _textOpsHasEq = Expect<Extends<"eq", TextOpsKeys>>;
type _textOpsHasContains = Expect<Extends<"contains", TextOpsKeys>>;

type ToysWhere = Where<typeof plainToys, TApp>;

// Valid operators still work
const _wOk1: ToysWhere = { name: { contains: "bear" } };
const _wOk2: ToysWhere = { status: { eq: "draft" } };
const _wOk3: ToysWhere = { status: { in: ["draft"] } };
const _wOk4: ToysWhere = { minutes: { gt: 5 } };
const _wOk5: ToysWhere = { name: { isNull: true } };
const _wOk6: ToysWhere = { status: "draft" };

// Unknown operators are compile errors
const _wBad1: ToysWhere = {
	// @ts-expect-error — utterlyBogus is not an operator
	status: { utterlyBogus: 1 },
};
const _wBad2: ToysWhere = {
	// @ts-expect-error — fuzzyMatch is not an operator
	name: { fuzzyMatch: "bear" },
};
const _wBad3: ToysWhere = {
	// @ts-expect-error — contains is a string operator, not a number operator
	minutes: { contains: 5 },
};
// Direct value form stays literal-narrowed
const _wBad4: ToysWhere = {
	// @ts-expect-error — "bogus" is not a select option
	status: "bogus",
};

// Relation wheres: belongsTo operators + to-many quantifiers both compile
type OwnersWhere = Where<typeof owners, TApp>;
const _wRel1: OwnersWhere = { toy: { is: { name: "Bear" } } };
const _wRel2: OwnersWhere = { toy: { eq: "some-id" } };
const _wRel3: OwnersWhere = { toys: { some: { name: { contains: "B" } } } };
const _wRel4: OwnersWhere = { toys: { none: { status: "draft" } } };
const _wRel5: OwnersWhere = { toys: { every: { minutes: { gt: 1 } } } };
// Shorthand (no quantifier) still works
const _wRel6: OwnersWhere = { toy: { name: "Bear" } };
// Unknown operators on relation fields error
const _wRelBad: OwnersWhere = {
	// @ts-expect-error — bogusQuantifier is not a relation operator
	toys: { bogusQuantifier: { name: "x" } },
};
// Nested where inside a quantifier is still operator-checked
const _wRelNestedBad: OwnersWhere = {
	toys: {
		some: {
			// @ts-expect-error — gt on a string field requires a string operand
			name: { gt: 100 },
		},
	},
};

// ============================================================================
// 4) create({}) integrity — relation-less collections keep required fields
// ============================================================================

// Relations infer as the EMPTY map (inert), not Record<string, RelationConfig>
type PlainToysRelations = CollectionRelationsFromApp<typeof plainToys, TApp>;
type _noRelationKeys = Expect<Equal<keyof PlainToysRelations, never>>;

type PlainToysApi = CollectionAPI<typeof plainToys, TCollections>;
declare const toysApi: PlainToysApi;

// @ts-expect-error — name and sku are required
void toysApi.create({});
// @ts-expect-error — sku is required
void toysApi.create({ name: "Bear" });
// Full input compiles; defaulted/nullable fields stay optional
void toysApi.create({ name: "Bear", sku: "B-1" });
void toysApi.create({ name: "Bear", sku: "B-1", minutes: 3, notes: null });

// ============================================================================
// 5) SelectResult — omission mode excludes false keys (id pinned)
// ============================================================================

type ToySelectRow = CollectionSelect<typeof plainToys, TApp>;

// Omission mode: { notes: false } EXCLUDES notes, keeps everything else
type OmissionRow = SelectResult<ToySelectRow, { columns: { notes: false } }>;
type _omitDropsNotes = Expect<Equal<HasKey<OmissionRow, "notes">, false>>;
type _omitKeepsName = Expect<Equal<HasKey<OmissionRow, "name">, true>>;
type _omitKeepsSku = Expect<Equal<HasKey<OmissionRow, "sku">, true>>;
type _omitKeepsId = Expect<Equal<HasKey<OmissionRow, "id">, true>>;

// id is pinned even when explicitly set to false (runtime always includes it)
type OmitIdRow = SelectResult<ToySelectRow, { columns: { id: false } }>;
type _idPinned = Expect<Equal<HasKey<OmitIdRow, "id">, true>>;

// Inclusion mode: { name: true } picks only name (+ pinned id)
type InclusionRow = SelectResult<ToySelectRow, { columns: { name: true } }>;
type _inclKeys = Expect<Equal<keyof InclusionRow, "name" | "id">>;

// Mixed map: any true → inclusion mode (false keys ignored)
type MixedRow = SelectResult<
	ToySelectRow,
	{ columns: { name: true; notes: false } }
>;
type _mixedKeys = Expect<Equal<keyof MixedRow, "name" | "id">>;

// Empty columns map → no constraints → full row
type EmptyColsRow = SelectResult<ToySelectRow, { columns: {} }>;
type _emptyAllKeys = Expect<Equal<keyof EmptyColsRow, keyof ToySelectRow>>;

// Non-literal boolean (dynamic query) → full row, no lies
type DynamicRow = SelectResult<ToySelectRow, { columns: { notes: boolean } }>;
type _dynamicAllKeys = Expect<Equal<keyof DynamicRow, keyof ToySelectRow>>;

// End-to-end: literal `false` survives findOne generic inference
declare const toysApiForColumns: PlainToysApi;
const _omissionPromise = toysApiForColumns.findOne({
	columns: { notes: false },
});
type OmissionResult = NonNullable<Awaited<typeof _omissionPromise>>;
type _e2eDropsNotes = Expect<Equal<HasKey<OmissionResult, "notes">, false>>;
type _e2eKeepsName = Expect<Equal<HasKey<OmissionResult, "name">, true>>;
type _e2eKeepsId = Expect<Equal<HasKey<OmissionResult, "id">, true>>;

const _inclusionPromise = toysApiForColumns.findOne({
	columns: { name: true },
});
type InclusionResult = NonNullable<Awaited<typeof _inclusionPromise>>;
type _e2ePicksName = Expect<Equal<HasKey<InclusionResult, "name">, true>>;
type _e2eInclDropsNotes = Expect<
	Equal<HasKey<InclusionResult, "notes">, false>
>;
type _e2eInclKeepsId = Expect<Equal<HasKey<InclusionResult, "id">, true>>;

// ============================================================================
// WithKeys constraint-instantiation regression (audit F7)
// No-arg findOne() / ReturnType<> at the generic CONSTRAINT must not treat
// the optional `with?:` member as loaded relations and drop FK keys.
// ============================================================================

type OwnersApi = CollectionAPI<typeof owners, TCollections>;
declare const ownersApi: OwnersApi;

const _noArgPromise = ownersApi.findOne();
type NoArgRow = NonNullable<Awaited<typeof _noArgPromise>>;
type _noArgKeepsToyFk = Expect<Equal<HasKey<NoArgRow, "toy">, true>>;
type _noArgKeepsName = Expect<Equal<HasKey<NoArgRow, "name">, true>>;

// ReturnType<> instantiates TQuery at its constraint — same guarantee
type ConstraintRow = NonNullable<Awaited<ReturnType<OwnersApi["findOne"]>>>;
type _constraintKeepsToyFk = Expect<Equal<HasKey<ConstraintRow, "toy">, true>>;

// An actually-present `with` still replaces the FK with the populated doc
const _withPromise = ownersApi.findOne({ with: { toy: true } });
type WithRow = NonNullable<Awaited<typeof _withPromise>>;
type _toyPopulated = Expect<
	Equal<HasKey<NonNullable<WithRow["toy"]>, "sku">, true>
>;
