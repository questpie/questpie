/**
 * Shared Type Utils Type Tests
 *
 * Tests for type utilities in shared/type-utils.ts
 * These are compile-time only tests - run with: tsc --noEmit
 */

import { questpie } from "#questpie/server/config/builder.js";
import { builtinFields } from "#questpie/server/fields/builtin/defaults.js";
import type {
  CollectionFunctions,
  CollectionInsert,
  CollectionRelations,
  CollectionSelect,
  CollectionUpdate,
  ExtractRelationInsert,
  ExtractRelationRelations,
  ExtractRelationSelect,
  GetCollection,
  GetGlobal,
  GlobalFunctions,
  GlobalInsert,
  GlobalSelect,
  GlobalUpdate,
  Prettify,
  RelationShape,
  ResolveRelations,
} from "#questpie/shared/type-utils.js";
import type {
  Equal,
  Expect,
  Extends,
  HasKey,
  IsNever,
} from "./type-test-utils.js";

// ============================================================================
// Test fixtures
// ============================================================================

const q = questpie({ name: "test" }).fields(builtinFields);

const usersCollection = q.collection("users").fields((f) => ({
  name: f.textarea({ required: true }),
  email: f.email({ required: true, maxLength: 255 }),
}));

const postsCollection = q.collection("posts").fields((f) => ({
  title: f.text({ required: true, maxLength: 255 }),
  content: f.textarea(),
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

const commentsCollection = q.collection("comments").fields((f) => ({
  text: f.textarea({ required: true }),
  post: f.relation({
    to: "posts",
    required: true,
    relationName: "post",
  }),
}));

const settingsGlobal = q.global("settings").fields((f) => ({
  siteName: f.text({ required: true, maxLength: 255 }),
  maintenanceMode: f.textarea(),
}));

type Collections = {
  users: typeof usersCollection;
  posts: typeof postsCollection;
  comments: typeof commentsCollection;
};

type Globals = {
  settings: typeof settingsGlobal;
};

// ============================================================================
// CollectionSelect tests
// ============================================================================

// CollectionSelect should extract select type
type PostSelect = CollectionSelect<typeof postsCollection>;
type _postSelectHasId = Expect<Equal<HasKey<PostSelect, "id">, true>>;
type _postSelectHasTitle = Expect<Equal<HasKey<PostSelect, "title">, true>>;
type _postSelectHasContent = Expect<Equal<HasKey<PostSelect, "content">, true>>;
type _postSelectTitleIsString = Expect<Equal<PostSelect["title"], string>>;

// ============================================================================
// CollectionInsert tests
// ============================================================================

// CollectionInsert should extract insert type
type PostInsert = CollectionInsert<typeof postsCollection>;
type _postInsertHasTitle = Expect<Equal<HasKey<PostInsert, "title">, true>>;
// NOTE: For f.relation() belongsTo, the FK column (authorId) is created at runtime
// but the type system currently doesn't infer it (relation fields have location: "relation").
// Runtime insertion works correctly with authorId.

// ============================================================================
// CollectionUpdate tests
// ============================================================================

// CollectionUpdate should extract update type (all fields optional)
type PostUpdate = CollectionUpdate<typeof postsCollection>;
type _postUpdateHasTitle = Expect<Equal<HasKey<PostUpdate, "title">, true>>;
// All fields should be optional in update
type _postUpdateTitleOptional = Expect<Extends<undefined, PostUpdate["title"]>>;

// ============================================================================
// CollectionRelations tests
// ============================================================================

// CollectionRelations should extract relation configs
type PostRelations = CollectionRelations<typeof postsCollection>;
type _postRelationsHasAuthor = Expect<
  Equal<HasKey<PostRelations, "author">, true>
>;
type _postRelationsHasComments = Expect<
  Equal<HasKey<PostRelations, "comments">, true>
>;

// Relation should have type property
type _authorHasType = Expect<
  Equal<HasKey<PostRelations["author"], "type">, true>
>;
type _commentsHasType = Expect<
  Equal<HasKey<PostRelations["comments"], "type">, true>
>;

// ============================================================================
// GlobalSelect tests
// ============================================================================

// GlobalSelect should extract select type
type SettingsSelect = GlobalSelect<typeof settingsGlobal>;
type _settingsHasId = Expect<Equal<HasKey<SettingsSelect, "id">, true>>;
type _settingsHasSiteName = Expect<
  Equal<HasKey<SettingsSelect, "siteName">, true>
>;

// ============================================================================
// GlobalInsert tests
// ============================================================================

// GlobalInsert should extract insert type
type SettingsInsert = GlobalInsert<typeof settingsGlobal>;
type _settingsInsertHasSiteName = Expect<
  Equal<HasKey<SettingsInsert, "siteName">, true>
>;

// ============================================================================
// GlobalUpdate tests
// ============================================================================

// GlobalUpdate should extract update type
type SettingsUpdate = GlobalUpdate<typeof settingsGlobal>;
type _settingsUpdateHasSiteName = Expect<
  Equal<HasKey<SettingsUpdate, "siteName">, true>
>;

// ============================================================================
// GetCollection tests
// ============================================================================

// GetCollection should resolve collection by name
type ResolvedPosts = GetCollection<Collections, "posts">;
// The result should be a Collection type
type _resolvedPostsIsCollection = Expect<
  Extends<ResolvedPosts, { name: string }>
>;

// ============================================================================
// GetGlobal tests
// ============================================================================

// GetGlobal should resolve global by name
type ResolvedSettings = GetGlobal<Globals, "settings">;
// The result should be a Global type
type _resolvedSettingsIsGlobal = Expect<
  Extends<ResolvedSettings, { name: string }>
>;

// ============================================================================
// RelationShape tests
// ============================================================================

// RelationShape should wrap select and relations
type TestRelationShape = RelationShape<
  { id: string; name: string },
  { posts: any[] },
  { name: string }
>;

type _shapeHasSelect = Expect<
  Equal<TestRelationShape["__select"], { id: string; name: string }>
>;
type _shapeHasRelations = Expect<
  Equal<TestRelationShape["__relations"], { posts: any[] }>
>;
type _shapeHasInsert = Expect<
  Equal<TestRelationShape["__insert"], { name: string }>
>;

// ============================================================================
// ExtractRelationSelect tests
// ============================================================================

// ExtractRelationSelect should unwrap RelationShape
type WrappedShape = RelationShape<
  { id: string; title: string },
  { author: any },
  { title: string }
>;
type ExtractedSelect = ExtractRelationSelect<WrappedShape>;
type _extractedSelectCorrect = Expect<
  Equal<ExtractedSelect, { id: string; title: string }>
>;

// Should return T if not a RelationShape
type PlainType = ExtractRelationSelect<{ name: string }>;
type _plainTypePassthrough = Expect<Equal<PlainType, { name: string }>>;

// ============================================================================
// ExtractRelationRelations tests
// ============================================================================

// ExtractRelationRelations should unwrap RelationShape
type ExtractedRelations = ExtractRelationRelations<WrappedShape>;
type _extractedRelationsCorrect = Expect<
  Equal<ExtractedRelations, { author: any }>
>;

// Should return never if not a RelationShape
type PlainRelations = ExtractRelationRelations<{ name: string }>;
type _plainRelationsNever = Expect<IsNever<PlainRelations>>;

// ============================================================================
// ExtractRelationInsert tests
// ============================================================================

// ExtractRelationInsert should unwrap RelationShape
type ExtractedInsert = ExtractRelationInsert<WrappedShape>;
type _extractedInsertCorrect = Expect<
  Equal<ExtractedInsert, { title: string }>
>;

// Should return T if not a RelationShape
type PlainInsert = ExtractRelationInsert<{ name: string }>;
type _plainInsertPassthrough = Expect<Equal<PlainInsert, { name: string }>>;

// ============================================================================
// Prettify tests
// ============================================================================

// Prettify should expand intersection types
type Intersection = { a: string } & { b: number };
type Prettified = Prettify<Intersection>;
type _prettifiedHasA = Expect<Equal<HasKey<Prettified, "a">, true>>;
type _prettifiedHasB = Expect<Equal<HasKey<Prettified, "b">, true>>;
