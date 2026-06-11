# Query Operators Reference

Full reference for all `where` clause operators in QUESTPIE CRUD queries.

## Text Fields

Applies to: `text`, `textarea`, `richText`, `email`, `url`, `slug`

| Operator     | Example                           | Description             |
| ------------ | --------------------------------- | ----------------------- |
| equality     | `{ title: "Hello" }`              | Exact match (shorthand) |
| `eq`         | `{ title: { eq: "Hello" } }`      | Exact match             |
| `ne`         | `{ title: { ne: "Draft" } }`      | Not equal               |
| `not`        | `{ title: { not: "Draft" } }`     | Not equal alias         |
| `contains`   | `{ title: { contains: "ell" } }`  | Substring match         |
| `startsWith` | `{ title: { startsWith: "He" } }` | Prefix match            |
| `endsWith`   | `{ title: { endsWith: "lo" } }`   | Suffix match            |
| `in`         | `{ title: { in: ["A", "B"] } }`   | One of values           |
| `notIn`      | `{ title: { notIn: ["A"] } }`     | Not one of values       |
| `isNull`     | `{ title: { isNull: true } }`     | Is null                 |
| `isNotNull`  | `{ title: { isNotNull: true } }`  | Is not null             |

## Number Fields

Applies to: `number`

| Operator | Example                           | Description           |
| -------- | --------------------------------- | --------------------- |
| equality | `{ price: 1000 }`                 | Exact match           |
| `eq`     | `{ price: { eq: 1000 } }`         | Exact match           |
| `ne`     | `{ price: { ne: 1000 } }`         | Not equal             |
| `not`    | `{ price: { not: 1000 } }`        | Not equal alias       |
| `gt`     | `{ price: { gt: 1000 } }`         | Greater than          |
| `gte`    | `{ price: { gte: 1000 } }`        | Greater than or equal |
| `lt`     | `{ price: { lt: 5000 } }`         | Less than             |
| `lte`    | `{ price: { lte: 5000 } }`        | Less than or equal    |
| `in`     | `{ price: { in: [1000, 2000] } }` | One of values         |
| `notIn`  | `{ price: { notIn: [1000] } }`    | Not one of values     |
| `isNull` | `{ price: { isNull: true } }`     | Is null               |

## Boolean Fields

Applies to: `boolean`

| Operator | Example                          | Description     |
| -------- | -------------------------------- | --------------- |
| equality | `{ isActive: true }`             | Exact match     |
| `eq`     | `{ isActive: { eq: true } }`     | Exact match     |
| `ne`     | `{ isActive: { ne: true } }`     | Not equal       |
| `not`    | `{ isActive: { not: true } }`    | Not equal alias |
| `isNull` | `{ isActive: { isNull: true } }` | Is null         |

## Date / DateTime Fields

Applies to: `date`, `dateTime`

| Operator | Example                           | Description     |
| -------- | --------------------------------- | --------------- |
| equality | `{ date: "2025-03-01" }`          | Exact match     |
| `eq`     | `{ date: { eq: someDate } }`      | Exact match     |
| `ne`     | `{ date: { ne: someDate } }`      | Not equal       |
| `not`    | `{ date: { not: someDate } }`     | Not equal alias |
| `gt`     | `{ date: { gt: "2025-01-01" } }`  | After           |
| `gte`    | `{ date: { gte: "2025-01-01" } }` | On or after     |
| `lt`     | `{ date: { lt: "2025-12-31" } }`  | Before          |
| `lte`    | `{ date: { lte: "2025-12-31" } }` | On or before    |
| `isNull` | `{ date: { isNull: true } }`      | Is null         |

For `Date` instance values, always use the explicit `{ eq: someDate }`
operator — the bare equality shorthand only works for string/primitive
values.

System timestamps (`createdAt`, `updatedAt`, `deletedAt`) are stored as
`timestamp(3)` (millisecond precision), so a `Date` returned by a query
compares exactly against the stored value — safe for keyset cursors
(`lt`/`gt`/`eq` with a previously returned timestamp).

## Select Fields

Applies to: `select`, `multiSelect`

| Operator | Example                                      | Description       |
| -------- | -------------------------------------------- | ----------------- |
| equality | `{ status: "published" }`                    | Exact match       |
| `eq`     | `{ status: { eq: "published" } }`            | Exact match       |
| `ne`     | `{ status: { ne: "draft" } }`                | Not equal         |
| `not`    | `{ status: { not: "draft" } }`               | Not equal alias   |
| `in`     | `{ status: { in: ["draft", "published"] } }` | One of values     |
| `notIn`  | `{ status: { notIn: ["draft"] } }`           | Not one of values |

## Relation Fields

Applies to: `relation`

| Operator | Example                          | Description              |
| -------- | -------------------------------- | ------------------------ |
| equality | `{ author: "user-id" }`          | Match by related ID      |
| `eq`     | `{ author: { eq: "user-id" } }`  | Match by related ID      |
| `ne`     | `{ author: { ne: "user-id" } }`  | Exclude related ID       |
| `not`    | `{ author: { not: "user-id" } }` | Exclude related ID alias |
| `in`     | `{ author: { in: ["a", "b"] } }` | One of related IDs       |
| `notIn`  | `{ author: { notIn: ["a"] } }`   | Not one of related IDs   |
| `isNull` | `{ author: { isNull: true } }`   | No related ID            |

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

### Inequality Alias

`not` is a field-level alias for `ne`. Use either form for scalar fields:

```ts
where: {
	id: { not: excludedId },
}
```

When the compared value is `null`, `not` maps to an `IS NOT NULL` check:

```ts
where: {
	publishedAt: { not: null },
}
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
