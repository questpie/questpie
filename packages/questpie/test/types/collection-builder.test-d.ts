/**
 * Collection Builder Type Tests
 *
 * Compile-time only - run with: tsc --noEmit
 * If any Expect<> fails, TypeScript compilation fails.
 *
 * Note: Some tests are disabled pending field builder implementation for:
 * - .localized() via f.text({ localized: true })
 * - .virtuals() via f.text({ virtual: true })
 */

import type { CollectionBuilder } from "#questpie/server/collection/builder/collection-builder.js";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import type { With } from "#questpie/server/collection/crud/types.js";
import { questpie } from "#questpie/server/config/builder.js";
import { builtinFields } from "#questpie/server/fields/builtin/defaults.js";
import type {
	CollectionRelations,
	ResolveRelationsDeep,
} from "#questpie/shared/type-utils.js";
import type {
	Equal,
	Expect,
	Extends,
	HasKey,
	IsLiteral,
	IsNullable,
	OptionalKeys,
} from "./type-test-utils.js";

// ============================================================================
// Test fixtures — use q.collection() for proper field type inference
// ============================================================================

const q = questpie({ name: "test" }).fields(builtinFields);

const postsCollection = q.collection("posts").fields((f) => ({
	title: f.text({ required: true, maxLength: 255 }),
	content: f.textarea(),
	views: f.number({ default: 0 }),
	published: f.boolean({ default: false }),
	authorId: f.textarea(),
}));

// ============================================================================
// collection() factory - name inference
// ============================================================================

type PostsBuilder = typeof postsCollection;
type PostsState = PostsBuilder extends CollectionBuilder<infer S> ? S : never;
type PostsName = PostsState["name"];

type _nameIsLiteral = Expect<IsLiteral<PostsName>>;
type _nameIsPosts = Expect<Equal<PostsName, "posts">>;

// ============================================================================
// .fields() - select type inference
// ============================================================================

type PostSelect = typeof postsCollection.$infer.select;

// Field types
type _titleIsString = Expect<Equal<PostSelect["title"], string>>;
type _contentIsNullable = Expect<IsNullable<PostSelect["content"]>>;
type _viewsIsNumberOrNull = Expect<Extends<PostSelect["views"], number | null>>;

// System fields present
type _hasId = Expect<Equal<HasKey<PostSelect, "id">, true>>;
type _hasCreatedAt = Expect<Equal<HasKey<PostSelect, "createdAt">, true>>;
type _hasUpdatedAt = Expect<Equal<HasKey<PostSelect, "updatedAt">, true>>;
type _has_title = Expect<Equal<HasKey<PostSelect, "_title">, true>>;

// ============================================================================
// .fields() - insert type inference
// ============================================================================

type PostInsert = typeof postsCollection.$infer.insert;
type InsertOptional = OptionalKeys<PostInsert>;

// Fields with defaults are optional
type _viewsOptional = Expect<Extends<"views", InsertOptional>>;
type _idOptional = Expect<Extends<"id", InsertOptional>>;

// ============================================================================
// .fields() - update type inference
// ============================================================================

type PostUpdate = typeof postsCollection.$infer.update;
type UpdateOptional = OptionalKeys<PostUpdate>;

// All fields optional in update
type _updateTitleOptional = Expect<Extends<"title", UpdateOptional>>;
type _updateContentOptional = Expect<Extends<"content", UpdateOptional>>;
type _updateViewsOptional = Expect<Extends<"views", UpdateOptional>>;

// ============================================================================
// .options() - conditional fields
// ============================================================================

const withSoftDelete = q
	.collection("posts")
	.fields((f) => ({ title: f.textarea() }))
	.options({ softDelete: true });

type SoftDeleteSelect = typeof withSoftDelete.$infer.select;
type _hasDeletedAt = Expect<Equal<HasKey<SoftDeleteSelect, "deletedAt">, true>>;

const withoutTimestamps = q
	.collection("posts")
	.fields((f) => ({ title: f.textarea() }))
	.options({ timestamps: false });

type NoTimestampsSelect = typeof withoutTimestamps.$infer.select;
type _noCreatedAt = Expect<
	Equal<HasKey<NoTimestampsSelect, "createdAt">, false>
>;

// ============================================================================
// f.relation() - relation config inference
// ============================================================================

const withRelations = q.collection("posts").fields((f) => ({
	title: f.textarea(),
	author: f.relation({
		to: "users",
		required: true,
		relationName: "author",
	}),
	comments: f.relation({
		to: "comments",
		hasMany: true,
		foreignKey: "postId",
		relationName: "post",
	}),
}));

type RelationsState =
	typeof withRelations extends CollectionBuilder<infer S> ? S : never;
type Relations = RelationsState["relations"];

type _hasAuthor = Expect<Equal<HasKey<Relations, "author">, true>>;
type _hasComments = Expect<Equal<HasKey<Relations, "comments">, true>>;
type _authorIsRelationConfig = Expect<
	Extends<Relations["author"], RelationConfig>
>;

// ============================================================================
// .title() - literal type inference
// ============================================================================

const withTitle = q
	.collection("posts")
	.fields((f) => ({ name: f.textarea(), slug: f.textarea() }))
	.title(({ f }) => f.name);

type TitleState =
	typeof withTitle extends CollectionBuilder<infer S> ? S : never;
type TitleField = TitleState["title"];

type _titleIsName = Expect<Equal<TitleField, "name">>;
type _titleIsLiteral = Expect<IsLiteral<TitleField>>;

// ============================================================================
// .upload() - upload fields
// ============================================================================

const withUpload = q
	.collection("media")
	.fields((f) => ({ alt: f.textarea() }))
	.upload({ visibility: "public" });

type UploadSelect = typeof withUpload.$infer.select;

type _hasKey = Expect<Equal<HasKey<UploadSelect, "key">, true>>;
type _hasFilename = Expect<Equal<HasKey<UploadSelect, "filename">, true>>;
type _hasMimeType = Expect<Equal<HasKey<UploadSelect, "mimeType">, true>>;
type _hasSize = Expect<Equal<HasKey<UploadSelect, "size">, true>>;
type _hasUploadUrl = Expect<Equal<HasKey<UploadSelect, "url">, true>>;

// ============================================================================
// .upload() - output extension
// ============================================================================
type _uploadUrlIsString = Expect<Equal<UploadSelect["url"], string>>;

// ============================================================================
// .merge() - type combination
// ============================================================================

const base = q.collection("posts").fields((f) => ({ title: f.textarea() }));
const extended = base.merge(
	q.collection("posts").fields((f) => ({
		featured: f.boolean(),
	})),
);

type MergedState =
	typeof extended extends CollectionBuilder<infer S> ? S : never;
type MergedFields = MergedState["fields"];

type _mergedHasTitle = Expect<Equal<HasKey<MergedFields, "title">, true>>;
type _mergedHasFeatured = Expect<Equal<HasKey<MergedFields, "featured">, true>>;

// ============================================================================
// $infer helper
// ============================================================================

type Infer = typeof postsCollection.$infer;

type _inferHasSelect = Expect<Equal<HasKey<Infer, "select">, true>>;
type _inferHasInsert = Expect<Equal<HasKey<Infer, "insert">, true>>;
type _inferHasUpdate = Expect<Equal<HasKey<Infer, "update">, true>>;

// ============================================================================
// Complex chain
// ============================================================================

const fullCollection = q
	.collection("articles")
	.fields((f) => ({
		title: f.text({ required: true, maxLength: 255 }),
		content: f.textarea(),
		views: f.number({ default: 0 }),
		author: f.relation({
			to: "users",
			required: true,
			relationName: "author",
		}),
		comments: f.relation({
			to: "comments",
			hasMany: true,
			foreignKey: "articleId",
			relationName: "article",
		}),
		metadata: f.json(),
	}))
	.options({ timestamps: true, softDelete: true, versioning: true })
	.title(({ f }) => f.title);

type FullSelect = typeof fullCollection.$infer.select;

type _fullHasTitle = Expect<Equal<HasKey<FullSelect, "title">, true>>;
type _fullHasMetadata = Expect<Equal<HasKey<FullSelect, "metadata">, true>>;
type _fullHasDeletedAt = Expect<Equal<HasKey<FullSelect, "deletedAt">, true>>;

// ============================================================================
// Object field — nested type inference
// ============================================================================

const withObjectField = q.collection("barbers").fields((f) => ({
	workingHours: f.object({
		fields: () => ({
			monday: f.object({
				fields: () => ({
					isOpen: f.boolean({ required: true }),
					start: f.time(),
					end: f.time(),
				}),
			}),
		}),
	}),
}));

type ObjectSelect = typeof withObjectField.$infer.select;
type WorkingHours = ObjectSelect["workingHours"];

// workingHours should be nullable (not required)
type _workingHoursIsNullable = Expect<IsNullable<WorkingHours>>;
// workingHours should have a "monday" key
type _workingHoursHasMonday = Expect<
	Equal<HasKey<NonNullable<WorkingHours>, "monday">, true>
>;
// monday.isOpen should be boolean (required, so not nullable)
type _mondayIsOpenIsBoolean = Expect<
	Equal<NonNullable<NonNullable<WorkingHours>["monday"]>["isOpen"], boolean>
>;
// monday.start should be string | null (not required)
type _mondayStartIsNullable = Expect<
	IsNullable<NonNullable<NonNullable<WorkingHours>["monday"]>["start"]>
>;

// ============================================================================
// Array field — typed element inference
// ============================================================================

const withArrayField = q.collection("posts2").fields((f) => ({
	tags: f.array({ of: f.text({ required: true }), required: true }),
	links: f.array({
		of: f.object({
			fields: () => ({
				platform: f.text({ required: true }),
				url: f.url({ required: true }),
			}),
		}),
	}),
}));

type ArraySelect = typeof withArrayField.$infer.select;

// tags should be string[] (required, not nullable)
type _tagsIsStringArray = Expect<Extends<ArraySelect["tags"], string[]>>;
type _tagsNotNullable = Expect<Equal<IsNullable<ArraySelect["tags"]>, false>>;

// links should be nullable (not required)
type _linksIsNullable = Expect<IsNullable<ArraySelect["links"]>>;
// links element is nullable (inner object has no required: true), unwrap both array and element nullability
type LinksElement = NonNullable<NonNullable<ArraySelect["links"]>[number]>;
// links elements should have "platform" key
type _linksHasPlatform = Expect<Equal<HasKey<LinksElement, "platform">, true>>;
// links elements should have "url" key
type _linksHasUrl = Expect<Equal<HasKey<LinksElement, "url">, true>>;

// ============================================================================
// CollectionRelations — extracts relation keys from field definitions
// ============================================================================

// Build a multi-collection scenario with f.relation()
const usersCollection = q.collection("users").fields((f) => ({
	name: f.text({ required: true }),
	email: f.text({ required: true }),
}));

const commentsCollection = q.collection("comments").fields((f) => ({
	body: f.textarea({ required: true }),
	postId: f.relation({
		to: "posts",
		required: true,
		relationName: "post",
	}),
}));

const postsWithRelations = q.collection("posts").fields((f) => ({
	title: f.text({ required: true }),
	author: f.relation({
		to: "users",
		required: true,
		relationName: "author",
	}),
	comments: f.relation({
		to: "comments",
		hasMany: true,
		foreignKey: "postId",
		relationName: "post",
	}),
}));

// CollectionRelations should have specific relation keys (not generic)
type PostRelations = CollectionRelations<typeof postsWithRelations>;
type _postRelHasAuthor = Expect<Equal<HasKey<PostRelations, "author">, true>>;
type _postRelHasComments = Expect<
	Equal<HasKey<PostRelations, "comments">, true>
>;

// ============================================================================
// ResolveRelationsDeep — resolved relation types have specific keys
// ============================================================================

type TestCollections = {
	posts: typeof postsWithRelations;
	users: typeof usersCollection;
	comments: typeof commentsCollection;
};

type ResolvedPostRelations = ResolveRelationsDeep<
	PostRelations,
	TestCollections
>;

// Resolved relations should have "author" and "comments" as keys
type _resolvedHasAuthor = Expect<
	Equal<HasKey<ResolvedPostRelations, "author">, true>
>;
type _resolvedHasComments = Expect<
	Equal<HasKey<ResolvedPostRelations, "comments">, true>
>;

// ============================================================================
// With clause — relation keys are visible for autocomplete
// ============================================================================

type PostWith = With<ResolvedPostRelations>;

// With should have "author" and "comments" as keys (for autocomplete)
type _withHasAuthor = Expect<Equal<HasKey<PostWith, "author">, true>>;
type _withHasComments = Expect<Equal<HasKey<PostWith, "comments">, true>>;
// With should NOT have random keys
type _withNoRandom = Expect<Equal<HasKey<PostWith, "random">, false>>;
