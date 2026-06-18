# Query Operators Reference

Full reference for all `where` clause operators in QUESTPIE CRUD queries.

## Contents

- [Text Fields](#text-fields), `text`/`textarea`/`email`/`url`, plus email domain and url host/protocol matchers
- [Number Fields](#number-fields), comparison + membership + null checks
- [Boolean Fields](#boolean-fields), equality + null checks
- [Date / DateTime / Time Fields](#date--datetime--time-fields), comparison + membership, `Date` value caveat
- [Select Fields (single)](#select-fields-single), equality + membership + null checks
- [Multi-Select Fields](#multi-select-fields), `select().array()` array matchers (`containsAll`/`containsAny`/…)
- [Relation Fields](#relation-fields), `belongsTo` (`is`/`isNot`) vs to-many (`some`/`none`/`every`)
- [JSON / Object Fields](#json--object-fields), JSONB containment, key, and path operators
- [Combining Operators](#combining-operators), AND across fields/operators, `AND`/`OR`/`NOT`
- [Complete Example](#complete-example)

## Text Fields

Applies to: `text`, `textarea`, `email`, `url`. (`slug` is just a `text` field; rich-text content is stored as blocks/JSON, not queried with these operators.)

| Operator     | Example                            | Description                |
| ------------ | ---------------------------------- | -------------------------- |
| equality     | `{ title: "Hello" }`               | Exact match (shorthand)    |
| `eq`         | `{ title: { eq: "Hello" } }`       | Exact match                |
| `ne`         | `{ title: { ne: "Hello" } }`       | Not equal                  |
| `in`         | `{ title: { in: ["A", "B"] } }`    | One of values              |
| `notIn`      | `{ title: { notIn: ["A", "B"] } }` | None of values             |
| `contains`   | `{ title: { contains: "ell" } }`   | Substring match            |
| `startsWith` | `{ title: { startsWith: "He" } }`  | Prefix match               |
| `endsWith`   | `{ title: { endsWith: "lo" } }`    | Suffix match               |
| `like`       | `{ title: { like: "He%o" } }`      | SQL LIKE (case-sensitive)  |
| `ilike`      | `{ title: { ilike: "he%o" } }`     | SQL LIKE (case-insensitive) |
| `notLike`    | `{ title: { notLike: "He%o" } }`   | Negated LIKE               |
| `notIlike`   | `{ title: { notIlike: "he%o" } }`  | Negated case-insensitive LIKE |
| `isNull`     | `{ title: { isNull: true } }`      | Is NULL                    |
| `isNotNull`  | `{ title: { isNotNull: true } }`   | Is NOT NULL                |

`email` fields add domain matching on top of the text operators:

| Operator   | Example                                                    | Description           |
| ---------- | ---------------------------------------------------------- | --------------------- |
| `domain`   | `{ email: { domain: "acme.com" } }`                        | Match by email domain |
| `domainIn` | `{ email: { domainIn: ["acme.com", "x.io"] } }`            | Domain is one of      |

`url` fields add host and protocol matching on top of the text operators:

| Operator   | Example                                       | Description        |
| ---------- | --------------------------------------------- | ------------------ |
| `host`     | `{ link: { host: "example.com" } }`           | Match by host      |
| `hostIn`   | `{ link: { hostIn: ["a.com", "b.com"] } }`    | Host is one of     |
| `protocol` | `{ link: { protocol: "https" } }`             | Match by protocol  |

## Number Fields

Applies to: `number`

| Operator    | Example                              | Description           |
| ----------- | ------------------------------------ | --------------------- |
| equality    | `{ price: 1000 }`                    | Exact match           |
| `eq`        | `{ price: { eq: 1000 } }`            | Exact match           |
| `ne`        | `{ price: { ne: 1000 } }`            | Not equal             |
| `gt`        | `{ price: { gt: 1000 } }`            | Greater than          |
| `gte`       | `{ price: { gte: 1000 } }`           | Greater than or equal |
| `lt`        | `{ price: { lt: 5000 } }`            | Less than             |
| `lte`       | `{ price: { lte: 5000 } }`           | Less than or equal    |
| `in`        | `{ price: { in: [1000, 2000] } }`    | One of values         |
| `notIn`     | `{ price: { notIn: [1000, 2000] } }` | None of values        |
| `isNull`    | `{ price: { isNull: true } }`        | Is NULL               |
| `isNotNull` | `{ price: { isNotNull: true } }`     | Is NOT NULL           |

## Boolean Fields

Applies to: `boolean`

| Operator    | Example                             | Description |
| ----------- | ----------------------------------- | ----------- |
| equality    | `{ isActive: true }`                | Exact match |
| `eq`        | `{ isActive: { eq: true } }`        | Exact match |
| `ne`        | `{ isActive: { ne: true } }`        | Not equal   |
| `isNull`    | `{ isActive: { isNull: true } }`    | Is NULL     |
| `isNotNull` | `{ isActive: { isNotNull: true } }` | Is NOT NULL |

## Date / DateTime / Time Fields

Applies to: `date`, `datetime`, `time` (all three share the same operators).

| Operator    | Example                                                  | Description    |
| ----------- | -------------------------------------------------------- | -------------- |
| equality    | `{ date: "2025-03-01" }`                                 | Exact match    |
| `eq`        | `{ date: { eq: someDate } }`                             | Exact match    |
| `ne`        | `{ date: { ne: someDate } }`                             | Not equal      |
| `gt`        | `{ date: { gt: "2025-01-01" } }`                         | After          |
| `gte`       | `{ date: { gte: "2025-01-01" } }`                        | On or after    |
| `lt`        | `{ date: { lt: "2025-12-31" } }`                         | Before         |
| `lte`       | `{ date: { lte: "2025-12-31" } }`                        | On or before   |
| `in`        | `{ date: { in: ["2025-01-01", "2025-02-01"] } }`         | One of values  |
| `notIn`     | `{ date: { notIn: ["2025-01-01", "2025-02-01"] } }`      | None of values |
| `isNull`    | `{ date: { isNull: true } }`                             | Is NULL        |
| `isNotNull` | `{ date: { isNotNull: true } }`                          | Is NOT NULL    |

For `Date` instance values, always use the explicit `{ eq: someDate }`
operator, the bare equality shorthand only works for string/primitive
values.

System timestamps (`createdAt`, `updatedAt`, `deletedAt`) are stored as
`timestamp(3)` (millisecond precision), so a `Date` returned by a query
compares exactly against the stored value, safe for keyset cursors
(`lt`/`gt`/`eq` with a previously returned timestamp).

## Select Fields (single)

Applies to: `select` (single value).

| Operator    | Example                                       | Description    |
| ----------- | --------------------------------------------- | -------------- |
| equality    | `{ status: "published" }`                     | Exact match    |
| `eq`        | `{ status: { eq: "published" } }`             | Exact match    |
| `ne`        | `{ status: { ne: "draft" } }`                 | Not equal      |
| `in`        | `{ status: { in: ["draft", "published"] } }`  | One of values  |
| `notIn`     | `{ status: { notIn: ["archived"] } }`         | None of values |
| `isNull`    | `{ status: { isNull: true } }`                | Is NULL        |
| `isNotNull` | `{ status: { isNotNull: true } }`             | Is NOT NULL    |

## Multi-Select Fields

Applies to a multi-value select, `f.select([...]).array()` (an array of values, stored as JSONB). There is no separate `multiSelect` field type; `.array()` switches the field to this operator set. It is **distinct** from the single-select set above (`in`/`notIn` do not apply here):

| Operator      | Example                                          | Description                  |
| ------------- | ------------------------------------------------ | ---------------------------- |
| `eq`          | `{ tags: { eq: ["a", "b"] } }`                   | Array equals exactly         |
| `containsAll` | `{ tags: { containsAll: ["a", "b"] } }`          | Contains all listed values   |
| `containsAny` | `{ tags: { containsAny: ["a", "b"] } }`          | Contains any listed value    |
| `length`      | `{ tags: { length: 3 } }`                        | Array has N elements         |
| `isEmpty`     | `{ tags: { isEmpty: true } }`                    | Empty array or NULL          |
| `isNotEmpty`  | `{ tags: { isNotEmpty: true } }`                 | Non-empty array              |
| `isNull`      | `{ tags: { isNull: true } }`                     | Is NULL                      |
| `isNotNull`   | `{ tags: { isNotNull: true } }`                  | Is NOT NULL                  |

## Relation Fields

### belongsTo (single relation, FK on this table)

| Operator    | Example                                  | Description                 |
| ----------- | ---------------------------------------- | --------------------------- |
| equality    | `{ author: "user-id" }`                  | Match by related ID         |
| `eq`        | `{ author: { eq: "user-id" } }`          | Match by related ID         |
| `ne`        | `{ author: { ne: "user-id" } }`          | Not this related ID         |
| `in`        | `{ author: { in: ["id1", "id2"] } }`     | Related ID is one of        |
| `notIn`     | `{ author: { notIn: ["id1"] } }`         | Related ID is none of       |
| `isNull`    | `{ author: { isNull: true } }`           | No related record           |
| `isNotNull` | `{ author: { isNotNull: true } }`        | Has a related record        |
| `is`        | `{ author: { is: { role: "admin" } } }`  | Related record matches where |
| `isNot`     | `{ author: { isNot: { role: "admin" } } }` | Related record does NOT match |

You can also pass the target's `where` directly as a shorthand for `is`: `{ author: { role: "admin" } }`.

### hasMany / manyToMany (to-many relations)

To-many relations expose only the quantifiers below (no bare FK value). Each takes a sub-`where` against the related collection:

| Operator | Example                                          | Description                       |
| -------- | ------------------------------------------------ | --------------------------------- |
| `some`   | `{ comments: { some: { approved: true } } }`     | At least one related row matches  |
| `none`   | `{ comments: { none: { spam: true } } }`         | No related row matches            |
| `every`  | `{ comments: { every: { approved: true } } }`    | All related rows match            |

## JSON / Object Fields

Applies to: `object` (structured nested fields stored as JSONB). The schemaless `json` field uses the basic set instead (`eq`, `ne`, `in`, `notIn`, `isNull`, `isNotNull`).

| Operator      | Example                                                       | Description                          |
| ------------- | ------------------------------------------------------------- | ------------------------------------ |
| `contains`    | `{ meta: { contains: { active: true } } }`                    | JSONB `@>` (contains object)         |
| `containedBy` | `{ meta: { containedBy: { a: 1, b: 2 } } }`                   | JSONB `<@` (contained by object)     |
| `hasKey`      | `{ meta: { hasKey: "active" } }`                              | Top-level key exists                 |
| `hasKeys`     | `{ meta: { hasKeys: ["a", "b"] } }`                           | All listed keys exist                |
| `hasAnyKeys`  | `{ meta: { hasAnyKeys: ["a", "b"] } }`                        | Any listed key exists                |
| `pathEquals`  | `{ meta: { pathEquals: { path: ["a", "b"], val: 1 } } }`      | Value at JSON path equals            |
| `jsonPath`    | `{ meta: { jsonPath: "$.a ? (@ > 1)" } }`                     | Matches a JSONPath predicate (`@@`)  |
| `isEmpty`     | `{ meta: { isEmpty: true } }`                                 | Empty object `{}` or NULL            |
| `isNotEmpty`  | `{ meta: { isNotEmpty: true } }`                              | Non-empty object                     |
| `isNull`      | `{ meta: { isNull: true } }`                                  | Is NULL                              |
| `isNotNull`   | `{ meta: { isNotNull: true } }`                               | Is NOT NULL                          |

## Combining Operators

### Multiple Fields (AND)

All top-level fields are combined with AND:

```ts
where: {
  status: "published",
  price: { gte: 1000 },
  createdAt: { gte: "2025-01-01" },
}
// status = "published" AND price >= 1000 AND createdAt >= 2025-01-01
```

### Multiple Operators on Same Field (AND)

Multiple operators on one field are ANDed together:

```ts
where: {
  price: { gte: 1000, lt: 5000 },
}
// 1000 <= price < 5000
```

### Equality Shorthand

Direct values are equivalent to exact match:

```ts
// These are equivalent:
where: {
	status: "published";
}
where: {
	status: {
		eq: "published";
	}
}
```

### Logical Operators (`AND` / `OR` / `NOT`)

Every `where` accepts top-level `AND`, `OR`, and `NOT` keys for explicit boolean logic. `AND`/`OR` take an array of sub-where clauses; `NOT` takes a single sub-where clause. They nest and combine with plain field conditions:

```ts
where: {
	status: "published",            // implicit AND with the clauses below
	OR: [
		{ price: { lt: 1000 } },
		{ featured: true },
	],
	NOT: { category: "archived" },
}
// status = 'published' AND (price < 1000 OR featured) AND NOT (category = 'archived')
```

## Complete Example

```ts
const result = await collections.products.find({
	where: {
		status: "published",
		price: { gte: 1000, lte: 50000 },
		title: { contains: "premium" },
		category: { in: ["electronics", "software"] },
		createdAt: { gte: "2025-01-01" },
	},
	orderBy: { price: "asc" },
	limit: 20,
	offset: 0,
	with: { category: true },
});
```
