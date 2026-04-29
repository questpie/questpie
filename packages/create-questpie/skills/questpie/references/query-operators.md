# Query Operators Reference

Full reference for all `where` clause operators in QUESTPIE CRUD queries.

## Text Fields

Applies to: `text`, `textarea`, `richText`, `email`, `url`, `slug`

| Operator     | Example                           | Description             |
| ------------ | --------------------------------- | ----------------------- |
| equality     | `{ title: "Hello" }`              | Exact match (shorthand) |
| `contains`   | `{ title: { contains: "ell" } }`  | Substring match         |
| `startsWith` | `{ title: { startsWith: "He" } }` | Prefix match            |
| `endsWith`   | `{ title: { endsWith: "lo" } }`   | Suffix match            |
| `in`         | `{ title: { in: ["A", "B"] } }`   | One of values           |

## Number Fields

Applies to: `number`

| Operator | Example                           | Description           |
| -------- | --------------------------------- | --------------------- |
| equality | `{ price: 1000 }`                 | Exact match           |
| `gt`     | `{ price: { gt: 1000 } }`         | Greater than          |
| `gte`    | `{ price: { gte: 1000 } }`        | Greater than or equal |
| `lt`     | `{ price: { lt: 5000 } }`         | Less than             |
| `lte`    | `{ price: { lte: 5000 } }`        | Less than or equal    |
| `in`     | `{ price: { in: [1000, 2000] } }` | One of values         |

## Boolean Fields

Applies to: `boolean`

| Operator | Example              | Description |
| -------- | -------------------- | ----------- |
| equality | `{ isActive: true }` | Exact match |

## Date / DateTime Fields

Applies to: `date`, `dateTime`

| Operator | Example                           | Description  |
| -------- | --------------------------------- | ------------ |
| equality | `{ date: "2025-03-01" }`          | Exact match  |
| `gt`     | `{ date: { gt: "2025-01-01" } }`  | After        |
| `gte`    | `{ date: { gte: "2025-01-01" } }` | On or after  |
| `lt`     | `{ date: { lt: "2025-12-31" } }`  | Before       |
| `lte`    | `{ date: { lte: "2025-12-31" } }` | On or before |

## Select Fields

Applies to: `select`, `multiSelect`

| Operator | Example                                      | Description   |
| -------- | -------------------------------------------- | ------------- |
| equality | `{ status: "published" }`                    | Exact match   |
| `in`     | `{ status: { in: ["draft", "published"] } }` | One of values |

## Relation Fields

Applies to: `relation`

| Operator | Example                 | Description         |
| -------- | ----------------------- | ------------------- |
| equality | `{ author: "user-id" }` | Match by related ID |

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
