/**
 * Variance Annotations Type Tests
 *
 * The CRUD/field hot-path generics carry explicit `in out` (invariant)
 * variance annotations so tsc skips structural variance measurement
 * (−39–45% instantiations on the flagship examples). Declared variance is
 * trusted as FINAL — there is no structural fallback — so these tests lock
 * the assignability relationships that must keep working:
 *
 * 1. `any`-defaulted instantiations stay assignable in both directions
 *    (internal plumbing passes specific CRUDs where bare `CRUD` is expected).
 * 2. TId parameters stay UNANNOTATED: bare `CRUD`/`UpdateBatchParams`
 *    default TId to `unknown`/`string`, and method bivariance only bridges
 *    `string` vs `unknown` through the structural fallback that an
 *    annotation would forbid.
 * 3. The FieldWithMethods alias split (FieldCommonMethodsWrapped /
 *    FieldTypeMethodsWrapped) preserves chain-order semantics: type-specific
 *    methods survive common-method calls and vice versa.
 *
 * Compile-time only — run with: tsc --noEmit
 */

import type {
	CRUD,
	DeleteManyParams,
	FindManyOptions,
	FindManyOptionsBase,
	UpdateBatchParams,
	UpdateManyParams,
	With,
} from "#questpie/server/collection/crud/types.js";
import type { GlobalCRUD } from "#questpie/server/global/crud/types.js";
import { text } from "#questpie/server/modules/core/fields/text.js";

import type { Equal, Expect, Extends, HasKey } from "./type-test-utils.js";

// ============================================================================
// Test fixtures
// ============================================================================

type Post = {
	id: string;
	title: string;
	views: number;
};

type PostInsert = {
	title: string;
	views?: number;
};

type PostUpdate = Partial<PostInsert>;

// ============================================================================
// CRUD — specific instantiations must stay assignable to bare `CRUD`
// (nested-operations.ts passes collection CRUDs into `relatedCrud: CRUD`)
// ============================================================================

type SpecificCRUD = CRUD<Post, PostInsert, PostUpdate, {}, string>;

// string TId → unknown TId default: requires the method-bivariance
// structural fallback, which an `in out` annotation on TId would forbid.
// (The reverse direction is intentionally untested: bare CRUD's find()
// returns `{[x: string]: any}` docs, which never satisfied specific docs.)
type _crudSpecificToBare = Expect<Extends<SpecificCRUD, CRUD>>;

// ============================================================================
// UpdateBatchParams — TId must remain unannotated (string vs unknown bridge)
// ============================================================================

type _updateBatchSpecificToBare = Expect<
	Extends<
		UpdateBatchParams<PostUpdate, {}, string>,
		UpdateBatchParams<any, any, unknown>
	>
>;

// ============================================================================
// Params interfaces — `any`-defaulted forms accept specific instantiations
// in both directions (the `any` short-circuit must survive annotations)
// ============================================================================

type _updateManyToBare = Expect<
	Extends<UpdateManyParams<PostUpdate, Post, {}>, UpdateManyParams>
>;
type _updateManyFromBare = Expect<
	Extends<UpdateManyParams, UpdateManyParams<PostUpdate, Post, {}>>
>;

type _deleteManyToBare = Expect<
	Extends<DeleteManyParams<Post, {}>, DeleteManyParams>
>;
type _deleteManyFromBare = Expect<
	Extends<DeleteManyParams, DeleteManyParams<Post, {}>>
>;

type _findManyToBase = Expect<
	Extends<FindManyOptions<Post, {}>, FindManyOptionsBase>
>;
type _findManyFromBase = Expect<
	Extends<FindManyOptionsBase, FindManyOptions<Post, {}>>
>;

// ============================================================================
// GlobalCRUD — same invariant-annotation contract as collection CRUD
// ============================================================================

type SpecificGlobalCRUD = GlobalCRUD<Post, PostInsert, PostUpdate, {}>;

type _globalSpecificToBare = Expect<Extends<SpecificGlobalCRUD, GlobalCRUD>>;
type _globalBareToSpecific = Expect<Extends<GlobalCRUD, SpecificGlobalCRUD>>;

// ============================================================================
// With — annotated mapped alias keeps exact relation keys
// ============================================================================

type Rels = { author: unknown; comments: unknown };

type _withKeysPreserved = Expect<Equal<keyof With<Rels>, "author" | "comments">>;

// ============================================================================
// FieldWithMethods split — chain-order semantics preserved
// ============================================================================

// Type-specific methods survive a common-method call...
const requiredFirst = text(255).required().trim();
type _trimAfterRequired = Expect<Equal<HasKey<typeof requiredFirst, "trim">, true>>;
type _commonAfterRequired = Expect<
	Equal<HasKey<typeof requiredFirst, "required">, true>
>;

// ...and common methods survive a type-specific call (override maps stay
// ahead of Field<TState> in the intersection).
const typeFirst = text(255).trim().required();
type _patternAfterChain = Expect<Equal<HasKey<typeof typeFirst, "pattern">, true>>;

// State accumulation still flows through the wrapped common methods
type RequiredValue = (typeof requiredFirst)["$types"]["value"];
type _valueStillString = Expect<Equal<RequiredValue, string>>;
