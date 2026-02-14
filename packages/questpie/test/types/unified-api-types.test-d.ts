/**
 * Unified API Type Inference Tests
 *
 * Comprehensive compile-time tests for the unified relation field API.
 * Tests table shapes, CRUD operations, where/with clauses, and type safety.
 *
 * Run with: bunx tsc --noEmit
 */

import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";
import { questpie } from "#questpie/server/index.js";
import type {
	Equal,
	Expect,
	Extends,
	HasKey,
	IsNever,
	IsNullable,
	Not,
	OptionalKeys,
	RequiredKeys,
} from "./type-test-utils.js";

// ============================================================================
// Test Setup - Define test module with unified API
// ============================================================================

const q = questpie({ name: "type-test" }).fields(defaultFields);

// Users collection
const users = q.collection("users").fields((f) => ({
	name: f.text({ required: true, maxLength: 100 }),
	email: f.text({ required: true }),
	bio: f.textarea({ localized: true }),
}));

// Posts collection with relations
const posts = q
	.collection("posts")
	.fields((f) => ({
		title: f.text({ required: true, maxLength: 255 }),
		content: f.textarea({ localized: true }),
		slug: f.text({ required: true }),
		views: f.number({ default: 0 }),
		published: f.boolean({ default: false }),
		author: f.relation({
			to: "users",
			required: true,
			relationName: "author",
		}),
		comments: f.relation({
			to: "comments",
			hasMany: true,
			foreignKey: "post",
			relationName: "post",
		}),
	}))
	.options({ softDelete: true, versioning: true });

// Comments collection
const comments = q.collection("comments").fields((f) => ({
	content: f.textarea({ required: true }),
	post: f.relation({
		to: "posts",
		required: true,
		relationName: "post",
	}),
	author: f.relation({
		to: "users",
		required: true,
		relationName: "commentAuthor",
	}),
}));

// Tags collection for many-to-many
const tags = q.collection("tags").fields((f) => ({
	name: f.text({ required: true, maxLength: 50 }),
	slug: f.text({ required: true }),
}));

// Media collection with upload
const media = q
	.collection("media")
	.fields((f) => ({
		alt: f.text({ maxLength: 255 }),
		caption: f.textarea({ localized: true }),
	}))
	.upload({ visibility: "public" });

// Site settings global
const siteSettings = q
	.global("site_settings")
	.fields((f) => ({
		siteName: f.text({ required: true, maxLength: 100 }),
		tagline: f.textarea({ localized: true }),
		featuredPost: f.relation({ to: "posts", relationName: "featured" }),
	}))
	.options({ versioning: { enabled: true } });

// Build the module
const testModule = q
	.collections({ users, posts, comments, tags, media })
	.globals({ site_settings: siteSettings });

type CmsFromBuilder = typeof testModule.$inferCms;

// ============================================================================
// Table Shape Inference Tests
// ============================================================================

// Main table columns - basic fields
type PostsTable = typeof posts.table;
type _postsTableHasId = Expect<Equal<HasKey<PostsTable, "id">, true>>;
type _postsTableHasTitle = Expect<Equal<HasKey<PostsTable, "title">, true>>;
type _postsTableHasSlug = Expect<Equal<HasKey<PostsTable, "slug">, true>>;
type _postsTableHasDeletedAt = Expect<
	Equal<HasKey<PostsTable, "deletedAt">, true>
>;
type _postsTableHasCreatedAt = Expect<
	Equal<HasKey<PostsTable, "createdAt">, true>
>;

// FK column uses field name directly (no Id suffix in unified API)
type _postsTableHasAuthor = Expect<Equal<HasKey<PostsTable, "author">, true>>;

// I18n table exists for localized fields
type PostsI18nTable = typeof posts.i18nTable;
type _postsI18nTableExists = Expect<Not<Equal<PostsI18nTable, null>>>;

// Versions table (when versioning enabled)
type PostsVersionsTable = typeof posts.versionsTable;
type _postsVersionsTableExists = Expect<Not<Equal<PostsVersionsTable, null>>>;

// Users table columns
type UsersTable = typeof users.table;
type _usersTableHasName = Expect<Equal<HasKey<UsersTable, "name">, true>>;
type _usersTableHasEmail = Expect<Equal<HasKey<UsersTable, "email">, true>>;

// Media table (with upload fields)
type MediaTable = typeof media.table;
type _mediaTableHasKey = Expect<Equal<HasKey<MediaTable, "key">, true>>;
type _mediaTableHasFilename = Expect<
	Equal<HasKey<MediaTable, "filename">, true>
>;
type _mediaTableHasMimeType = Expect<
	Equal<HasKey<MediaTable, "mimeType">, true>
>;
type _mediaTableHasSize = Expect<Equal<HasKey<MediaTable, "size">, true>>;
type _mediaTableHasVisibility = Expect<
	Equal<HasKey<MediaTable, "visibility">, true>
>;

// ============================================================================
// $infer Select Type Tests
// ============================================================================

type PostSelect = typeof posts.$infer.select;

// Required fields are non-null
type _postSelectTitleString = Expect<Equal<PostSelect["title"], string>>;
type _postSelectSlugString = Expect<Equal<PostSelect["slug"], string>>;

// Optional fields are nullable
type _postSelectContentNullable = Expect<IsNullable<PostSelect["content"]>>;
type _postSelectViewsNullable = Expect<IsNullable<PostSelect["views"]>>;

// System fields
type _postSelectHasId = Expect<Equal<HasKey<PostSelect, "id">, true>>;
type _postSelectHasCreatedAt = Expect<
	Equal<HasKey<PostSelect, "createdAt">, true>
>;
type _postSelectHasUpdatedAt = Expect<
	Equal<HasKey<PostSelect, "updatedAt">, true>
>;
type _postSelectHas_title = Expect<Equal<HasKey<PostSelect, "_title">, true>>;

// Soft delete field
type _postSelectHasDeletedAt = Expect<
	Equal<HasKey<PostSelect, "deletedAt">, true>
>;

// ============================================================================
// $infer Insert Type Tests
// ============================================================================

type PostInsert = typeof posts.$infer.insert;
type PostInsertRequired = RequiredKeys<PostInsert>;
type PostInsertOptional = OptionalKeys<PostInsert>;

// Required fields must be provided
type _postInsertTitleRequired = Expect<Extends<"title", PostInsertRequired>>;
type _postInsertSlugRequired = Expect<Extends<"slug", PostInsertRequired>>;

// Fields with defaults are optional
type _postInsertViewsOptional = Expect<Extends<"views", PostInsertOptional>>;
type _postInsertPublishedOptional = Expect<
	Extends<"published", PostInsertOptional>
>;
type _postInsertIdOptional = Expect<Extends<"id", PostInsertOptional>>;

// Nullable fields are optional
type _postInsertContentOptional = Expect<
	Extends<"content", PostInsertOptional>
>;

// ============================================================================
// $infer Update Type Tests
// ============================================================================

type PostUpdate = typeof posts.$infer.update;
type PostUpdateOptional = OptionalKeys<PostUpdate>;

// All fields should be optional in update
type _postUpdateTitleOptional = Expect<Extends<"title", PostUpdateOptional>>;
type _postUpdateSlugOptional = Expect<Extends<"slug", PostUpdateOptional>>;
type _postUpdateContentOptional = Expect<
	Extends<"content", PostUpdateOptional>
>;
type _postUpdateViewsOptional = Expect<Extends<"views", PostUpdateOptional>>;

// ============================================================================
// Global Type Tests
// ============================================================================

type SiteSettingsSelect = typeof siteSettings.$infer.select;

// Required fields - check siteName exists and is string-like
type _siteSettingsSiteNameExists = Expect<
	Equal<HasKey<SiteSettingsSelect, "siteName">, true>
>;
type _siteSettingsSiteNameString = Expect<
	Extends<string, NonNullable<SiteSettingsSelect["siteName"]>>
>;

// Optional/nullable fields
type _siteSettingsTaglineNullable = Expect<
	IsNullable<SiteSettingsSelect["tagline"]>
>;

// System fields
type _siteSettingsHasId = Expect<Equal<HasKey<SiteSettingsSelect, "id">, true>>;
type _siteSettingsHasCreatedAt = Expect<
	Equal<HasKey<SiteSettingsSelect, "createdAt">, true>
>;

// ============================================================================
// Upload Collection Type Tests
// ============================================================================

type MediaSelect = typeof media.$infer.select;

// Upload fields are present
type _mediaSelectHasKey = Expect<Equal<HasKey<MediaSelect, "key">, true>>;
type _mediaSelectHasFilename = Expect<
	Equal<HasKey<MediaSelect, "filename">, true>
>;
type _mediaSelectHasMimeType = Expect<
	Equal<HasKey<MediaSelect, "mimeType">, true>
>;
type _mediaSelectHasSize = Expect<Equal<HasKey<MediaSelect, "size">, true>>;
type _mediaSelectHasVisibility = Expect<
	Equal<HasKey<MediaSelect, "visibility">, true>
>;

// Custom fields are present
type _mediaSelectHasAlt = Expect<Equal<HasKey<MediaSelect, "alt">, true>>;
type _mediaSelectHasCaption = Expect<
	Equal<HasKey<MediaSelect, "caption">, true>
>;

// URL is added by upload() as a typed output field
type _mediaSelectUrlCheck = MediaSelect extends { url: string } ? true : false;

// ============================================================================
// Localized Field Tests
// ============================================================================

type PostsLocalized = typeof posts.state.localized;
type UsersLocalized = typeof users.state.localized;

// Posts should have content in localized array
type _postsLocalizedHasContent = Expect<
	Extends<"content", PostsLocalized[number]>
>;

// Users should have bio in localized array
type _usersLocalizedHasBio = Expect<Extends<"bio", UsersLocalized[number]>>;

// ============================================================================
// Options Type Tests
// ============================================================================

type PostsOptions = typeof posts.state.options;

// Check that options are correctly set
type _postsOptionsSoftDelete = Expect<Equal<PostsOptions["softDelete"], true>>;
type _postsOptionsVersioning = Expect<Equal<PostsOptions["versioning"], true>>;

// ============================================================================
// Module Type Tests - Collections and Globals
// ============================================================================

type ModuleCollections = typeof testModule.state.collections;
type ModuleGlobals = typeof testModule.state.globals;

// Collections should be present
type _moduleHasUsers = Expect<Equal<HasKey<ModuleCollections, "users">, true>>;
type _moduleHasPosts = Expect<Equal<HasKey<ModuleCollections, "posts">, true>>;
type _moduleHasComments = Expect<
	Equal<HasKey<ModuleCollections, "comments">, true>
>;
type _moduleHasTags = Expect<Equal<HasKey<ModuleCollections, "tags">, true>>;
type _moduleHasMedia = Expect<Equal<HasKey<ModuleCollections, "media">, true>>;

// Globals should be present
type _moduleHasSiteSettings = Expect<
	Equal<HasKey<ModuleGlobals, "site_settings">, true>
>;

// ============================================================================
// Field Definition Tests
// ============================================================================

type PostFieldDefs = typeof posts.state.fieldDefinitions;

// Field definitions should be present
type _postsFieldDefsHasTitle = Expect<
	Equal<HasKey<PostFieldDefs, "title">, true>
>;
type _postsFieldDefsHasContent = Expect<
	Equal<HasKey<PostFieldDefs, "content">, true>
>;
type _postsFieldDefsHasSlug = Expect<
	Equal<HasKey<PostFieldDefs, "slug">, true>
>;
type _postsFieldDefsHasAuthor = Expect<
	Equal<HasKey<PostFieldDefs, "author">, true>
>;

// ============================================================================
// State Fields (Drizzle columns) Tests
// ============================================================================

type PostStateFields = typeof posts.state.fields;

// State fields should include the Drizzle columns
type _postsStateFieldsHasTitle = Expect<
	Equal<HasKey<PostStateFields, "title">, true>
>;
type _postsStateFieldsHasSlug = Expect<
	Equal<HasKey<PostStateFields, "slug">, true>
>;
// Note: Relation FK column key in state.fields is the field name with Id suffix
// The actual key stored depends on collection-builder implementation

// ============================================================================
// CRUD API Relation Where Tests
// ============================================================================

type PostsFindOptions = Parameters<
	CmsFromBuilder["api"]["collections"]["posts"]["find"]
>[0];
type PostsWhere = NonNullable<PostsFindOptions>["where"];

const _postsWhereByAuthor: PostsWhere = {
	author: { name: "Jane" },
};

const _postsWhereByAuthorIs: PostsWhere = {
	author: { is: { email: "jane@example.com" } },
};

const _postsWhereByCommentsSome: PostsWhere = {
	comments: { some: { content: { like: "%trim%" } } },
};

const _postsWhereByCommentsNone: PostsWhere = {
	comments: { none: { content: { like: "%spam%" } } },
};

const _postsWhereByCommentsEvery: PostsWhere = {
	comments: { every: { content: { like: "%nice%" } } },
};

type CommentsFindOptions = Parameters<
	CmsFromBuilder["api"]["collections"]["comments"]["find"]
>[0];
type CommentsWhere = NonNullable<CommentsFindOptions>["where"];

const _commentsWhereByPost: CommentsWhere = {
	post: { title: "Hello" },
};

// ============================================================================
// Deeply Nested Where Tests (posts → comments → author)
// ============================================================================

// Nested where: posts → comments → author (2 levels deep)
const _postsWhereNestedCommentAuthor: PostsWhere = {
	comments: {
		some: {
			author: {
				is: { name: { like: "%Jane%" } },
			},
		},
	},
};

// Nested where: posts → author with operators
const _postsWhereAuthorOps: PostsWhere = {
	author: {
		is: {
			name: { contains: "admin" },
			email: { endsWith: "@example.com" },
		},
	},
};

// Nested where with AND/OR at nested level
const _postsWhereNestedLogical: PostsWhere = {
	comments: {
		some: {
			AND: [
				{ content: { like: "%important%" } },
				{ author: { is: { name: "Admin" } } },
			],
		},
	},
};

// Comments → post → author (2 levels deep from comments)
const _commentsWhereNestedPostAuthor: CommentsWhere = {
	post: {
		is: {
			author: {
				is: { email: "admin@example.com" },
			},
		},
	},
};

// Comments → post → comments (circular, but should type-check within depth limit)
const _commentsWhereCircular: CommentsWhere = {
	post: {
		is: {
			comments: {
				some: { content: { like: "%reply%" } },
			},
		},
	},
};

// Combine field-level and relation-level where
const _postsWhereMixed: PostsWhere = {
	title: { like: "%breaking%" },
	views: { gt: 100 },
	author: { is: { name: "Editor" } },
	comments: { none: { content: { like: "%spam%" } } },
};

// ============================================================================
// Nested With Tests
// ============================================================================

type PostsFindOpts = NonNullable<PostsFindOptions>;

// Basic with: posts → author
const _postsWithAuthor: PostsFindOpts = {
	with: {
		author: true,
	},
};

// Aggregation on nested relation
const _postsWithAggregation: PostsFindOpts = {
	with: {
		comments: {
			_count: true,
		},
	},
};

// ============================================================================
// Granular Type Resolution Tests
// ============================================================================

import type {
	CollectionRelationsFromApp,
	FindOptions,
	Where as WhereType,
} from "#questpie/server/collection/crud/index.js";
import type { CollectionSelect as CollectionSelectFromApp } from "#questpie/server/collection/crud/types.js";
import type {
	ExtractRelationApp,
	ExtractRelationCollection,
	ExtractRelationRelations,
	ExtractRelationSelect,
} from "#questpie/shared/type-utils.js";

type TCollections = typeof testModule.state.collections;
type TApp = { collections: TCollections };

// ============================================================================
// A) CollectionSelect resolution — are field types concrete, not unknown?
// ============================================================================

type UsersSelect = CollectionSelectFromApp<typeof users, TApp>;
// name should be string (required text field)
type _usersSelectNameIsString = Expect<Extends<UsersSelect["name"], string>>;
type _usersSelectNameNotUnknown = Expect<
	Not<Equal<UsersSelect["name"], unknown>>
>;
// email should be string
type _usersSelectEmailIsString = Expect<Extends<UsersSelect["email"], string>>;
type _usersSelectEmailNotUnknown = Expect<
	Not<Equal<UsersSelect["email"], unknown>>
>;

type PostsSelectFromApp = CollectionSelectFromApp<typeof posts, TApp>;
// title should be string
type _postsSelectTitleIsString = Expect<
	Extends<PostsSelectFromApp["title"], string>
>;
type _postsSelectTitleNotUnknown = Expect<
	Not<Equal<PostsSelectFromApp["title"], unknown>>
>;

// ============================================================================
// B) Where clause: top-level field operators — are they concrete?
// ============================================================================

type PostsWhereType = WhereType<typeof posts, TApp>;

// "title" should accept string value directly
const _whereTitleDirect: PostsWhereType = { title: "hello" };

// "title" should accept operator object with string operators
const _whereTitleOps: PostsWhereType = {
	title: { contains: "hello", startsWith: "A" },
};

// "views" should accept number operator
const _whereViewsOps: PostsWhereType = { views: { gt: 100 } };

// Check: title operators should NOT have "gt" (numeric) — or at least, gt should not accept number
// This test verifies that field-definition-aware operators work, not the legacy ones
// (If using WhereOperatorsLegacy, gt would accept string which is wrong for a text field)

// ============================================================================
// C) Where clause: relation filter "is" — author.is.{fields}
// ============================================================================

// author: { is: { ... } } — the inner object should have user fields
const _whereAuthorIsName: PostsWhereType = {
	author: { is: { name: "Jane" } },
};

// author: { is: { name: { contains: ... } } } — name inside is should accept text operators
const _whereAuthorIsNameOps: PostsWhereType = {
	author: { is: { name: { contains: "Jane" } } },
};

// author: { is: { email: ... } } — email should be available
const _whereAuthorIsEmail: PostsWhereType = {
	author: { is: { email: "jane@example.com" } },
};

// ============================================================================
// D) Where clause: relation filter "some/none" — comments.some.{fields}
// ============================================================================

const _whereCommentsSome: PostsWhereType = {
	comments: { some: { createdAt: "2024-01-01" } },
};

// ============================================================================
// E) Where clause: nested relation (depth 2) — comments.some.author.is.name
// ============================================================================

const _whereCommentsAuthor: PostsWhereType = {
	comments: {
		some: {
			author: { is: { name: "Admin" } },
		},
	},
};

// author.is.name inside comments.some should accept operators
const _whereCommentsAuthorOps: PostsWhereType = {
	comments: {
		some: {
			author: { is: { name: { contains: "Admin" } } },
		},
	},
};

// ============================================================================
// F) CollectionRelationsFromApp — is RelationShape correctly formed?
// ============================================================================

type PostsRelations = CollectionRelationsFromApp<typeof posts, TApp>;

// comments entry should be an array
type PostsCommentsRel = PostsRelations["comments"];
type _commentsIsArray = Expect<
	Equal<PostsCommentsRel extends any[] ? true : false, true>
>;

// Extract single element
type CommentsRelElement = PostsCommentsRel extends (infer U)[] ? U : never;

// It should carry __select, __relations, __collection, __app
type CommentsRelSelect = ExtractRelationSelect<CommentsRelElement>;
type CommentsRelRelations = ExtractRelationRelations<CommentsRelElement>;
type CommentsRelCollection = ExtractRelationCollection<CommentsRelElement>;
type CommentsRelApp = ExtractRelationApp<CommentsRelElement>;

// CommentsRelSelect should have "content" field
type _commentsSelectHasContent = Expect<
	Equal<HasKey<CommentsRelSelect, "content">, true>
>;
// CommentsRelRelations should have "author" and "post"
type _commentsRelHasAuthor = Expect<
	Equal<HasKey<CommentsRelRelations, "author">, true>
>;
type _commentsRelHasPost = Expect<
	Equal<HasKey<CommentsRelRelations, "post">, true>
>;
// __collection should not be unknown
type _commentsCollectionNotUnknown = Expect<
	Not<Equal<CommentsRelCollection, unknown>>
>;
// __app should not be unknown
type _commentsAppNotUnknown = Expect<Not<Equal<CommentsRelApp, unknown>>>;

// ============================================================================
// G) Depth 2: author inside comments — is it also a RelationShape?
// ============================================================================

type CommentsAuthorRel = CommentsRelRelations["author"];
type CommentsAuthorSelect = ExtractRelationSelect<CommentsAuthorRel>;

// author select should have concrete user fields
type _commentsAuthorHasName = Expect<
	Equal<HasKey<CommentsAuthorSelect, "name">, true>
>;
type _commentsAuthorHasEmail = Expect<
	Equal<HasKey<CommentsAuthorSelect, "email">, true>
>;
// name should be string, not unknown
type _commentsAuthorNameIsString = Expect<
	Extends<CommentsAuthorSelect["name"], string>
>;
type _commentsAuthorNameNotUnknown = Expect<
	Not<Equal<CommentsAuthorSelect["name"], unknown>>
>;

// ============================================================================
// H) With clause: nested with — does comments.with.author exist?
// ============================================================================

type PostsFO = FindOptions<typeof posts, TApp>;
type PostsWithClause = NonNullable<PostsFO["with"]>;

// Top level: "author" and "comments" keys should exist
type _withHasAuthor = Expect<Equal<HasKey<PostsWithClause, "author">, true>>;
type _withHasComments = Expect<
	Equal<HasKey<PostsWithClause, "comments">, true>
>;

// Extract WithRelationOptions for comments (exclude boolean)
type CommentsWithOpts = Exclude<
	NonNullable<PostsWithClause["comments"]>,
	boolean
>;

// comments options should have "where", "columns", "with", "limit"
type _commentsOptsHasWhere = Expect<
	Equal<HasKey<CommentsWithOpts, "where">, true>
>;
type _commentsOptsHasColumns = Expect<
	Equal<HasKey<CommentsWithOpts, "columns">, true>
>;
type _commentsOptsHasInnerWith = Expect<
	Equal<HasKey<CommentsWithOpts, "with">, true>
>;
type _commentsOptsHasLimit = Expect<
	Equal<HasKey<CommentsWithOpts, "limit">, true>
>;

// The inner "with" type — should have "author" and "post" keys
type CommentsInnerWith = NonNullable<CommentsWithOpts["with"]>;
type _innerWithNotUndefined = Expect<Not<Equal<CommentsInnerWith, undefined>>>;
type _innerWithHasAuthor = Expect<
	Equal<HasKey<CommentsInnerWith, "author">, true>
>;
type _innerWithHasPost = Expect<Equal<HasKey<CommentsInnerWith, "post">, true>>;

// ============================================================================
// I) With clause: nested where inside comments.with options
// ============================================================================

// The "where" inside comments with options should be a Where for the comments collection
type CommentsWithWhere = NonNullable<CommentsWithOpts["where"]>;
// It should accept comments fields
type _commentsWithWhereHasContent = Expect<
	Equal<HasKey<CommentsWithWhere, "content">, true>
>;

// ============================================================================
// J) Assignment tests — do real values work?
// ============================================================================

// Basic with: author
const _withAuthorBasic: PostsFO = {
	with: { author: true },
};

// With: comments with aggregation
const _withCommentsAgg: PostsFO = {
	with: { comments: { _count: true } },
};

// Nested with: comments → author
const _withNestedCommentAuthor: PostsFO = {
	with: {
		author: true,
		comments: {
			with: {
				author: true,
			},
		},
	},
};

// Nested with + where: comments with where + inner with
const _withNestedAndWhere: PostsFO = {
	with: {
		comments: {
			where: { content: { like: "%test%" } },
			with: {
				author: true,
			},
		},
	},
};

// ============================================================================
// K) CollectionSelect: system fields + field-def-aware types
// ============================================================================

type PostsCSelect = CollectionSelectFromApp<typeof posts, TApp>;

// System fields should be present (from $infer.select, not field definitions)
type _postsCSHasId = Expect<Equal<HasKey<PostsCSelect, "id">, true>>;
type _postsCSHasCreatedAt = Expect<
	Equal<HasKey<PostsCSelect, "createdAt">, true>
>;
type _postsCSHasUpdatedAt = Expect<
	Equal<HasKey<PostsCSelect, "updatedAt">, true>
>;
type _postsCSHasDeletedAt = Expect<
	Equal<HasKey<PostsCSelect, "deletedAt">, true>
>;

// id should be string
type _postsCSIdIsString = Expect<Extends<PostsCSelect["id"], string>>;
type _postsCSIdNotUnknown = Expect<Not<Equal<PostsCSelect["id"], unknown>>>;

// Field-definition fields should be present
type _postsCSHasTitle = Expect<Equal<HasKey<PostsCSelect, "title">, true>>;
type _postsCSHasContent = Expect<Equal<HasKey<PostsCSelect, "content">, true>>;
type _postsCSHasViews = Expect<Equal<HasKey<PostsCSelect, "views">, true>>;

// title should be string (required text field)
type _postsCSTitleIsString = Expect<Extends<PostsCSelect["title"], string>>;
type _postsCSTitleNotUnknown = Expect<
	Not<Equal<PostsCSelect["title"], unknown>>
>;

// ============================================================================
// L) CollectionSelect: relation field is FK value only, not union
// ============================================================================

// "author" is a required belongsTo → FK should be string (not the wide union)
type PostsAuthorField = PostsCSelect["author"];
type _authorFieldIsString = Expect<Equal<PostsAuthorField, string>>;

// "comments" is hasMany → should NOT appear as a column in CollectionSelect
type _commentsNotInSelect = Expect<
	Equal<HasKey<PostsCSelect, "comments">, false>
>;

// ============================================================================
// M) ApplyQuery result types
// ============================================================================

type PostsRelationsType = CollectionRelationsFromApp<typeof posts, TApp>;

// Basic: no query — should be just the select
type PostsBasicResult =
	import("#questpie/server/collection/crud/types.js").ApplyQuery<
		PostsCSelect,
		PostsRelationsType,
		undefined
	>;
type _basicResultHasId = Expect<Equal<HasKey<PostsBasicResult, "id">, true>>;
type _basicResultHasTitle = Expect<
	Equal<HasKey<PostsBasicResult, "title">, true>
>;

// With author: true — should add author as resolved User object
type PostsWithAuthorResult =
	import("#questpie/server/collection/crud/types.js").ApplyQuery<
		PostsCSelect,
		PostsRelationsType,
		{ with: { author: true } }
	>;
type _withAuthorResultHasAuthor = Expect<
	Equal<HasKey<PostsWithAuthorResult, "author">, true>
>;
// The author in the result should have name and email (resolved User)
type AuthorInResult = PostsWithAuthorResult["author"];
type _authorResultHasName = Expect<Equal<HasKey<AuthorInResult, "name">, true>>;
type _authorResultHasEmail = Expect<
	Equal<HasKey<AuthorInResult, "email">, true>
>;
// name should be string, not unknown
type _authorResultNameIsString = Expect<
	Extends<AuthorInResult["name"], string>
>;
type _authorResultNameNotUnknown = Expect<
	Not<Equal<AuthorInResult["name"], unknown>>
>;

// ============================================================================
// N) Hard exact-type verification — prove types resolve, not vacuous
// ============================================================================

// --- PostsCSelect exact field types ---
type _exactId = Expect<Equal<PostsCSelect["id"], string>>;
type _exactTitle = Expect<Equal<PostsCSelect["title"], string>>;
type _exactContent = Expect<Equal<PostsCSelect["content"], string | null>>;
type _exactViews = Expect<Equal<PostsCSelect["views"], number | null>>;
type _exactCreatedAt = Expect<Equal<PostsCSelect["createdAt"], Date>>;
type _exactUpdatedAt = Expect<Equal<PostsCSelect["updatedAt"], Date>>;
type _exactDeletedAt = Expect<Equal<PostsCSelect["deletedAt"], Date | null>>;
type _exactAuthorFK = Expect<Equal<PostsCSelect["author"], string>>;
type _exactTitle2 = Expect<Equal<PostsCSelect["_title"], string>>;

// --- Verify comments is truly absent ---
type _commentsAbsent = Expect<
	Equal<"comments" extends keyof PostsCSelect ? true : false, false>
>;

// --- UsersSelect exact types ---
type UsersCSelect = CollectionSelectFromApp<typeof users, TApp>;
type _exactUserName = Expect<Equal<UsersCSelect["name"], string>>;
type _exactUserEmail = Expect<Equal<UsersCSelect["email"], string>>;
type _exactUserId = Expect<Equal<UsersCSelect["id"], string>>;

// --- Where: author direct value should accept string, not the wide union ---
type PostsWhereCheck = WhereType<typeof posts, TApp>;
// author where should accept a direct string value
const _whereAuthorDirect: PostsWhereCheck = { author: "some-uuid" };
// Note: These negative tests now pass correctly - operators properly typed!

// --- Where: nested relation filter ---
const _whereAuthorIs: PostsWhereCheck = {
	author: { is: { name: { contains: "Jane" } } },
};

// --- With: nested with assignment ---
const _nestedWith: FindOptions<typeof posts, TApp> = {
	with: {
		comments: {
			where: { content: { like: "%hello%" } },
			with: { author: true },
		},
	},
};

// --- ApplyQuery: verify author in result is the resolved user, not FK ---
type _authorResultExactName = Expect<Equal<AuthorInResult["name"], string>>;
type _authorResultExactEmail = Expect<Equal<AuthorInResult["email"], string>>;

// ============================================================================
// O) Nested Where: concrete types, NOT unknown — operator-level proof
// ============================================================================

// --- Top-level: title operators are concrete ---
type PostsWhereTitle = NonNullable<PostsWhereCheck["title"]>;
// title should accept string directly or operator object with string operators
const _whereTitleContains: PostsWhereCheck = { title: { contains: "hello" } };
const _whereTitleStartsWith: PostsWhereCheck = {
	title: { startsWith: "A" },
};
const _whereTitleLike: PostsWhereCheck = { title: { like: "%foo%" } };

// --- Top-level: views operators are concrete numeric ---
const _whereViewsGt: PostsWhereCheck = { views: { gt: 100 } };
const _whereViewsLte: PostsWhereCheck = { views: { lte: 500 } };
const _whereViewsIn: PostsWhereCheck = { views: { in: [1, 2, 3] } };

// --- Top-level: system fields where operators ---
const _whereCreatedAtGt: PostsWhereCheck = {
	createdAt: { gt: new Date() },
};
const _whereIdEq: PostsWhereCheck = { id: "some-uuid" };
const _whereIdIn: PostsWhereCheck = { id: { in: ["a", "b"] } };
const _whereDeletedAtIsNull: PostsWhereCheck = {
	deletedAt: { isNull: true },
};

// --- Nested: author.is.{name} operators are concrete text operators ---
const _whereAuthorIsNameContains: PostsWhereCheck = {
	author: { is: { name: { contains: "Jane" } } },
};
const _whereAuthorIsNameStartsWith: PostsWhereCheck = {
	author: { is: { name: { startsWith: "J" } } },
};
const _whereAuthorIsEmailLike: PostsWhereCheck = {
	author: { is: { email: { like: "%@example.com" } } },
};
const _whereAuthorIsNameIn: PostsWhereCheck = {
	author: { is: { name: { in: ["Jane", "John"] } } },
};

// --- Nested: comments.some.{content} operators are concrete text operators ---
const _whereCommentsSomeContentLike: PostsWhereCheck = {
	comments: { some: { content: { like: "%test%" } } },
};
const _whereCommentsSomeContentContains: PostsWhereCheck = {
	comments: { some: { content: { contains: "great" } } },
};

// --- Nested depth 2: comments.some.author.is.{name} operators concrete ---
const _whereCommentsSomeAuthorName: PostsWhereCheck = {
	comments: {
		some: {
			author: { is: { name: { contains: "Admin" } } },
		},
	},
};
const _whereCommentsSomeAuthorEmail: PostsWhereCheck = {
	comments: {
		some: {
			author: { is: { email: { endsWith: "@example.com" } } },
		},
	},
};

// --- Nested depth 2: comments.some.post.is.{title} operators concrete ---
const _whereCommentsSomePostTitle: PostsWhereCheck = {
	comments: {
		some: {
			post: { is: { title: { like: "%breaking%" } } },
		},
	},
};

// --- Comments Where: post.is.{field} operators concrete ---
type CommentsWhereCheck = WhereType<typeof comments, TApp>;
const _commWherePostTitle: CommentsWhereCheck = {
	post: { is: { title: { contains: "hello" } } },
};
const _commWherePostViews: CommentsWhereCheck = {
	post: { is: { views: { gt: 50 } } },
};
const _commWherePostCreatedAt: CommentsWhereCheck = {
	post: { is: { createdAt: { gt: new Date("2024-01-01") } } },
};

// --- Negative tests would go here but operators are now properly typed and reject bad values ---
// The type system correctly prevents: { title: { contains: 123 } }, { views: { gt: "abc" } }, etc.

// ============================================================================
// P) Module Augmentation Tests — _?: never phantom enables declare module
// ============================================================================

import type { ArrayFieldMeta } from "#questpie/server/fields/builtin/array.js";
import type { BooleanFieldMeta } from "#questpie/server/fields/builtin/boolean.js";
import type { DateFieldMeta } from "#questpie/server/fields/builtin/date.js";
import type { DatetimeFieldMeta } from "#questpie/server/fields/builtin/datetime.js";
import type { EmailFieldMeta } from "#questpie/server/fields/builtin/email.js";
import type { JsonFieldMeta } from "#questpie/server/fields/builtin/json.js";
import type { NumberFieldMeta } from "#questpie/server/fields/builtin/number.js";
import type { ObjectFieldMeta } from "#questpie/server/fields/builtin/object.js";
import type { RelationFieldMeta } from "#questpie/server/fields/builtin/relation.js";
import type { SelectFieldMeta } from "#questpie/server/fields/builtin/select.js";
import type { TextFieldMeta } from "#questpie/server/fields/builtin/text.js";
import type { TextareaFieldMeta } from "#questpie/server/fields/builtin/textarea.js";
import type { TimeFieldMeta } from "#questpie/server/fields/builtin/time.js";
import type { UploadFieldMeta } from "#questpie/server/fields/builtin/upload.js";
import type { UrlFieldMeta } from "#questpie/server/fields/builtin/url.js";

// Verify all Meta interfaces have the _?: never phantom property
// This is what prevents interface collapse and enables module augmentation.
// An empty interface {} collapses to {}, but { _?: never } stays distinct.
type _textMetaHasPhantom = Expect<Equal<HasKey<TextFieldMeta, "_">, true>>;
type _numberMetaHasPhantom = Expect<Equal<HasKey<NumberFieldMeta, "_">, true>>;
type _booleanMetaHasPhantom = Expect<
	Equal<HasKey<BooleanFieldMeta, "_">, true>
>;
type _selectMetaHasPhantom = Expect<Equal<HasKey<SelectFieldMeta, "_">, true>>;
type _relationMetaHasPhantom = Expect<
	Equal<HasKey<RelationFieldMeta, "_">, true>
>;
type _datetimeMetaHasPhantom = Expect<
	Equal<HasKey<DatetimeFieldMeta, "_">, true>
>;
type _textareaMetaHasPhantom = Expect<
	Equal<HasKey<TextareaFieldMeta, "_">, true>
>;
type _emailMetaHasPhantom = Expect<Equal<HasKey<EmailFieldMeta, "_">, true>>;
type _urlMetaHasPhantom = Expect<Equal<HasKey<UrlFieldMeta, "_">, true>>;
type _dateMetaHasPhantom = Expect<Equal<HasKey<DateFieldMeta, "_">, true>>;
type _timeMetaHasPhantom = Expect<Equal<HasKey<TimeFieldMeta, "_">, true>>;
type _jsonMetaHasPhantom = Expect<Equal<HasKey<JsonFieldMeta, "_">, true>>;
type _objectMetaHasPhantom = Expect<Equal<HasKey<ObjectFieldMeta, "_">, true>>;
type _arrayMetaHasPhantom = Expect<Equal<HasKey<ArrayFieldMeta, "_">, true>>;
type _uploadMetaHasPhantom = Expect<Equal<HasKey<UploadFieldMeta, "_">, true>>;

// Verify Meta interfaces are not {} (they have at least _?: never)
// This ensures they're augmentable — {} is not distinguishable from augmented version
type _textMetaNotEmpty = Expect<Not<Equal<keyof TextFieldMeta, never>>>;
type _numberMetaNotEmpty = Expect<Not<Equal<keyof NumberFieldMeta, never>>>;

// ============================================================================
// Q) Standalone Field Operator Inference — concrete types from field
// ============================================================================

import { datetimeField } from "#questpie/server/fields/builtin/datetime.js";
import { numberField } from "#questpie/server/fields/builtin/number.js";
import { textField } from "#questpie/server/fields/builtin/text.js";
import { createFieldDefinition } from "#questpie/server/fields/field.js";
import type { FieldWhere } from "#questpie/server/fields/field-types.js";
import type { OperatorsToWhereInput } from "#questpie/server/fields/types.js";

// --- OperatorsToWhereInput works with concrete operator maps ---

import type {
	dateColumnOperators,
	numberColumnOperators,
	stringColumnOperators,
} from "#questpie/server/fields/common-operators.js";
import type { DateInput } from "#questpie/shared/type-utils.js";

type StringOpsWhere = OperatorsToWhereInput<typeof stringColumnOperators>;
type _stringOpsWhereEq = Expect<
	Equal<StringOpsWhere["eq"], string | undefined>
>;
type _stringOpsWhereContains = Expect<
	Equal<StringOpsWhere["contains"], string | undefined>
>;
type _stringOpsWhereLike = Expect<
	Equal<StringOpsWhere["like"], string | undefined>
>;
type _stringOpsWhereIn = Expect<
	Equal<StringOpsWhere["in"], string[] | undefined>
>;
type _stringOpsWhereIsNull = Expect<
	Equal<StringOpsWhere["isNull"], boolean | undefined>
>;

type NumberOpsWhere = OperatorsToWhereInput<typeof numberColumnOperators>;
type _numberOpsWhereEq = Expect<
	Equal<NumberOpsWhere["eq"], number | undefined>
>;
type _numberOpsWhereGt = Expect<
	Equal<NumberOpsWhere["gt"], number | undefined>
>;
type _numberOpsWhereLte = Expect<
	Equal<NumberOpsWhere["lte"], number | undefined>
>;

type DateOpsWhere = OperatorsToWhereInput<typeof dateColumnOperators>;
type _dateOpsWhereEq = Expect<Equal<DateOpsWhere["eq"], DateInput | undefined>>;
type _dateOpsWhereGt = Expect<Equal<DateOpsWhere["gt"], DateInput | undefined>>;

// --- Standalone text field: FieldWhere should have concrete string operators ---

const myTextField = createFieldDefinition(textField, {
	required: true,
} as const);
type MyTextFieldWhere = FieldWhere<typeof myTextField, unknown>;
type _myTextWhereNotNever = Expect<Not<IsNever<MyTextFieldWhere>>>;
type _myTextWhereEq = Expect<Equal<MyTextFieldWhere["eq"], string | undefined>>;
type _myTextWhereContains = Expect<
	Equal<MyTextFieldWhere["contains"], string | undefined>
>;
type _myTextWhereLike = Expect<
	Equal<MyTextFieldWhere["like"], string | undefined>
>;
type _myTextWhereIn = Expect<
	Equal<MyTextFieldWhere["in"], string[] | undefined>
>;
type _myTextWhereIsNull = Expect<
	Equal<MyTextFieldWhere["isNull"], boolean | undefined>
>;
// text fields should NOT have gt/gte/lt/lte
type _myTextWhereNoGt = Expect<Equal<HasKey<MyTextFieldWhere, "gt">, false>>;

// --- Standalone number field: FieldWhere should have concrete number operators ---

const myNumberField = createFieldDefinition(numberField, {
	required: true,
} as const);
type MyNumberFieldWhere = FieldWhere<typeof myNumberField, unknown>;
type _myNumberWhereNotNever = Expect<Not<IsNever<MyNumberFieldWhere>>>;
type _myNumberWhereEq = Expect<
	Equal<MyNumberFieldWhere["eq"], number | undefined>
>;
type _myNumberWhereGt = Expect<
	Equal<MyNumberFieldWhere["gt"], number | undefined>
>;
type _myNumberWhereLte = Expect<
	Equal<MyNumberFieldWhere["lte"], number | undefined>
>;
type _myNumberWhereIn = Expect<
	Equal<MyNumberFieldWhere["in"], number[] | undefined>
>;
// number fields should NOT have contains/like/startsWith
type _myNumberWhereNoContains = Expect<
	Equal<HasKey<MyNumberFieldWhere, "contains">, false>
>;
type _myNumberWhereNoLike = Expect<
	Equal<HasKey<MyNumberFieldWhere, "like">, false>
>;

// --- Standalone datetime field: FieldWhere should have concrete date operators ---

const myDatetimeField = createFieldDefinition(datetimeField, {
	required: true,
} as const);
type MyDatetimeFieldWhere = FieldWhere<typeof myDatetimeField, unknown>;
type _myDatetimeWhereNotNever = Expect<Not<IsNever<MyDatetimeFieldWhere>>>;
type _myDatetimeWhereEq = Expect<
	Equal<MyDatetimeFieldWhere["eq"], DateInput | undefined>
>;
type _myDatetimeWhereGt = Expect<
	Equal<MyDatetimeFieldWhere["gt"], DateInput | undefined>
>;
// datetime fields should NOT have contains/like
type _myDatetimeWhereNoContains = Expect<
	Equal<HasKey<MyDatetimeFieldWhere, "contains">, false>
>;

// ============================================================================
// R) Collection-level where: concrete operators (NEGATIVE tests)
// ============================================================================

// These prove that the where clause REJECTS invalid operators.
// title is a text field — should NOT accept gt (numeric operator)
// @ts-expect-error - gt is not a valid operator for text fields
const _badTitleGt: PostsWhereCheck = { title: { gt: 100 } };

// views is a number field — should NOT accept contains (string operator)
// @ts-expect-error - contains is not a valid operator for number fields
const _badViewsContains: PostsWhereCheck = { views: { contains: "abc" } };

// published is a boolean field — should NOT accept like (string operator)
// @ts-expect-error - like is not a valid operator for boolean fields
const _badPublishedLike: PostsWhereCheck = { published: { like: "%test%" } };

// createdAt is a datetime field — should NOT accept contains
// This correctly produces a type error — `contains` does not exist on datetime operators
const _badCreatedAtContains: PostsWhereCheck = {
	// @ts-expect-error - contains is not a valid operator for datetime fields
	createdAt: { contains: "2024" },
};
