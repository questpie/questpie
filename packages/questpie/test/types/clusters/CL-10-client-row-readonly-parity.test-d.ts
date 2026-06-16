/**
 * CL-10 — Client SDK rows use the legacy 1-arg `CollectionSelect` & are MUTABLE,
 *         while server rows use the 2-arg field-def `CollectionSelectFromApp` and
 *         are READONLY. Two parallel resolvers for one conceptual "Row" → the same
 *         collection has two structurally-different row types.
 *
 * Proposal §3 CL-10 (sound-with-caveats). Target after the fix:
 *
 *   1. ONE app-aware row: `Equal<ClientRow, ServerRow>` holds — including the
 *      `readonly` modifier and access-optionality (today FALSE: only the `id`
 *      readonly modifier diverges, per clsdk-row-mismatch-readonly-id / romut-1).
 *   2. `readonly` is ASSERTED, not incidental — every key of BOTH the client and
 *      the server row is readonly (today: server readonly via homomorphic field-def
 *      mapping = TRUE, client mutable via Drizzle `$infer.select` rebuild = FALSE).
 *   3. Nested relation rows loaded via `with` mirror the parity — client nested
 *      row === server nested row, both readonly (romut-4).
 *   4. Reviewer override #1 (the single biggest hazard): the readonly applies to
 *      the OUTPUT row only. The WRITE-staging object (`HookContext.data` / the
 *      create-input the user mutates) must stay MUTABLE so `beforeChange` hooks can
 *      transform it. Encoded here over the reachable write-staging surface (the
 *      `create()` input arg) — output rows readonly, write input mutable.
 *   5. TSQ-2 (tanstack `updateMany`/`deleteMany` vars hardcoded `any`) lives in the
 *      separate `@questpie/tanstack-query` package. Its FIX SOURCE — the client's
 *      already-typed `updateMany.data` / `deleteMany.where` — is probed here as the
 *      "the precise source type exists to derive from" guarantee.
 *
 * Most assertions FAIL to compile today (RED) — that failure count is the burndown.
 *
 * CONSTRUCTION NOTES (HARD RULE §4.1):
 *   - Server row is probed through `QuestpieApp` (the real `Questpie<...>` class
 *     instance) whose `.collections` getter keys CRUD off `TConfig["collections"]`
 *     (the RAW `Collections` map) → resolves through `CollectionSelectFromApp` with
 *     `AppFromCollections<Collections>`. This is the surface users actually get.
 *   - Client row is probed through `QuestpieClient<App>` (real client SDK type),
 *     mirroring `client-live.test-d.ts` — its `CollectionAPI` uses the 1-arg
 *     `CollectionSelect<TCollection>` from `shared/type-utils`.
 *   - `IsAny`/`IsUnknown` run on RAW values, NEVER on `NonNullable<…>`.
 *   - `IsReadonly`/`Equal` distinguish the `readonly` modifier (the whole point).
 */

import type { QuestpieClient } from "#questpie/client/index.js";

import type {
	App,
	QuestpieApp,
} from "../_fixtures.js";

import type {
	Equal,
	ExactType,
	Expect,
	HasKey,
	IsAny,
	IsReadonly,
	NoAny,
	NotEmptyObject,
} from "../_assert.js";

// ============================================================================
// Row extractors — ONE conceptual row, TWO resolvers.
//
// Server: app.collections.X.findOne → CollectionSelectFromApp (field-def, readonly).
// Client: client.collections.X.findOne → CollectionSelect 1-arg (Drizzle, mutable).
// ============================================================================

declare const client: QuestpieClient<App>;
declare const server: QuestpieApp;

/** Server-side row for `articles` (the field-def, app-aware path). */
type ServerArticle = NonNullable<
	Awaited<ReturnType<typeof server.collections.articles.findOne>>
>;
/** Client-side row for `articles` (the legacy 1-arg path). */
type ClientArticle = NonNullable<
	Awaited<ReturnType<typeof client.collections.articles.findOne>>
>;

/** Server-side row for `authors`. */
type ServerAuthor = NonNullable<
	Awaited<ReturnType<typeof server.collections.authors.findOne>>
>;
/** Client-side row for `authors`. */
type ClientAuthor = NonNullable<
	Awaited<ReturnType<typeof client.collections.authors.findOne>>
>;

// Sanity: neither row degraded to a bare/empty/any shape (else the parity
// assertions below would pass vacuously). These should PASS today and after.
type _serverArticleHasKeys = Expect<NotEmptyObject<ServerArticle>>;
type _clientArticleHasKeys = Expect<NotEmptyObject<ClientArticle>>;
type _serverArticleNotAny = Expect<NoAny<ServerArticle>>;
type _clientArticleNotAny = Expect<NoAny<ClientArticle>>;
type _serverArticleHasTitle = Expect<HasKey<ServerArticle, "title">>;
type _clientArticleHasTitle = Expect<HasKey<ClientArticle, "title">>;

// ============================================================================
// TARGET 1 — Row IDENTITY: client row === server row (the whole cluster).
//
// clsdk-row-mismatch-readonly-id / romut-1: the two are bidirectionally
// ASSIGNABLE but NOT `Equal` — the only difference is the `readonly` modifier
// (and access-optionality). `Equal` catches that; `extends` would not.
// FAILS today.
// ============================================================================

type _articleRowIdentity = Expect<Equal<ClientArticle, ServerArticle>>;
type _authorRowIdentity = Expect<Equal<ClientAuthor, ServerAuthor>>;

// Per-key value parity is a NECESSARY (but not sufficient) part of identity —
// these likely PASS today (values match; only modifiers differ), pinning that
// the unification doesn't accidentally CHANGE a field's value type.
type _titleValueParity = ExactType<ClientArticle["title"], ServerArticle["title"]>;
type _idValueParity = ExactType<ClientArticle["id"], ServerArticle["id"]>;
type _authorNameValueParity = ExactType<ClientAuthor["name"], ServerAuthor["name"]>;

// ============================================================================
// TARGET 2 — `readonly` is ASSERTED on BOTH surfaces, for the WHOLE class.
//
// romut-1 / romut-2: server rows are readonly (incidentally, via homomorphic
// field-def mapping); client rows are mutable. The fix makes readonly an
// EXPLICIT, intentional, identical guarantee on both. Probe several keys (system
// `id`/`createdAt` AND user fields) so it covers the class, not one example.
// ============================================================================

// --- Server: readonly today (negative control — these PASS now and after). ---
type _serverIdRO = Expect<Equal<IsReadonly<ServerArticle, "id">, true>>;
type _serverCreatedAtRO = Expect<Equal<IsReadonly<ServerArticle, "createdAt">, true>>;
type _serverTitleRO = Expect<Equal<IsReadonly<ServerArticle, "title">, true>>;
type _serverStatusRO = Expect<Equal<IsReadonly<ServerArticle, "status">, true>>;
type _serverAuthorNameRO = Expect<Equal<IsReadonly<ServerAuthor, "name">, true>>;

// --- Client: MUTABLE today → must become readonly. These FAIL today (burndown). ---
type _clientIdRO = Expect<Equal<IsReadonly<ClientArticle, "id">, true>>;
type _clientCreatedAtRO = Expect<Equal<IsReadonly<ClientArticle, "createdAt">, true>>;
type _clientTitleRO = Expect<Equal<IsReadonly<ClientArticle, "title">, true>>;
type _clientStatusRO = Expect<Equal<IsReadonly<ClientArticle, "status">, true>>;
type _clientAuthorNameRO = Expect<Equal<IsReadonly<ClientAuthor, "name">, true>>;

// ============================================================================
// TARGET 3 — Nested relation rows loaded via `with` mirror the parity.
//
// romut-4: with { with: { author: true } } the nested `author` row is readonly on
// the server, mutable on the client. After the fix: client nested === server
// nested, and both readonly. (`author` is a to-one belongsTo → single object.)
// ============================================================================

type ServerArticleWithAuthor = NonNullable<
	Awaited<
		ReturnType<
			typeof server.collections.articles.findOne<{ with: { author: true } }>
		>
	>
>;
type ClientArticleWithAuthor = NonNullable<
	Awaited<
		ReturnType<
			typeof client.collections.articles.findOne<{ with: { author: true } }>
		>
	>
>;

type ServerNestedAuthor = NonNullable<ServerArticleWithAuthor["author"]>;
type ClientNestedAuthor = NonNullable<ClientArticleWithAuthor["author"]>;

// Sanity — nested rows resolved to real objects (not `{}`/any), else vacuous.
type _serverNestedNotEmpty = Expect<NotEmptyObject<ServerNestedAuthor>>;
type _clientNestedNotEmpty = Expect<NotEmptyObject<ClientNestedAuthor>>;
type _serverNestedHasName = Expect<HasKey<ServerNestedAuthor, "name">>;
type _clientNestedHasName = Expect<HasKey<ClientNestedAuthor, "name">>;

// Nested row identity — client nested === server nested. FAILS today (romut-4).
type _nestedAuthorIdentity = Expect<Equal<ClientNestedAuthor, ServerNestedAuthor>>;

// Nested readonly parity — server nested readonly (PASS now), client nested must
// become readonly (FAILS today).
type _serverNestedIdRO = Expect<Equal<IsReadonly<ServerNestedAuthor, "id">, true>>;
type _serverNestedNameRO = Expect<Equal<IsReadonly<ServerNestedAuthor, "name">, true>>;
type _clientNestedIdRO = Expect<Equal<IsReadonly<ClientNestedAuthor, "id">, true>>;
type _clientNestedNameRO = Expect<Equal<IsReadonly<ClientNestedAuthor, "name">, true>>;

// ============================================================================
// TARGET 4 — Reviewer override #1: OUTPUT readonly, WRITE-staging MUTABLE.
//
// The single biggest correctness hazard the reviewer flagged: do NOT make the
// write-staging object readonly. `HookContext.data` (the doc a `beforeChange`
// hook mutates, e.g. `ctx.data.slug = slugify(...)`) is generated and not
// reachable from the `questpie` package; the reachable analog is the `create()`
// INPUT arg — the object the caller constructs/mutates. It must stay MUTABLE
// while the create RETURN (an output row) is readonly.
// ============================================================================

/** The create-input arg — the reachable "write-staging doc" (must be mutable). */
type ServerCreateInput = Parameters<typeof server.collections.authors.create>[0];
/** The create RETURN — an output row (must be readonly, like findOne). */
type ServerCreateReturn = Awaited<
	ReturnType<typeof server.collections.authors.create>
>;

// Sanity — the create input is a real object carrying `name` (not any/empty).
type _createInputNotAny = Expect<NoAny<ServerCreateInput>>;
type _createInputHasName = Expect<HasKey<ServerCreateInput, "name">>;

// WRITE-staging stays MUTABLE — `name` on the create input is NOT readonly. This
// PASSES today and MUST KEEP passing after the fix (the guard against over-applying
// `Readonly` to the write path — reviewer's required mutability test).
type _writeInputMutable = Expect<Equal<IsReadonly<ServerCreateInput, "name">, false>>;

// OUTPUT row from create is readonly (`id` cannot be reassigned). Server already
// readonly (PASS); pinned here so the create RETURN tracks `findOne`'s row.
type _createReturnIdRO = Expect<Equal<IsReadonly<ServerCreateReturn, "id">, true>>;
// The create RETURN row must equal the findOne row (one output-row contract for
// `authors` across read and write methods).
type _createReturnEqualsFindOne = Expect<Equal<ServerCreateReturn, ServerAuthor>>;

// ============================================================================
// TARGET 5 — TSQ-2 fix-source guarantee (the typed surface the tanstack layer
// must derive from). `@questpie/tanstack-query` is a separate package, but its
// fix reads the CLIENT's already-typed `updateMany`/`deleteMany` signatures.
// Assert those source types are precise (NOT `any`) here, in-package.
// These should PASS today (the client IS typed) — they guard that the source the
// fix derives from does not itself silently degrade.
// ============================================================================

type ClientUpdateManyArg = Parameters<
	typeof client.collections.articles.updateMany
>[0];
type ClientDeleteManyArg = Parameters<
	typeof client.collections.articles.deleteMany
>[0];

// `updateMany`'s `where`/`data` are typed (not `any`) on the client surface.
type _updateManyWhereNotAny = Expect<
	Equal<IsAny<ClientUpdateManyArg["where"]>, false>
>;
type _updateManyDataNotAny = Expect<
	Equal<IsAny<ClientUpdateManyArg["data"]>, false>
>;
// `deleteMany`'s `where` is typed (not `any`).
type _deleteManyWhereNotAny = Expect<
	Equal<IsAny<ClientDeleteManyArg["where"]>, false>
>;

// ============================================================================
// TARGET 6 — dist/.d.ts emit-collapse robustness (romut-2 / romut-3).
//
// The server readonly is an EMERGENT property of homomorphic mapping; a
// declaration-emit rebuild (the documented tsdown collapse) drops the modifier.
// The fix writes `readonly` as a LITERAL token (flat per-collection aliases /
// outer `Readonly<>`) so it survives emit. We cannot import the built `.d.mts`
// from a `src`-resolved tsconfig, so we pin the SHAPE-LEVEL invariant the emit
// must preserve: the row is a non-empty object whose keys carry readonly. Once
// readonly is a literal token, this holds in both src and dist resolutions.
// `_clientIdRO`/`_serverIdRO` above are the concrete modifier checks; this is the
// "did not collapse to {}" companion.
// ============================================================================

type _serverRowSurvivesEmit = Expect<NotEmptyObject<ServerArticle>>;
type _clientRowSurvivesEmit = Expect<NotEmptyObject<ClientArticle>>;
type _serverNestedSurvivesEmit = Expect<NotEmptyObject<ServerNestedAuthor>>;
type _clientNestedSurvivesEmit = Expect<NotEmptyObject<ClientNestedAuthor>>;
