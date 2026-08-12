# Structural Query type proof

This throwaway fixture answers one question from the v4 data-model grill: can
Resource-local Field types and generated concrete Relation descriptors infer
exact row, insert, update, parameter, selection, inverse-existence, and
paginated result shapes without an ORM type, ambient registry, or
whole-application recursive generic?

It uses the documented two-stage `dataQuery<Collection>()({...})` shape so the
generated Collection descriptor is explicit while inner literal generics remain
inferred. Selection proves aliases, selecting the same Field twice, and a
nullable one-hop Relation result. Field operator, Relation target, and unique
suffix types derive from that descriptor rather than an appointments-specific
builder. Each Field descriptor also carries its exact semantic identity. The
full call uses the documented `where`, fluent `orderBy`, and
`query.forwardCursor` page shape. It also holds negative assertions for exact
`from`, field scope, unbounded array-shaped scalar parameters, empty literal
membership lists, derived selected-order Fields,
extra nullable scalar parameters, independently omitted structural clauses,
text and UUID range comparison, and nullable total-order keys. A second valid
call proves that page parameter keys are not reserved names. A literal two-entry
Collection Augmentation tuple and distinct timestamp codec tags with plain
`string` public values are part of the same inference budget. The final fixture
also proves bounded scalar-list parameters, text order eligibility, logical
inline-column shapes, typed JSONB embedded objects/arrays, and the type-level
separation that prevents a native column capability from masquerading as an
embedded JSON value. Open JSON uses a tagged public value so SQL `NULL` remains
distinct from top-level JSON `null`; the semantic golden also rejects regular
Collections with zero or multiple primary-key Constraints and pins canonical
segment-array Field paths.

Run from the repository root:

```bash
bun node_modules/typescript/bin/tsc \
	-p docs/v4/prototypes/query-grammar-types/tsconfig.json \
	--extendedDiagnostics
```

The isolated fixture passes only when TypeScript reports no error and at most
25,000 instantiations under the repository's pinned TypeScript 5.9.2. It is
proof evidence on a throwaway branch, not a production type implementation.
