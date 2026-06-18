/**
 * Full-app fixture — §6 invariant goal-tests.
 *
 * These assert IDENTITY (not "it compiles") against the REAL composed
 * `AppContext`/`App`/`AppSession` from the fixture's `.generated/index.ts`. They
 * are the trip-wires the module-only package gate was structurally blind to —
 * if the AppContext⇄config cycle ever re-leaks `any` (or a carrier fold cycles),
 * these flip RED in the DEFAULT gate.
 *
 * @see ideal-codegen-design §6 (preserved invariants, each with a proving assertion)
 */
import "./.generated/factories.js";
import type { InferContextExtensionsFromApp } from "#questpie/server/config/context.js";
import type { CollectionInsert } from "#questpie/shared/type-utils.js";

import type { NoAny, NoNever, NotEmptyObject } from "../_assert.js";
import type { Equal, Expect, HasKey, IsAny } from "../type-test-utils.js";
import type { AppCollections } from "./.generated/entities.gen.js";
import type {
	App,
	AppServices,
	AppSession,
	AppSessionUser,
	CollectionWhere,
} from "./.generated/index.js";

// ============================================================================
// Invariant 1 — city-portal-style context-resolver precision (cityId)
// THE #1 trip-wire: the appConfig({ context }) resolver return must stay precise
// on the getContext read-path (App["config"]["~contextExtensions"]). At HEAD
// (cyclic) App = any → cityId = any. The flat-explicit emission keeps it precise.
// ============================================================================

type Ext = InferContextExtensionsFromApp<App>;

type _cityIdPrecise = Expect<Equal<Ext["cityId"], string | null | undefined>>;
type _cityIdNotAny = Expect<NoAny<Ext["cityId"]>>;
type _extKeysExact = Expect<Equal<keyof Ext, "cityId">>;

// ============================================================================
// Invariant 2 — plugin-aware session (P0 keystone)
// AppSession / AppSessionUser must be concrete (not any). The Better Auth
// admin() plugin contributes `role` from a nested starter module; app-local
// additionalFields contributes `department`. Both must survive into the inferred
// user shape.
// ============================================================================

type _sessionNotAny = Expect<NoAny<AppSession>>;
type _sessionUserNotAny = Expect<NoAny<AppSessionUser>>;
// Nested module plugin-contributed user field present + not-any.
type _userHasRole = Expect<HasKey<AppSessionUser, "role">>;
type _userRoleNotAny = Expect<NoAny<AppSessionUser["role"]>>;
// additionalFields-contributed user field present (the additionalFields carrier).
type _userHasDepartment = Expect<HasKey<AppSessionUser, "department">>;
// Base session user identity fields survive.
type _userHasId = Expect<HasKey<AppSessionUser, "id">>;
type _userHasEmail = Expect<HasKey<AppSessionUser, "email">>;

// ============================================================================
// Invariant 3 — CL-06 relation-string validation (Questpie.CollectionKeys)
// The names-only registry must be FINITE (not `string`) and carry MODULE names
// (the pulled starterModule's `user`) AND user literals (`articles`).
// ============================================================================

type _collectionKeysFinite = Expect<
	Equal<string extends keyof Questpie.CollectionKeys ? true : false, false>
>;
type _collectionKeysHasModuleName = Expect<
	HasKey<Questpie.CollectionKeys, "user">
>; // module name (REL-STR-03)
type _collectionKeysHasUserName = Expect<
	HasKey<Questpie.CollectionKeys, "articles">
>; // user literal
type _collectionKeysNoBogus = Expect<
	Equal<HasKey<Questpie.CollectionKeys, "zzz_not_a_collection">, false>
>;
type _collectionKeysNotAny = Expect<NoAny<keyof Questpie.CollectionKeys>>;

// ============================================================================
// Invariant 4 — CL-05 typed hook / access / context-resolver ctx
// The AppHookContext / AppDefaultAccessContext seams (extends _AppInfraContext)
// must carry precise (not-any) infra members. ContextResolverBase too.
// ============================================================================

type _hookSession = Expect<NoAny<Questpie.AppHookContext["session"]>>;
type _hookDb = Expect<NoAny<Questpie.AppHookContext["db"]>>;
type _hookCollections = Expect<NoAny<Questpie.AppHookContext["collections"]>>;
type _hookQueue = Expect<NoAny<Questpie.AppHookContext["queue"]>>;

type _accessSession = Expect<
	NoAny<Questpie.AppDefaultAccessContext["session"]>
>;
type _accessDb = Expect<NoAny<Questpie.AppDefaultAccessContext["db"]>>;

type _resolverBaseSession = Expect<
	NoAny<Questpie.ContextResolverBase["session"]>
>;
type _resolverBaseDb = Expect<NoAny<Questpie.ContextResolverBase["db"]>>;

// Force IsAny import usage (kept for symmetry with the assert kit conventions).
type _isAnyGuard = Expect<Equal<IsAny<AppSessionUser>, false>>;

// ============================================================================
// Services carrier — the FLAT-emitted (gen-time-enumerated, never folded)
// `reporting` service from the pulled fixture module composes into AppServices.
// (Its `create((ctx) => …)` references AppContext — the §2.2 asymmetry — yet the
// flat emission keeps the gate acyclic. The acceptance probe folds it → RED.)
// ============================================================================

type _servicesHasReporting = Expect<HasKey<AppServices, "reporting">>;
type _reportingNotAny = Expect<NoAny<AppServices["reporting"]>>;

// ============================================================================
// Invariant 8 — collections.X.create() never/{} bug (module-merge collapse)
// The fixture's top-level adminModule BOTH nests starterModule AND re-declares
// `user` via collection("user").merge(starterModule.collections.user). Under the
// additive `&` collections fold, `AppCollections["user"]` collapsed to `never`,
// poisoning create() input → `never` (TS2322 at every field) and the create()
// return → `{}` (TS2339 on `.id`). The override fold keeps it a real Collection.
//
// These assert IDENTITY against the REAL composed `App["collections"]` CRUD
// surface — the create() input must accept the real insert (`email: string`, not
// `never`) and the create() return must be the real row (has `id`, not `{}`).
// ============================================================================

// The merged module collection value did not collapse to `never`.
type _userCollNotNever = Expect<NoNever<AppCollections["user"]>>;

// Raw insert model is the real shape (not `never`, carries the user fields).
type _UserInsert = CollectionInsert<AppCollections["user"]>;
type _userInsertNotNever = Expect<NoNever<_UserInsert>>;
type _userInsertNotEmpty = Expect<NotEmptyObject<_UserInsert>>;
type _userInsertHasEmail = Expect<HasKey<_UserInsert, "email">>;
type _userInsertHasName = Expect<HasKey<_UserInsert, "name">>;

// create() INPUT param — accepts the real insert; `email`/`name` typed `string`,
// NOT `never` (the TS2322 booking-call site).
type _UserCreateInput = Parameters<App["collections"]["user"]["create"]>[0];
type _userCreateInputNotNever = Expect<NoNever<_UserCreateInput>>;
type _userCreateInputEmailString = Expect<
	Equal<NonNullable<_UserCreateInput>["email"], string>
>;
type _userCreateInputNameString = Expect<
	Equal<NonNullable<_UserCreateInput>["name"], string>
>;

// create() RETURN — the real row (has `id`/`email`, not `{}`/TS2339 on `.id`).
type _UserCreateReturn = Awaited<
	ReturnType<App["collections"]["user"]["create"]>
>;
type _userCreateReturnNotEmpty = Expect<NotEmptyObject<_UserCreateReturn>>;
type _userCreateReturnHasId = Expect<HasKey<_UserCreateReturn, "id">>;
type _userCreateReturnHasEmail = Expect<HasKey<_UserCreateReturn, "email">>;

// Control — a USER collection declared once (articles) stays healthy, proving the
// override fold does not regress single-declared collections.
type _ArticlesInsert = CollectionInsert<AppCollections["articles"]>;
type _articlesInsertNotNever = Expect<NoNever<_ArticlesInsert>>;
type _articlesInsertHasTitle = Expect<HasKey<_ArticlesInsert, "title">>;
type _ArticlesCreateReturn = Awaited<
	ReturnType<App["collections"]["articles"]["create"]>
>;
type _articlesCreateReturnHasId = Expect<HasKey<_ArticlesCreateReturn, "id">>;

// ============================================================================
// Invariant — CollectionWhere<K> helper resolves to the real find() where type.
// The generated `CollectionWhere<"articles">` must (a) stay concrete (not any),
// (b) carry the collection's field keys, and (c) be assignable to the `where`
// param of `collections.articles.find` — proving the `AppConfig` app-param choice
// matches what the CRUD surface expects.
// ============================================================================

type _ArticlesWhereParam = NonNullable<
	NonNullable<Parameters<App["collections"]["articles"]["find"]>[0]>["where"]
>;

type _collectionWhereNotAny = Expect<NoAny<CollectionWhere<"articles">>>;
type _collectionWhereHasField = Expect<
	HasKey<CollectionWhere<"articles">, "title">
>;
type _collectionWhereAssignable = Expect<
	Equal<
		CollectionWhere<"articles"> extends _ArticlesWhereParam ? true : false,
		true
	>
>;

// Mutability guard — `Where` field keys must NOT be readonly, or the
// `const where = {…}; where.field = …` dynamic-build pattern won't compile.
// (Homomorphic `readonly` leaked from the frozen field defs once; `-readonly`
// on the WHERE mapped types strips it.) A direct assignment is the real probe —
// `Equal<…, Mutable<…>>` would false-negative on CollectionWhere's intersection.
function _collectionWhereMutationCompiles(): void {
	const w: CollectionWhere<"articles"> = {};
	w.title = "Hello"; // readonly key → TS2540 here
}

export type { Ext, App, AppServices, AppSession, AppSessionUser };
