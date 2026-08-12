# P2 trusted Context and relational Policy proof

This directory is an executable witness for the bounded P2 contract in the
framework API atlas proof map. It is not a production compiler or Runtime.

The proof starts from exact P1 head
`713485a64bcc4795d960d576fea51da56bc4dcdd` and keeps the foundational Schema,
Data Contract, structural Query, and P1 executable-compiler digests fixed. It
tests only:

- transport-neutral `defineContext({ input, resolve })` and exact generated
  input/resolved types;
- immutable root Execution construction, once-per-root resolution, concurrent
  coalescing, nested propagation, failure order, and scoped Service disposal;
- bounded read-only `bootstrap.get` without raw database, Queue, Services, or
  System Authority;
- Collection-bound `definePolicy(collection, body)` and bounded typed
  `policy.exists(collection, predicate)`;
- admission, SQL row scope, sparse caller input, selected output, current and
  candidate rows, nondisclosure, cursor scope, lock recheck, dependencies, and
  direct/network/recompute/worker/Studio parity;
- a Company/Space/Channel/Membership/Message graph plus a separate
  Archive/Record/Permit application with composite natural keys;
- PostgreSQL 17 lowering and plans using only ordinary B-tree indexes.

The proof deliberately emits no PostgreSQL RLS projection or database-enforced
authorization claim. Policy remains the product model; the database evidence
covers framework-owned SQL pushdown only.

Run the complete proof with Bun:

```bash
bun docs/v4/prototypes/context-policy/run.mjs
```

The PostgreSQL harness discovers a running PostgreSQL 17 Docker container and
uses one exact temporary schema, which it removes in `finally`. Override the
container name with `QUESTPIE_P2_POSTGRES_CONTAINER` when needed.
