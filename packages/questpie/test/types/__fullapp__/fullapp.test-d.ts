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
import type {
	App,
	AppServices,
	AppSession,
	AppSessionUser,
} from "./.generated/index.js";

import type { InferContextExtensionsFromApp } from "#questpie/server/config/context.js";

import type { Equal, Expect, HasKey, IsAny } from "../type-test-utils.js";
import type { NoAny } from "../_assert.js";

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
// admin() plugin contributes `role`; additionalFields contributes `department`.
// Both must survive into the inferred user shape.
// ============================================================================

type _sessionNotAny = Expect<NoAny<AppSession>>;
type _sessionUserNotAny = Expect<NoAny<AppSessionUser>>;
// Plugin-contributed user field present + not-any (the plugin carrier).
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

type _accessSession = Expect<NoAny<Questpie.AppDefaultAccessContext["session"]>>;
type _accessDb = Expect<NoAny<Questpie.AppDefaultAccessContext["db"]>>;

type _resolverBaseSession = Expect<NoAny<Questpie.ContextResolverBase["session"]>>;
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

export type {
	Ext,
	App,
	AppServices,
	AppSession,
	AppSessionUser,
};
