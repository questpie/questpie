/**
 * CRUD Types Tests
 *
 * These tests verify that TypeScript correctly infers types for CRUD operations
 * including Where clauses, query options, and mutation inputs.
 *
 * Run with: tsc --noEmit
 */

import type {
  Columns,
  FindManyOptions,
  FindOneOptions,
  NestedRelationMutation,
  OrderBy,
  Where,
  WhereOperators,
} from "#questpie/server/collection/crud/types.js";
import { questpie } from "#questpie/server/config/builder.js";
import { builtinFields } from "#questpie/server/fields/builtin/defaults.js";
import type { Equal, Expect, Extends, HasKey } from "./type-test-utils.js";

// ============================================================================
// Test fixtures
// ============================================================================

const q = questpie({ name: "test" }).fields(builtinFields);

// Simple collection for basic tests
const postsCollection = q.collection("posts").fields((f) => ({
  title: f.text({ required: true, maxLength: 255 }),
  content: f.textarea(),
  views: f.number({ default: 0 }),
  author: f.relation({
    to: "users",
    required: true,
    relationName: "author",
  }),
  publishedAt: f.datetime(),
  comments: f.relation({
    to: "comments",
    hasMany: true,
    foreignKey: "postId",
    relationName: "post",
  }),
}));

type PostSelect = typeof postsCollection.$infer.select;
type PostInsert = typeof postsCollection.$infer.insert;

// ============================================================================
// WhereOperators tests
// ============================================================================

// All types support eq/ne
type StringOps = WhereOperators<string>;
type NumberOps = WhereOperators<number>;
type DateOps = WhereOperators<Date>;

type _stringEq = Expect<Equal<HasKey<StringOps, "eq">, true>>;
type _stringNe = Expect<Equal<HasKey<StringOps, "ne">, true>>;
type _numberEq = Expect<Equal<HasKey<NumberOps, "eq">, true>>;
type _dateEq = Expect<Equal<HasKey<DateOps, "eq">, true>>;

// Numbers support gt, gte, lt, lte
type _numberGt = Expect<Extends<NumberOps["gt"], number | undefined>>;
type _numberGte = Expect<Extends<NumberOps["gte"], number | undefined>>;
type _numberLt = Expect<Extends<NumberOps["lt"], number | undefined>>;
type _numberLte = Expect<Extends<NumberOps["lte"], number | undefined>>;

// Dates support gt, gte, lt, lte (with Date or string)
type _dateGt = Expect<Extends<DateOps["gt"], Date | string | undefined>>;

// String operators
type _like = Expect<Equal<StringOps["like"], string | undefined>>;
type _ilike = Expect<Equal<StringOps["ilike"], string | undefined>>;
type _contains = Expect<Equal<StringOps["contains"], string | undefined>>;
type _startsWith = Expect<Equal<StringOps["startsWith"], string | undefined>>;
type _endsWith = Expect<Equal<StringOps["endsWith"], string | undefined>>;

// Number should not have string operators (returns never or undefined)
type _numberLike = Expect<Equal<NumberOps["like"], never | undefined>>;

// In/notIn support arrays
type _stringIn = Expect<Equal<StringOps["in"], string[] | undefined>>;
type _stringNotIn = Expect<Equal<StringOps["notIn"], string[] | undefined>>;
type _numberIn = Expect<Equal<NumberOps["in"], number[] | undefined>>;

// Null checks
type _isNull = Expect<Equal<StringOps["isNull"], boolean | undefined>>;
type _isNotNull = Expect<Equal<StringOps["isNotNull"], boolean | undefined>>;

// ============================================================================
// Where clause tests
// ============================================================================

type PostWhere = Where<PostSelect, {}>;

// Can use direct values
const _where1: PostWhere = { title: "Hello" };
const _where2: PostWhere = { views: 100 };

// Can use operators
const _where3: PostWhere = { title: { like: "%hello%" } };
const _where4: PostWhere = { views: { gt: 100 } };
const _where5: PostWhere = { publishedAt: { gte: new Date() } };

// Logical operators
const _whereAnd: PostWhere = {
  AND: [{ title: "Hello" }, { views: { gt: 10 } }],
};

const _whereOr: PostWhere = {
  OR: [{ title: "Hello" }, { title: "World" }],
};

const _whereNot: PostWhere = {
  NOT: { title: "Excluded" },
};

// Combined conditions
const _whereCombined: PostWhere = {
  title: { like: "%hello%" },
  views: { gt: 100, lt: 1000 },
  AND: [{ author: { eq: "user-1" } }],
};

// ============================================================================
// Columns selection tests
// ============================================================================

type PostColumns = Columns<PostSelect>;

// Selecting specific columns
const _columns: PostColumns = {
  title: true,
  content: true,
};

// Excluding columns
const _columnsExclude: PostColumns = {
  content: false, // Exclude content
};

// Valid keys
type _hasTitle = Expect<Equal<HasKey<PostColumns, "title">, true>>;
type _hasContent = Expect<Equal<HasKey<PostColumns, "content">, true>>;
type _hasViews = Expect<Equal<HasKey<PostColumns, "views">, true>>;

// All values are optional booleans
type _titleType = Expect<Extends<PostColumns["title"], boolean | undefined>>;

// ============================================================================
// OrderBy tests
// ============================================================================

type PostOrderBy = OrderBy<PostSelect>;

// Object syntax for ordering
const _orderBy: PostOrderBy = {
  createdAt: "desc",
  title: "asc",
};

// Type check: only 'asc' | 'desc' allowed
type Direction = NonNullable<
  PostOrderBy extends Record<string, infer D> ? D : never
>;
type _validDirection = Expect<Extends<Direction, "asc" | "desc">>;

// ============================================================================
// FindManyOptions tests
// ============================================================================

type PostFindOptions = FindManyOptions<PostSelect, {}>;

// Combine all query options
const _options: PostFindOptions = {
  where: { title: { like: "%hello%" } },
  columns: { title: true, content: true },
  orderBy: { createdAt: "desc" },
  limit: 10,
  offset: 0,
};

// Locale options
const _optionsLocale: PostFindOptions = {
  locale: "en",
  localeFallback: true,
};

// Include deleted (soft delete)
const _optionsDeleted: PostFindOptions = {
  includeDeleted: true,
};

// ============================================================================
// FindOneOptions tests
// ============================================================================

type PostFindOneOptions = FindOneOptions<PostSelect, {}>;

// FindOneOptions should not have limit/offset
type _noLimit = Expect<Equal<HasKey<PostFindOneOptions, "limit">, false>>;
type _noOffset = Expect<Equal<HasKey<PostFindOneOptions, "offset">, false>>;

// But should have where, columns, orderBy
type _hasWhere = Expect<Equal<HasKey<PostFindOneOptions, "where">, true>>;
type _hasColumns = Expect<Equal<HasKey<PostFindOneOptions, "columns">, true>>;
type _hasOrderBy = Expect<Equal<HasKey<PostFindOneOptions, "orderBy">, true>>;

// ============================================================================
// Nested relation mutations tests
// ============================================================================

type AuthorMutation = NestedRelationMutation<{ name: string }>;

// Single connect
const _mutation1: AuthorMutation = {
  connect: { id: "user-123" },
};

// Array connect
const _mutation2: AuthorMutation = {
  connect: [{ id: "user-1" }, { id: "user-2" }],
};

// Create operation
type AuthorMutationCreate = NestedRelationMutation<{
  name: string;
  email: string;
}>;

const _mutationCreate1: AuthorMutationCreate = {
  create: { name: "John", email: "john@example.com" },
};

const _mutationCreate2: AuthorMutationCreate = {
  create: [
    { name: "John", email: "john@example.com" },
    { name: "Jane", email: "jane@example.com" },
  ],
};

// ConnectOrCreate operation
const _mutationConnectOrCreate: AuthorMutationCreate = {
  connectOrCreate: {
    where: { id: "user-123" },
    create: { name: "John", email: "john@example.com" },
  },
};

// All fields are optional (can be undefined)
type _connectCanBeUndefined = Expect<
  Extends<undefined, AuthorMutation["connect"]>
>;
type _createCanBeUndefined = Expect<
  Extends<undefined, AuthorMutation["create"]>
>;
type _connectOrCreateCanBeUndefined = Expect<
  Extends<undefined, AuthorMutation["connectOrCreate"]>
>;

// ============================================================================
// Complex query scenarios
// ============================================================================

// Deeply nested where conditions
const _complexWhere: PostWhere = {
  AND: [
    {
      OR: [{ title: { like: "%hello%" } }, { title: { like: "%world%" } }],
    },
    {
      views: { gt: 100 },
      publishedAt: { isNotNull: true },
    },
  ],
  NOT: {
    author: { eq: "excluded-author" },
  },
};

// Full query with all options
const _fullQuery: PostFindOptions = {
  where: {
    AND: [
      { title: { ilike: "%search%" } },
      { views: { gte: 10 } },
      {
        OR: [{ publishedAt: { isNotNull: true } }, { author: { eq: "admin" } }],
      },
    ],
  },
  columns: {
    id: true,
    title: true,
    views: true,
    publishedAt: true,
  },
  orderBy: {
    views: "desc",
    createdAt: "desc",
  },
  limit: 20,
  offset: 0,
  locale: "en",
  localeFallback: true,
  includeDeleted: false,
};

// ============================================================================
// Type safety edge cases
// ============================================================================

// Nullable fields should allow null checks
const _whereNullable: PostWhere = {
  content: { isNull: true },
};

const _whereDateNullable: PostWhere = {
  publishedAt: { isNull: false },
};

// Empty where clause
const _emptyWhere: PostWhere = {};

// Mixing direct values and operators
const _mixedWhere: PostWhere = {
  title: "Exact Match", // Direct value
  views: { gt: 100 }, // Operator
  author: { eq: "user-123" }, // Relation field uses operators
};
