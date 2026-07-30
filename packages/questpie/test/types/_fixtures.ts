/**
 * Type-Safety Regression — Shared Fixtures
 *
 * Phase 3a framework. A realistic, in-package collection/global graph that
 * exercises EVERY root-cause cluster's scenario, constructed with the real
 * `collection()` / `global()` factories exactly the way the existing
 * `crud-deep-typesafety.test-d.ts` does.
 *
 * THESE FIXTURES MUST COMPILE. They model both the correct and the currently
 * degraded shapes — it is the *assertions* in the per-cluster `clusters/*.test-d.ts`
 * files that fail (RED) until the source fixes land.
 *
 * COVERAGE MAP (what each cluster imports from here):
 *
 *   CL-01  module-field flow .... `articles.body`/`articles.config` (richText-like json),
 *                                 `articles.meta` (blocks-like object), `RichTextLikeState`/
 *                                 `BlocksLikeState` phantom states, `~fieldTypes` typo probes.
 *                                 NOTE: real richText/blocks live in @questpie/admin and are
 *                                 NOT importable from the `questpie` package — see §RichText/Blocks.
 *   CL-02  relation cardinality . `articles.comments` (hasMany), `articles.categories`
 *                                 (manyToMany), `articles.gallery` (multiple), `siteGlobal.partners`
 *                                 (global m2m), `categories.parent` (self-ref to-one).
 *   CL-03  globals parity ....... `siteGlobal` (select+array+object+relation), `alertsGlobal`
 *                                 (select-union `alertType`), `socialGlobal.socialLinks`.
 *   CL-04  job/workflow ctx ..... `app`/`questpieApp` shapes (probe via QuestpieApp ctx in cluster).
 *   CL-05  hook/access ctx ...... built collections expose `.access()`/`.hooks()`; cluster augments.
 *   CL-06  relation-string ...... every `f.relation("...")` target name is a real collection key.
 *   CL-07  where operators ...... `articles.status`/`tickets.priority` (select), `tickets.scores`
 *                                 (number[]), `articles.meta`/`config` (json/object), date fields.
 *   CL-08  array nullability .... `articles.tagList` (required array), `tickets.scores`
 *                                 (required number[]), `articles.optTags` (optional array),
 *                                 `articles.defTags` (default array), `siteGlobal.featureFlags`.
 *   CL-09  routes ............... routes are not collections; cluster builds its own route fixtures.
 *   CL-10  client/server row .... `App` (server) + `ClientApp`/`AppFromCollectionsShape` for client
 *                                 1-arg select; `articles`/`authors` for identity probes.
 *   CL-11  crud input precision . `tickets` (numeric PK + self-ref), `articles.publishedOn`
 *                                 (date, string), `articles.publishedAt` (datetime, Date).
 *   CL-12  context strictness ... cluster builds its own ctx args; uses `App` for CRUD signatures.
 *   CL-13  nested object/json ... `articles.meta` (nested object with outputFalse + virtual),
 *                                 `articles.config` (json), `JsonHolderState`.
 *   CL-14  relation depth ....... `categories.parent` self-ref, `treeGlobal.root` self-relating
 *                                 global, depth probes via `App`.
 *
 * @see crud-deep-typesafety.test-d.ts — the construction pattern this mirrors.
 */

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import { global } from "#questpie/server/global/builder/global-builder.js";

// ============================================================================
// §RichText/Blocks phantom states
//
// `f.richText()` / `f.blocks()` are contributed by the @questpie/admin module,
// which the `questpie` package does NOT depend on — they cannot be imported
// here. CL-01's membership/identity assertions bind to these locally-declared
// phantom states (shape-mirrored from packages/admin/.../rich-text.ts and
// blocks.ts) plus the object/json fixtures below. A cluster test running in a
// tsconfig that *can* reach @questpie/admin may substitute the real types.
// ============================================================================

/** Mirrors @questpie/admin TipTapDocument (rich-text.ts:49). */
export interface TipTapDocumentLike {
	type: "doc";
	content?: TipTapNodeLike[];
}
export interface TipTapNodeLike {
	type: string;
	content?: TipTapNodeLike[];
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/** Mirrors @questpie/admin BlocksDocument (blocks.ts:59). */
export interface BlocksDocumentLike {
	_tree: Array<{ id: string; type: string; children?: unknown[] }>;
	[blockId: string]: unknown;
}

/** Phantom field-state for a `json`-mode richText field (rich-text.ts:221). */
export type RichTextLikeState = {
	type: "richText";
	data: TipTapDocumentLike;
	notNull: boolean;
	hasDefault: boolean;
	localized: boolean;
	virtual: false;
	input: true;
	output: true;
	isArray: false;
};

/** Phantom field-state for a `blocks` field (blocks.ts:185). */
export type BlocksLikeState = {
	type: "blocks";
	data: BlocksDocumentLike;
	notNull: boolean;
	hasDefault: boolean;
	localized: boolean;
	virtual: false;
	input: true;
	output: true;
	isArray: false;
};

// ============================================================================
// COLLECTIONS
// ============================================================================

/**
 * authors — simple base collection. Targets of to-one + to-many relations.
 * Has a boolean (CL-07 boolean ops), localized + nullable fields (CL-10 readonly,
 * CL-08 controls).
 */
export const authors = collection("authors")
	.fields(({ f }) => ({
		name: f.text(100).required(),
		email: f.text().required(),
		bio: f.textarea().localized(),
		active: f.boolean().default(true),
		age: f.number(),
	}))
	.options({ timestamps: true });

/**
 * categories — SELF-REFERENTIAL to-one relation (`parent`) for CL-14 depth and
 * CL-02 self-ref. Also a to-many `children` reverse via hasMany.
 */
export const categories = collection("categories").fields(({ f }) => ({
	name: f.text(100).required(),
	slug: f.text().required(),
	description: f.textarea(),
	// Self-referential to-one — CL-14 depth, CL-02 self-ref.
	parent: f.relation("categories").relationName("categoryParent"),
	// Self-referential to-many — reverse edge.
	children: f
		.relation("categories")
		.hasMany({ foreignKey: "parent", relationName: "categoryParent" }),
}));

/**
 * articles — the dense fixture. Exercises CL-01 (richText/blocks-like via
 * json/object), CL-02 (all relation cardinalities), CL-07 (select/json/object/
 * number-array/date where), CL-08 (required/optional/default arrays), CL-10
 * (readonly row), CL-11 (date vs datetime), CL-13 (nested object shaping).
 */
export const articles = collection("articles")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		content: f.textarea().localized(),
		slug: f.text().required(),
		views: f.number().default(0),
		rating: f.number(),
		published: f.boolean().default(false),

		// CL-07 / CL-02(where): select literal-union field.
		status: f.select([
			{ value: "draft", label: "Draft" },
			{ value: "review", label: "In Review" },
			{ value: "published", label: "Published" },
		] as const),

		// CL-01 richText-like: free-form typed JSON standing in for a richText doc.
		body: f.json(),

		// CL-13 nested f.object() — includes an OUTPUT-only-false field and a
		// nested array, to probe nested field-shaping (json-3) and top-level $infer.
		meta: f.object({
			seoTitle: f.text(60),
			seoDescription: f.textarea().max(160),
			featured: f.boolean().default(false),
			internalScore: f.number().outputFalse(),
			keywords: f.text().required().array(),
		}),

		// CL-07 / CL-13 schema-less JSON.
		config: f.json(),

		// CL-08: REQUIRED array → should select as `string[]` (NOT `string[] | null`)
		// and be required+non-null on insert.
		tagList: f.text().required().array(),
		// CL-08 control: OPTIONAL array → `string[] | null`.
		optTags: f.text().array(),
		// CL-08 control: DEFAULTED array → optional on insert.
		defTags: f.text().array().default(["new"]),

		// CL-02 to-one belongsTo (required) — FK optionalized on create (nested mutation).
		author: f.relation("authors").required().relationName("articleAuthor"),

		// CL-02 to-many: manyToMany (junction table).
		categories: f.relation("categories").manyToMany({
			through: "article_categories",
			sourceField: "article",
			targetField: "category",
		}),

		// CL-02 to-many: hasMany (FK on target).
		comments: f
			.relation("article_comments")
			.hasMany({ foreignKey: "article", relationName: "articleComment" }),

		// CL-02 to-many: multiple (inline jsonb array of FKs) → `string[] | null`.
		gallery: f.relation("media").multiple(),

		// CL-11: date field (data: string, mode "string") vs datetime (data: Date).
		publishedOn: f.date(),
		publishedAt: f.datetime(),
	}))
	.options({ softDelete: true, versioning: true });

/**
 * article_comments — to-one relations back to articles + authors. Used for
 * reverse/circular where nesting (CL-02 where) and depth (CL-14).
 */
export const articleComments = collection("article_comments").fields(
	({ f }) => ({
		content: f.textarea().required(),
		article: f.relation("articles").required().relationName("articleComment"),
		author: f.relation("authors").required().relationName("commentAuthor"),
	}),
);

/** article_categories — junction collection for the manyToMany above. */
export const articleCategories = collection("article_categories").fields(
	({ f }) => ({
		article: f.relation("articles").required().onDelete("cascade"),
		category: f.relation("categories").required().onDelete("cascade"),
	}),
);

/** media — upload collection; to-many `multiple()` target (articles.gallery). */
export const media = collection("media")
	.fields(({ f }) => ({
		alt: f.text(255),
		caption: f.textarea().localized(),
	}))
	.upload({ visibility: "public" });

/**
 * tickets — NUMERIC PRIMARY KEY (`id: f.number()`) + self-relation, for CL-11
 * (crudin-3 nested-id type must thread `number`, not hardcoded `string`) and a
 * second self-referential graph for CL-14. Also a REQUIRED number[] (CL-08) and
 * a select-union (CL-07 array/scalar where over non-string).
 */
export const tickets = collection("tickets").fields(({ f }) => ({
	// Explicit numeric id overrides the auto-injected text PK (builder:
	// `"id" extends keyof TFields ? {} : pkCols`).
	id: f.number().required(),
	subject: f.text(255).required(),
	priority: f.select([
		{ value: "low", label: "Low" },
		{ value: "medium", label: "Medium" },
		{ value: "high", label: "High" },
	] as const),
	// CL-08: required number[] → `number[]` select, required on insert.
	scores: f.number().required().array(),
	// CL-11 / CL-14: self-relation on a numeric-PK collection.
	parent: f.relation("tickets").relationName("ticketParent"),
}));

// ============================================================================
// GLOBALS — exercise the field-def pipeline (CL-03 parity).
//
// Globals support the SAME `({ f }) => ({...})` callback form as collections,
// so they go through FieldSelect/ExtractInputType once CL-03 lands.
// ============================================================================

/**
 * siteGlobal — globals parity flagship: select + array + object + RELATION.
 * Covers CL-03 (write-input parity), CL-08-globals (required array select),
 * CL-02 (global m2m relation → array `with`).
 */
export const siteGlobal = global("site").fields(({ f }) => ({
	siteName: f.text(255).required(),
	tagline: f.text(),
	// CL-03 select-union on a global.
	theme: f.select([
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
		{ value: "system", label: "System" },
	] as const),
	// CL-08-globals: required array (SELECT fixed for free; INSERT tracked by CL-03).
	featureFlags: f.text().required().array(),
	// CL-03 object field on a global.
	contact: f.object({
		email: f.text().required(),
		phone: f.text(),
	}),
	// CL-02 global m2m relation → array `with`-population.
	partners: f.relation("authors").manyToMany({
		through: "site_partners",
		sourceField: "site",
		targetField: "author",
	}),
	// CL-02 global to-one relation.
	owner: f.relation("authors").relationName("siteOwner"),
}));

/**
 * alertsGlobal — the city-portal `alertType` select-union global (CL-03's
 * write-input union test binds here). Union: 'info' | 'warning' | 'emergency'.
 */
export const alertsGlobal = global("alerts").fields(({ f }) => ({
	alertType: f.select([
		{ value: "info", label: "Info" },
		{ value: "warning", label: "Warning" },
		{ value: "emergency", label: "Emergency" },
	] as const),
	message: f.textarea(),
	active: f.boolean().default(false),
}));

/**
 * socialGlobal — the barbershop `socialLinks` pattern: `object({...}).array()`
 * with a nested select-union. CL-03 cross-entity parity asserts this equals the
 * collection-side equivalent. Platform union mirrors the real fixture:
 * instagram | facebook | twitter | tiktok | youtube.
 */
export const socialGlobal = global("social").fields(({ f }) => ({
	navigation: f
		.object({
			label: f.text().required(),
			href: f.text().required(),
		})
		.array(),
	socialLinks: f
		.object({
			platform: f
				.select([
					{ value: "instagram", label: "Instagram" },
					{ value: "facebook", label: "Facebook" },
					{ value: "twitter", label: "Twitter/X" },
					{ value: "tiktok", label: "TikTok" },
					{ value: "youtube", label: "YouTube" },
				] as const)
				.required(),
			url: f.text().required(),
		})
		.array(),
}));

/**
 * treeGlobal — SELF-RELATING global (relation target is a collection that
 * self-references) for CL-14 globals-on-relation-target depth parity. The
 * global → relation → (collection) → self path is where the non-app-aware
 * resolver drops `TApp`.
 */
export const treeGlobal = global("tree").fields(({ f }) => ({
	label: f.text().required(),
	root: f.relation("categories").relationName("treeRoot"),
}));

// ============================================================================
// APP SHAPES
//
// Two shapes, mirroring how crud-deep-typesafety.test-d.ts probes the system:
//
//   App           — the MANUAL `{ collections, globals }` shape that the 2-arg
//                   CRUD helpers (CollectionSelectFromApp, Where<T, App>,
//                   FindOptions<T, App>, ApplyQuery, CollectionRelationsFromApp)
//                   actually consume via `AppCollections<TApp>`. This is also
//                   exactly `AppFromCollections<TCollections>` (+ globals), the
//                   shape the server runtime uses. USE THIS for select/where/
//                   relation/depth probes.
//
//   QuestpieApp   — the REAL public `Questpie<...>` class-instance type, for
//                   probing `app.collections.X.find()` / `app.globals.Y.get()`
//                   CRUD method signatures and return shapes (CL-04 ctx, CL-09,
//                   CL-10 client==server, CL-12 ctx arg).
//
// HARD RULE (§4.1): route multi-entity / id-type probes through GetCollection /
// GetGlobal against `Collections` / `Globals` below, NOT through a raw builder
// (a raw builder hits a `never`-fallback and passes vacuously).
// ============================================================================

/** Collections map — mirrors the codegen-generated composition. */
export type Collections = {
	authors: typeof authors;
	categories: typeof categories;
	articles: typeof articles;
	article_comments: typeof articleComments;
	article_categories: typeof articleCategories;
	media: typeof media;
	tickets: typeof tickets;
};

/** Globals map — mirrors the codegen-generated composition. */
export type Globals = {
	site: typeof siteGlobal;
	alerts: typeof alertsGlobal;
	social: typeof socialGlobal;
	tree: typeof treeGlobal;
};

/**
 * The MANUAL app shape consumed by the 2-arg CRUD helpers. Equivalent to
 * `AppFromCollections<Collections>` extended with globals.
 */
export type App = {
	collections: Collections;
	globals: Globals;
};

/**
 * Collections-only app shape (exactly `AppFromCollections<Collections>`), for
 * helpers/tests that thread only collections (client row resolution, CL-10).
 */
export type AppFromCollectionsShape = {
	collections: Collections;
};

/**
 * The REAL public `Questpie<...>` instance type — the surface users get.
 * Probe `QuestpieApp["collections"]["articles"]["find"]` etc. for CRUD method
 * shapes (CL-04/CL-09/CL-10/CL-12).
 *
 * The config mirrors the codegen-emitted `_AppQuestpieConfig` (cli/codegen/
 * template.ts): the base `QuestpieConfig` carries `collections`/`globals` as
 * `Record<string, …>` index signatures, so they MUST be `Omit`-ted before being
 * overridden with the concrete maps — otherwise the intersection leaks a phantom
 * `string` index into `keyof Questpie["collections"]` (the exact asymmetry CL-04
 * §6 pins). The generated app omits them; this fixture must too, to faithfully
 * model the real `app.collections` surface.
 */
export type QuestpieApp = Questpie<
	Omit<QuestpieConfig, "collections" | "globals"> & {
		collections: Collections;
		globals: Globals;
	}
>;

/**
 * Client-facing app shape. Today the client SDK routes rows through the legacy
 * 1-arg `CollectionSelect<T>` (shared/type-utils) — CL-10 unifies it onto the
 * app-aware path. Cluster CL-10 imports `Collections` and probes both the 1-arg
 * (client) and 2-arg (server) selectors for identity.
 */
export type ClientApp = AppFromCollectionsShape;
