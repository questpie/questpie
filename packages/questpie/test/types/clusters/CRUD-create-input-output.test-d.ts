/**
 * CRUD-create-input-output — `collections.X.create()` must accept the REAL insert
 * shape and return the REAL row (never `never` / `{}`).
 *
 * ROOT CAUSE (diagnosis "create() never/{} bug"). The module-tree property fold
 * `ExtractModuleProp`/`ExtractModulePropArr` (codegen-type-utils.ts) merges same-key
 * collection contributions across the module-nesting boundary with a type
 * INTERSECTION (`&`) instead of an OVERRIDE. A module that BOTH nests a sub-module
 * shipping `collections.user` AND re-declares `collections.user` via
 * `collection("user").merge(sub.collections.user)` (exactly what the admin module
 * does to starter's `user`) therefore folds to `Collection<A> & Collection<B>` for
 * `AppCollections["user"]`. That intersection reduces to `never` because the two
 * `Collection` instantiations have NULL-vs-typed-object member divergences
 * (`i18nTable`/`versionsTable` are `null` on one side, a typed table on the other,
 * and `null & {…}` ⇒ `never`). Once the collection is `never`:
 *   - `CollectionInsert<never>` ⇒ `never` ⇒ every `create()` input field is `never`
 *     (TS2322 "Type 'string' is not assignable to type 'never'" at every assignment),
 *   - `CollectionSelectFromApp<never, App>` degrades to the empty object `{}` ⇒ the
 *     returned row has NO keys (`customer.id` ⇒ TS2339 "Property 'id' does not exist").
 *
 * THE FIX. The `collections` fold uses OVERRIDE semantics
 * (`CodegenResolvedModulePropArr`) so the most-derived (outer) re-declaration
 * shadows the nested base instead of intersecting it. Distinct keys from both sides
 * still survive — only the same-key collision overrides.
 *
 * This test exercises the REAL fold (`ExtractModulePropArr` /
 * `CodegenResolvedModulePropArr` from codegen-type-utils) over a fixture module
 * that mirrors the admin↔starter nesting, then drives the result through the REAL
 * `CollectionAPI` create surface — asserting IDENTITY (NoNever / NotEmptyObject /
 * key presence), never "it compiles".
 *
 * RED proof: the `_RED_*` block (guarded by the OLD additive fold) demonstrates the
 * bug — it is kept as a positive control that the additive fold DOES collapse to
 * `never`/`{}`, so a future "fix" that silently re-additives is caught.
 */

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	ExtractModulePropArr,
	CodegenResolvedModulePropArr,
} from "#questpie/server/config/codegen-type-utils.js";
import type { CollectionAPI } from "#questpie/server/config/integrated/questpie-api.js";
import type { CollectionInsert } from "#questpie/shared/type-utils.js";

import type { NoNever, NotEmptyObject, IsEmptyObject } from "../_assert.js";
import type { Expect, Equal, HasKey } from "../type-test-utils.js";

// ============================================================================
// §0  Fixtures — a "starter" base collection and an "admin" re-declaration that
//     BOTH nests the starter module AND merges + extends the SAME `user` key.
//     This is the exact admin↔starter shape that detonates the additive fold.
// ============================================================================

const starterUser = collection("user")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		email: f.email(255).label("Email").required(),
		emailVerified: f.boolean().label("Verified").required(),
	}));

const starterAccount = collection("account")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		provider: f.text(255).label("Provider").required(),
	}));

/** The nested module (ships `user` + `account`). */
type StarterModule = {
	name: "starter";
	collections: { user: typeof starterUser; account: typeof starterAccount };
};
declare const starterModule: StarterModule;

/**
 * Admin re-declares `user` = collection("user").merge(starter.user).<more config>.
 * It also enables `versioning` (starter does NOT) so the two `Collection`
 * instantiations diverge on a NULL-vs-typed member (`versionsTable: null` on
 * starter, a typed table on admin) — the exact trigger that makes the additive
 * `&` fold reduce `user` to `never` (the §6 RED control depends on this divergence).
 */
const adminUser = collection("user")
	.merge(starterUser)
	.options({ timestamps: true, versioning: true })
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		email: f.email(255).label("Email").required(),
		emailVerified: f.boolean().label("Verified").required(),
		role: f.text(64).label("Role"),
	}));

/** The OUTER module: nests starter AND re-declares `user`, also adds `adminLocks`. */
const adminLocks = collection("admin_locks")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		key: f.text(255).label("Key").required(),
	}));

type AdminModule = {
	name: "admin";
	modules: readonly [StarterModule];
	collections: { user: typeof adminUser; admin_locks: typeof adminLocks };
};
declare const adminModule: AdminModule;

/** Top-level module tuple (what `_modules` is). */
type Mods = readonly [AdminModule];

// ============================================================================
// §1  The fold the generated `_ModuleCollections` now uses (OVERRIDE).
// ============================================================================

type ModuleCollections = CodegenResolvedModulePropArr<Mods, "collections">;

/** A user collection declared once (not merged across nesting) — control. */
const appointments = collection("appointments")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		status: f.text(64).label("Status").required(),
		notes: f.text().label("Notes"),
	}));

/** AppCollections = module fold (override) + user collections (additive). */
type AppCollections = ModuleCollections & {
	appointments: typeof appointments;
};

// The real per-key CRUD surface (mirrors `_CollectionsAPI`).
type UserAPI = CollectionAPI<AppCollections["user"], AppCollections>;
type ApptAPI = CollectionAPI<AppCollections["appointments"], AppCollections>;

// ── The create() input param and return type, extracted off the real signature ──
type UserCreateInput = Parameters<UserAPI["create"]>[0];
type UserCreateReturn = Awaited<ReturnType<UserAPI["create"]>>;
type ApptCreateInput = Parameters<ApptAPI["create"]>[0];
type ApptCreateReturn = Awaited<ReturnType<ApptAPI["create"]>>;

// ============================================================================
// §2  MODULE collection (user) — input is the REAL insert (NOT never).
// ============================================================================

// The collection value itself must not have collapsed.
type _userCollNotNever = Expect<NoNever<AppCollections["user"]>>;

// Raw insert model must not be `never` and must carry the real fields.
type UserInsert = CollectionInsert<AppCollections["user"]>;
type _userInsertNotNever = Expect<NoNever<UserInsert>>;
type _userInsertNotEmpty = Expect<NotEmptyObject<UserInsert>>;
type _userInsertHasName = Expect<HasKey<UserInsert, "name">>;
type _userInsertHasEmail = Expect<HasKey<UserInsert, "email">>;
type _userInsertHasRole = Expect<HasKey<UserInsert, "role">>; // admin-added field survives

// The create() INPUT param must accept the real shape — `email` typed `string`,
// NOT `never` (the TS2322 site). Probe the field type on the input directly.
type _userCreateInputNotNever = Expect<NoNever<UserCreateInput>>;
type _userCreateInputEmailIsString = Expect<
	Equal<NonNullable<UserCreateInput>["email"], string>
>;
type _userCreateInputNameIsString = Expect<
	Equal<NonNullable<UserCreateInput>["name"], string>
>;

// ============================================================================
// §3  MODULE collection (user) — output is the REAL row (NOT {}).
// ============================================================================

type _userCreateReturnNotEmpty = Expect<NotEmptyObject<UserCreateReturn>>;
type _userCreateReturnHasId = Expect<HasKey<UserCreateReturn, "id">>;
type _userCreateReturnHasEmail = Expect<HasKey<UserCreateReturn, "email">>;
type _userCreateReturnHasName = Expect<HasKey<UserCreateReturn, "name">>;
type _userCreateReturnNoAny = Expect<NoNever<UserCreateReturn>>;

// ============================================================================
// §4  USER collection (appointments, declared once) — stays healthy (control).
//     Proves the override fold does not regress single-declared collections.
// ============================================================================

type ApptInsert = CollectionInsert<AppCollections["appointments"]>;
type _apptInsertNotNever = Expect<NoNever<ApptInsert>>;
type _apptInsertHasStatus = Expect<HasKey<ApptInsert, "status">>;
type _apptCreateInputStatusIsString = Expect<
	Equal<NonNullable<ApptCreateInput>["status"], string>
>;
type _apptCreateReturnNotEmpty = Expect<NotEmptyObject<ApptCreateReturn>>;
type _apptCreateReturnHasId = Expect<HasKey<ApptCreateReturn, "id">>;

// ============================================================================
// §5  Distinct keys from BOTH nesting levels survive the override fold.
//     (starter's `account`, admin's `admin_locks`, both must be present + healthy.)
// ============================================================================

type _hasStarterAccount = Expect<HasKey<ModuleCollections, "account">>;
type _hasAdminLocks = Expect<HasKey<ModuleCollections, "admin_locks">>;
type _accountNotNever = Expect<NoNever<ModuleCollections["account"]>>;
type _accountInsertHasProvider = Expect<
	HasKey<CollectionInsert<ModuleCollections["account"]>, "provider">
>;

// ============================================================================
// §6  RED control — the OLD additive `&` fold DID collapse `user` to never/{}.
//     If a regression re-additives the collections fold, these flip and fail.
// ============================================================================

type _RED_AdditiveModuleCollections = ExtractModulePropArr<Mods, "collections">;
type _RED_AdditiveUser = _RED_AdditiveModuleCollections["user"];
// The additive fold collapses the same-key user to `never`.
type _RED_userIsNever = Expect<Equal<NoNever<_RED_AdditiveUser>, false>>;
// And its CRUD select degrades to the empty object `{}`.
type _RED_AdditiveUserReturn = Awaited<
	ReturnType<
		CollectionAPI<_RED_AdditiveUser, _RED_AdditiveModuleCollections>["create"]
	>
>;
type _RED_userReturnEmpty = Expect<
	Equal<IsEmptyObject<_RED_AdditiveUserReturn>, true>
>;
