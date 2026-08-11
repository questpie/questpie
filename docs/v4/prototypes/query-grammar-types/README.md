# Structural Query type proof

This throwaway fixture answers one question from the v4 data-model grill: can
Resource-local Field types and one generated concrete Relation selection infer
the exact row, insert, update, parameter, and paginated result shapes without an
ORM type, ambient registry, or whole-application recursive generic?

Run from the repository root:

```bash
bunx tsc \
	-p docs/v4/prototypes/query-grammar-types/tsconfig.json \
	--extendedDiagnostics
```

The isolated fixture passes only when TypeScript reports no error and at most
25,000 instantiations under the repository's pinned TypeScript 5.9.2. It is
proof evidence on a throwaway branch, not a production type implementation.
