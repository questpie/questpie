/**
 * Collection Builder Type Tests
 *
 * Compile-time only - run with: tsc --noEmit
 * If any Expect<> fails, TypeScript compilation fails.
 *
 * Note: Some tests are disabled pending field builder implementation for:
 * - .localized() via f.text({ localized: true })
 * - .virtuals() via f.text({ virtual: true })
 * - $outputType type inference fixes
 */

import type { CollectionBuilder } from "#questpie/server/collection/builder/collection-builder.js";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import { questpie } from "#questpie/server/config/builder.js";
import { builtinFields } from "#questpie/server/fields/builtin/defaults.js";
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

// ============================================================================
// .$outputType() - output extension
// ============================================================================

const withOutput = q
	.collection("assets")
	.fields((f) => ({ key: f.text({ required: true }) }))
	.$outputType<{ url: string; thumbnailUrl?: string }>();

type OutputSelect = typeof withOutput.$infer.select;

// Basic type check - withOutput exists and has $infer
type _outputSelectExists = Expect<
	Equal<OutputSelect extends object ? true : false, true>
>;

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
