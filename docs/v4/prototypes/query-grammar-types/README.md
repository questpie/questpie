# Structural Query type proof

This throwaway fixture answers one question from the v4 data-model grill: can
Resource-local Field types and generated concrete Relation descriptors infer
exact row, insert, update, parameter, selection, inverse-existence, and
paginated result shapes without an ORM type, ambient registry, or
whole-application recursive generic?

It uses the documented two-stage `dataQuery<Collection>()({...})` shape so the
generated Collection descriptor is explicit while inner literal generics remain
inferred. It also holds negative assertions for exact `from`, field scope,
runtime list parameters, empty membership lists, derived selected-order Fields,
text range comparison, and nullable total-order keys. A literal two-entry
Collection Augmentation tuple and distinct timestamp codec tags with plain
`string` public values are part of the same inference budget.

Run from the repository root:

```bash
bun node_modules/typescript/bin/tsc \
	-p docs/v4/prototypes/query-grammar-types/tsconfig.json \
	--extendedDiagnostics
```

The isolated fixture passes only when TypeScript reports no error and at most
25,000 instantiations under the repository's pinned TypeScript 5.9.2. It is
proof evidence on a throwaway branch, not a production type implementation.
