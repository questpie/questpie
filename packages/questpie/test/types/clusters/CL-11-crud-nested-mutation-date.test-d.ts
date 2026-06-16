/**
 * CL-11 — CRUD nested-mutation & date input precision gaps
 * =========================================================
 *
 * Cluster theme (proposal §CL-11, reviewer-authoritative): three independent
 * precision gaps on the CRUD INPUT surface, all currently degraded:
 *
 *   A. crudin-2 — Nested relation `create` / `connectOrCreate.create` payloads
 *      do NOT reject excess/phantom keys. Root cause: the nested member is typed
 *      `create?: TInsert | TInsert[]` (a UNION), and TypeScript disables
 *      excess-property (freshness) checks against unions. The TOP-LEVEL create
 *      input is a single object type and keeps the check. TARGET: nested create
 *      payloads reject excess keys (via `Exact<…>`), while valid input still
 *      compiles. Mirrored on the client SDK.
 *
 *   B. crudin-3 — `NestedRelationConnect.id`, `connectOrCreate.where.id`, and the
 *      `set` element id are hardcoded `string`, ignoring the target collection's
 *      real id type. TARGET: thread `ExtractIdType<ExtractRelationSelect<…>>` so a
 *      numeric-PK target (`tickets`, `id: f.number()`) gets `id: number`. A
 *      string-PK target (`authors`) stays `string` (control). The `updateById`
 *      by-id param already threads `ExtractIdType` → positive control that the
 *      id-type plumbing reaches the public surface.
 *
 *   C. crudin-4 / FGC-5 / clsdk-date — `f.date()` (data: string, column mode
 *      'string', schema `z.string().date()`) takes a `string` on create/select,
 *      but its WHERE accepts `DateInput = Date | string`. So you can FILTER by a
 *      Date you can never CREATE with — an asymmetry footgun. `f.datetime()`
 *      (data: Date) is symmetric on `Date`.
 *
 *      AUTHORITATIVE TARGET (proposal §CL-11 reviewer override, sub-fix B,
 *      "option b — runtime-safe"): the runtime stores ISO date STRINGS and
 *      `z.string().date()` rejects both Date objects and full-ISO strings, and
 *      the client wire layer uses plain `JSON.stringify` (no superjson). So the
 *      fix NARROWS the date WHERE to `string` (a dedicated `dateStringOps`), it
 *      does NOT widen create to `Date`. The invariant the fix establishes is
 *      therefore **create === where SYMMETRY on `string`** for a date field, and
 *      datetime stays `Date` on both. (The raw findings phrase the target as
 *      "create accepts Date"; the reviewer override supersedes them — we encode
 *      the symmetry + `string`-create as the authoritative goal and note the
 *      discrepancy at each assertion.)
 *
 * SEQUENCING: this cluster is sequenced AFTER CL-01 — `Exact` over object/json
 * field values (index signatures from CL-01) can mis-fire, so a positive
 * "object field accepts extra NESTED keys" control is included.
 *
 * Most assertions below FAIL to compile today (the burndown). Probes route
 * through the REAL public surface `QuestpieApp["collections"][…]` (where
 * `create`'s param is `CreateInputWithRelations<…>` and `updateById`'s id is
 * `ExtractIdType<…>`, exactly as users hit them) plus the exported nested-
 * mutation helpers over the `App` fixture shape.
 *
 * @see _fixtures.ts — `articles` (date vs datetime, string-PK relations),
 *      `tickets` (numeric PK + self-relation), `QuestpieApp`, `App`.
 * @see _assert.ts — kit.
 */

import type {
	CollectionRelationsFromApp,
	NestedRelationConnectOrCreate,
	NestedRelationMutation,
	Where as WhereType,
} from "#questpie/server/collection/crud/types.js";
import type {
	ExtractRelationSelect,
} from "#questpie/shared/type-utils.js";

import type { App, QuestpieApp } from "../_fixtures.js";
import type {
	Equal,
	Expect,
	ExactType,
	HasKey,
	IsNever,
	NoAny,
	NoNever,
	NoUnknown,
	Not,
} from "../_assert.js";

// ============================================================================
// Shared param extractors — route through the REAL public CRUD surface.
//
// `QuestpieApp["collections"]["X"]` resolves to
//   CRUD<TSelect, CollectionInsert<X>, CollectionUpdate<X>, Relations, ExtractIdType<TSelect>>
// so `create`'s first arg is `CreateInputWithRelations<…>` and `updateById`'s
// `id` is `ExtractIdType<CollectionSelectFromApp<X, App>>` — the user surface.
// ============================================================================

type Cols = QuestpieApp["collections"];

/** Full create-input object for collection K (top-level + nested mutations). */
type CreateArg<K extends keyof Cols> = Cols[K] extends {
	create: (input: infer I, ...rest: any[]) => any;
}
	? I
	: never;

/** updateById params for collection K — its `id` member is `ExtractIdType`-threaded. */
type UpdateByIdArg<K extends keyof Cols> = Cols[K] extends {
	updateById: (params: infer P, ...rest: any[]) => any;
}
	? P
	: never;

/** The id type the by-id surface threads for collection K. */
type ByIdIdType<K extends keyof Cols> = UpdateByIdArg<K> extends { id: infer I }
	? I
	: never;

// Sanity: the extractors resolve to real objects, never `any`/`never`.
// (If these fail the whole file is probing the wrong surface — keep them green.)
type _sanityArticleCreate = Expect<NoAny<CreateArg<"articles">>>;
type _sanityArticleCreateNotNever = Expect<NoNever<CreateArg<"articles">>>;
type _sanityTicketUpdate = Expect<NoAny<UpdateByIdArg<"tickets">>>;

// ============================================================================
// A — crudin-2: nested-mutation freshness (excess keys must be REJECTED)
//
// The TOP-LEVEL create input already rejects excess keys (single object type).
// The NESTED `create` / `connectOrCreate.create` are typed `TInsert | TInsert[]`
// (a union) which disables freshness → excess keys silently accepted today.
//
// HARD RULE §4.1 #5: freshness via `Exact<TInput, Shape>` is GENERIC-PARAMETER
// CAPTURE — it only fires at the CALL site (`app.collections.x.create(…)`), not
// on an assignment to `Parameters<…>[0]`. So these are real call sites on a
// `declare const app: QuestpieApp` value, mirroring field-input-integrity.test-d.ts.
// ============================================================================

declare const app: QuestpieApp;

// --- A.0  Positive control: a VALID create payload still compiles (call site). ---
// (Guards against `Exact<…>` over-restricting once the fix lands. `articles`
// requires title/slug; author FK is optionalized via nested mutation.)
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: { connect: { id: "author-1" } },
});

// --- A.1  TOP-LEVEL excess key is rejected (positive control). ---
// Restored by the `ForbidExcessKeys` (`Exact`) guard on the create parameter —
// generic capture (`create<TInput …>`) had defeated plain excess checks at the
// top level too; this directive is USED once the guard lands and must stay green.
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	// @ts-expect-error — excess key rejected at top level (Exact guard).
	phantomTop: 1,
});

// --- A.1b  POSITIVE COMPANION for the nested-create shape (must stay green). ---
// Identical to A.2/A.4 minus the phantom key. If THIS errors, the nested payload
// shape itself is wrong (e.g. FK naming) — distinguishes "wrong fixture" from
// "freshness fix not landed yet" per HARD RULE §4.1 #4. The nested `TInsert` is
// the target's RAW insert model, so FK columns are plain strings.
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	comments: {
		create: { content: "hi", article: "a-1", author: "author-1" },
	},
});

// --- A.2  NESTED `create` excess key must be REJECTED (FAILS today). ---
// Today the directive below is UNUSED (reported as TS2578) because the union
// `TInsert | TInsert[]` disables freshness on the nested member. After the fix
// (`Exact` wrap) the phantom key errors and the directive becomes used.
// The nested payload is otherwise COMPLETE (target `article_comments` requires
// content + the article/author FKs, supplied as raw FK strings) so the ONLY
// candidate error is the phantom key — no masking by an unrelated missing field.
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	comments: {
		create: {
			content: "hi",
			article: "a-1",
			author: "author-1",
			// @ts-expect-error — nested create payload must reject phantom keys.
			phantomNested: 1,
		},
	},
});

// --- A.3  NESTED `connectOrCreate.create` excess key must be REJECTED. ---
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	comments: {
		connectOrCreate: {
			where: { id: "c-1" },
			create: {
				content: "hi",
				article: "a-1",
				author: "author-1",
				// @ts-expect-error — connectOrCreate.create must reject phantom keys.
				phantomCoc: 1,
			},
		},
	},
});

// --- A.4  NESTED create TYPO must be REJECTED (the real-world footgun). ---
// `contnet` instead of `content` is silently dropped at runtime today.
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	comments: {
		create: {
			content: "hi",
			article: "a-1",
			author: "author-1",
			// @ts-expect-error — a typo'd nested key must be a compile error.
			contnet: "typo",
		},
	},
});

// --- A.5  Nested create-MEMBER well-formed (guards the union is not `any`). ---
// An `any` member would mean freshness can never apply on either surface; the
// fix wraps a CONCRETE insert shape. (Structural, surface-independent.)
type CommentsCreateMember = CreateArg<"articles"> extends {
	comments?: infer M;
}
	? M
	: never;
type _commentsMemberNotAny = Expect<NoAny<CommentsCreateMember>>;
type _commentsMemberNotNever = Expect<NoNever<CommentsCreateMember>>;

// --- A.6  Positive control (sequenced AFTER CL-01): a VALID nested OBJECT-field
// value must still compile — `Exact` over object/json values (whose CL-01
// shapes may carry index signatures) must NOT mis-fire and reject legit nesting. ---
void app.collections.articles.create({
	title: "Hello",
	slug: "hello",
	tagList: ["a"],
	author: "author-1",
	meta: {
		seoTitle: "t",
		seoDescription: "d",
		featured: true,
		keywords: ["a", "b"],
	},
});

// ============================================================================
// B — crudin-3: nested-relation id type threads ExtractIdType (numeric PK)
//
// `tickets` has `id: f.number()` (numeric PK) and a self-relation `parent`.
// `NestedRelationConnect.id` etc. are hardcoded `string` today → these FAIL
// until the shapes thread `ExtractIdType<ExtractRelationSelect<…>>`.
// ============================================================================

// --- B.0  Positive control: ExtractIdType reaches the public by-id surface. ---
// `tickets.updateById({ id })` must take `number`; `authors` must take `string`.
// (`updateById` already threads `TId = ExtractIdType<TSelect>`, so these are the
//  baseline the nested-mutation shapes should MATCH. The numeric one may already
//  be green if `tickets.id` flows; the string one is a control.)
type _ticketByIdIsNumber = ExactType<ByIdIdType<"tickets">, number>;
type _authorByIdIsString = ExactType<ByIdIdType<"authors">, string>;
type _ticketByIdNotString = Expect<Not<Equal<ByIdIdType<"tickets">, string>>>;

// --- Extract the nested `parent` mutation off the tickets create input. ---
// `tickets.parent` is a to-one self-relation; its nested mutation `connect.id`
// and `connectOrCreate.where.id` should be `number` (target = tickets, PK number).
type TicketParentMutation = CreateArg<"tickets"> extends { parent?: infer M }
	? M
	: never;
type _ticketParentNotAny = Expect<NoAny<TicketParentMutation>>;

type TicketParentConnect = TicketParentMutation extends {
	connect?: infer C;
}
	? NonNullable<C>
	: never;
// `connect` may be `Connect | Connect[]`; isolate the single-object arm.
type TicketParentConnectId = TicketParentConnect extends { id: infer I }
	? I
	: TicketParentConnect extends readonly { id: infer I2 }[]
		? I2
		: never;

// --- B.1  Numeric-PK self-relation connect id must be `number` (FAILS today). ---
type _ticketParentConnectIdNumber = ExactType<TicketParentConnectId, number>;
type _ticketParentConnectIdNotString = Expect<
	Not<Equal<TicketParentConnectId, string>>
>;

// --- B.2  Numeric-PK connectOrCreate.where id must be `number` (FAILS today). ---
type TicketParentCoc = TicketParentMutation extends {
	connectOrCreate?: infer C;
}
	? NonNullable<C>
	: never;
type TicketParentCocWhere = TicketParentCoc extends { where: infer W }
	? W
	: TicketParentCoc extends readonly { where: infer W2 }[]
		? W2
		: never;
// `where` is `{ id } | Partial<TInsert>`; extract the by-id arm's id.
type TicketParentCocWhereId = Extract<
	TicketParentCocWhere,
	{ id: any }
> extends { id: infer I }
	? I
	: never;
type _ticketParentCocWhereIdNumber = ExactType<TicketParentCocWhereId, number>;

// --- B.3  String-PK control: an `authors`-targeting connect stays `string`. ---
// `articles.author` → authors (string PK). After the fix this must remain
// `string`, proving the threading is target-driven, not blanket-numeric.
type ArticleAuthorMutation = CreateArg<"articles"> extends { author?: infer M }
	? M
	: never;
type ArticleAuthorConnect = ArticleAuthorMutation extends { connect?: infer C }
	? NonNullable<C>
	: never;
type ArticleAuthorConnectId = ArticleAuthorConnect extends { id: infer I }
	? I
	: ArticleAuthorConnect extends readonly { id: infer I2 }[]
		? I2
		: never;
type _articleAuthorConnectIdString = ExactType<ArticleAuthorConnectId, string>;

// --- B.4  Canonical-plumbing identity over the resolved relation value. ---
// The fix should thread `ExtractIdType<ExtractRelationSelect<RelationValue>>`.
// Resolve the relation VALUE for `tickets.parent` from the app-aware relations
// map and read its select id — the numeric-PK target must surface `id: number`,
// independent of HOW the nested-mutation shape is rewritten.
type TicketRelations = CollectionRelationsFromApp<
	App["collections"]["tickets"],
	App
>;
type TicketParentRelSelect = TicketRelations extends { parent: infer R }
	? ExtractRelationSelect<R>
	: never;
type _ticketRelSelectNotNever = Expect<NoNever<TicketParentRelSelect>>;
type _ticketSelectIdNumber = ExactType<
	TicketParentRelSelect extends { id: infer I } ? I : never,
	number
>;

// ============================================================================
// C — crudin-4 / FGC-5 / clsdk-date: date create/where symmetry on `string`
//
// AUTHORITATIVE TARGET (reviewer sub-fix B): date create === date where === string;
// datetime create === datetime where === Date. The runtime stores ISO strings and
// the WHERE narrows from `Date|string` → `string` (it does NOT widen create to
// Date). We assert the SYMMETRY invariant + the concrete `string`/`Date` types.
// ============================================================================

// --- Date / datetime CREATE input value types (off the real create surface). ---
type ArticleCreate = CreateArg<"articles">;
type PublishedOnCreate = ArticleCreate extends { publishedOn?: infer D }
	? D
	: never; // f.date()      → string
type PublishedAtCreate = ArticleCreate extends { publishedAt?: infer D }
	? D
	: never; // f.datetime()  → Date

// --- Date / datetime WHERE operator-operand types (off the real where surface). ---
// A scalar field's collection-level where value is `FieldSelect | FieldWhere`
// (the operator OBJECT unioned with the bare-value shorthand: `where:{ d:"…" }`).
// Isolate the operator-object arm (the one carrying `gte`) before reading operands.
type ArticleWhere = WhereType<App["collections"]["articles"], App>;
type PublishedOnWhereOps = ArticleWhere extends { publishedOn?: infer O }
	? Extract<NonNullable<O>, { gte?: unknown }>
	: never;
type PublishedAtWhereOps = ArticleWhere extends { publishedAt?: infer O }
	? Extract<NonNullable<O>, { gte?: unknown }>
	: never;
type PublishedOnWhereVal = PublishedOnWhereOps extends { gte?: infer V }
	? V
	: never;
type PublishedAtWhereVal = PublishedAtWhereOps extends { gte?: infer V }
	? V
	: never;

// --- C.0  Sanity: the extracted where-op operands are real (not any/never). ---
type _pubOnWhereSane = Expect<NoAny<PublishedOnWhereVal>>;
type _pubOnWhereNotNever = Expect<NoNever<PublishedOnWhereVal>>;

// --- C.1  Date create stays exactly `string` (target after fix). ---
// Raw findings (clsdk-date, FGC-5) phrase the target as `Date | string`; the
// reviewer override (sub-fix B) keeps create `string`. Authoritative = `string`.
type _dateCreateIsString = ExactType<NonNullable<PublishedOnCreate>, string>;

// --- C.2  Date WHERE narrows to `string` (FAILS today: it is `DateInput`). ---
// Today `publishedOn` where `gte` is `DateInput = Date | string`. After the fix
// it is `string`, dropping the `Date` arm that create could never accept.
type _dateWhereIsString = ExactType<PublishedOnWhereVal, string>;
// `Date` must NOT be assignable to the date where-operand after the fix.
// Today `[Date] extends [DateInput]` is TRUE → `Not<true>` = false → RED now;
// after narrowing to `string` it flips to GREEN. (Assignability, not `Equal`,
// to side-step the `DateInput` brand which would make a bare `Equal` non-discriminating.)
type _dateWhereRejectsDate = Expect<
	Not<[Date] extends [PublishedOnWhereVal] ? true : false>
>;

// --- C.3  THE SYMMETRY INVARIANT: date create === date where (FAILS today). ---
// This is the heart of the cluster: filter-input and create-input must agree.
type _dateCreateWhereSymmetry = ExactType<
	NonNullable<PublishedOnCreate>,
	PublishedOnWhereVal
>;

// --- C.4  datetime contract is UNCHANGED — create === where === Date (control). ---
// `f.datetime()` is already symmetric on Date; these must stay green through the fix.
type _datetimeCreateIsDate = ExactType<NonNullable<PublishedAtCreate>, Date>;
type _datetimeWhereAcceptsDate = Expect<[Date] extends [PublishedAtWhereVal] ? true : false>;
type _datetimeCreateWhereSymmetry = Expect<
	[NonNullable<PublishedAtCreate>] extends [PublishedAtWhereVal]
		? [PublishedAtWhereVal] extends [Date | string]
			? true
			: false
		: false
>;

// --- C.5  Date and datetime are NOT the same input type (the asymmetry root). ---
// Documents that the two date-like fields are distinct (string vs Date) — this
// stays true through the fix; it is the asymmetry that motivated narrowing where,
// not unifying the two field families.
type _dateVsDatetimeDistinct = Expect<
	Not<Equal<NonNullable<PublishedOnCreate>, NonNullable<PublishedAtCreate>>>
>;

// --- C.6  Neither date-like create value degraded to any/unknown. ---
type _dateCreateNotAny = Expect<NoAny<PublishedOnCreate>>;
type _dateCreateNotUnknown = Expect<NoUnknown<PublishedOnCreate>>;
type _datetimeCreateNotAny = Expect<NoAny<PublishedAtCreate>>;

// ============================================================================
// Cross-checks — the nested-mutation helper shapes are present & well-formed.
// (Guard the probes above against silently resolving to `never`.)
// ============================================================================

type _hasConnect = Expect<HasKey<NestedRelationMutation<{ x: 1 }>, "connect">>;
type _hasCreate = Expect<HasKey<NestedRelationMutation<{ x: 1 }>, "create">>;
type _hasConnectOrCreate = Expect<
	HasKey<NestedRelationMutation<{ x: 1 }>, "connectOrCreate">
>;
type _hasSet = Expect<HasKey<NestedRelationMutation<{ x: 1 }>, "set">>;
// `NestedRelationConnectOrCreate.where` exists and is not `never`.
type _cocWhereNotNever = Expect<
	IsNever<NestedRelationConnectOrCreate<{ x: 1 }>["where"]> extends true
		? false
		: true
>;
