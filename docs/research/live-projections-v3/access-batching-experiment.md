# Measured: relation batching does not bound field-ACL SQL

2026-10-22. Research fixture only; no production changes. **V3 already batches belongsTo relations, but an asynchronous field-read rule can restore linear SQL growth. Explicit evaluation-scoped authority acquisition removes that growth without sharing facts across requests or principals.**

## Reproduction and provenance

Run [the fixture](../../../packages/questpie/bench/projection-access-batching-prototype.ts) with an explicitly supplied disposable PostgreSQL URL:

```sh
QUESTPIE_PROJECTION_ACCESS_DATABASE_URL="$DISPOSABLE_PG_URL" \
  bun packages/questpie/bench/projection-access-batching-prototype.ts
```

Measured PostgreSQL **17.11**, Bun **1.4.2**. Bun differs from the repository's pinned 1.3.13; this is disclosed rather than treated as compatibility proof. Framework checkout: `82fca046befe9cc487962ebdb49efa46e2d9ff09`. The three relevant read implementations are byte-identical to production-main source `a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b`: [CRUD execution](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/crud-generator.ts), [belongsTo resolver](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/relation-resolvers/belongs-to.ts), [field-read access](https://github.com/questpie/questpie/blob/a65bdc4c2a39dd4c16c9d69bbe2811784fb6714b/packages/questpie/src/server/collection/crud/shared/access-control.ts).

The fixture follows `test/collection/read-execution-postgres.test.ts`: generated CRUD, node-postgres Drizzle logger, and scratch-only table DDL. It seeds 100 rows in each of three tables. Every measured read uses `accessMode: "user"`. Direct inserts only provision fixtures. A unique schema is dropped in `finally`, with a catalog assertion confirming removal. No existing tables are touched.

## Actual output

[Raw JSON](access-batching-experiment.json) records all 36 evaluations. Alice and Bob have disjoint secret-field grants; both produce these counts:

```text
Roots                         10       50       100
A manual related findOne      12       52       102
B built-in with                4        4         4
C with + per-row SQL ACL      14       54       104
D with + batched facts         5        5         5
```

Every SQL statement during evaluation is counted, including implicit counts and ACL queries. Setup/cleanup are excluded. At 100 roots:

```text
Case  data SELECTs  count SELECTs  ACL SQL  unclassified
A          101            1           0         0
B            2            2           0         0
C            2            2         100         0
D            2            2           1         0
```

Root access runs once in every case. Related-collection access runs N times in A and once in B/C/D. Field decisions still run N times everywhere. Grant access runs N times in C and once in D. D loads authorized grant rows using bounded `findRows`, then makes synchronous Set-membership field decisions. Its facts are newly acquired inside each evaluation, before reading roots; no cross-request cache exists. A/B use a pure synthetic decision matching the seeded grants, isolating relation cost.

All cases assert identical disclosed results. Of 100 roots, ten foreign-tenant and ten hidden same-tenant related records become null; only 50 authorized secrets survive for each principal, on different roots. The other-tenant root probes return zero records in every mode, with two SQL statements for A/B/C and three for D. SQL formulas and callback counts are assertions, not observations left unchecked.

## Delivery implication and limits

**Proposal:** make the planned declarative read path an early slice. A named definition should generate HTTP/MCP/client adapters and one command handler, eliminating duplicated route/tool schemas and orchestration. The read planner must expose declared batched authority resources, union relation keys, and reject unsupported per-row I/O instead of silently falling back. Hiding arbitrary I/O behind an async callback cannot guarantee bounded SQL. Preserve related row/field access when batching.

The existing relation path performs an extra count query; optimizing counts is separate from eliminating N+1. This experiment proves query growth and disclosure for one belongsTo edge, not production latency, nested/hasMany limits, revocation, consistent snapshots, or arbitrary policies. Production facts need complete dependency and expiry handling; evaluation-only reuse is the safe starting point. The run emitted node-postgres's concurrent-client-query deprecation warning; no timing conclusion relies on that scheduling.

Validation: executable fixture passed, including schema cleanup; targeted Oxlint passed and the fixture was formatted. No full suite, build, framework fix, commit or push.
