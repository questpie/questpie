# Durable trace-link PostgreSQL proof

This isolated Proposed-ADR-0033 proof imports the production protocol-v7
catalog and checksum, then derives and pins protocol v8 as exactly three
nullable columns plus one completeness constraint on `durable_runs`. Tables,
existing columns, existing constraints, and indexes otherwise remain byte-for-
byte catalog projections of v7. The executable PostgreSQL seam is extracted
from the production v7 `durable_dispatches`, `durable_runs`, and
`durable_attempts` DDL and uses the production deterministic Run identity.

There is deliberately no database `runtime_instances` registry. The cutover is
an operator-owned, explicit non-rolling acknowledgement followed by exact
version-and-checksum refusal: v8 refuses v7 before migration and v7 refuses v8
afterward. A database row cannot prove that every old process has stopped.

Job and Reaction acceptance use their actual v7 shape: the dispatch ledger owns
the idempotency fact and Run has one unique dispatch. Only the first successful
Run insert records trace ID, span ID, and flags. Duplicate acceptance retains
those bytes, rollback records nothing, and old v7 rows decode null. Attempt
roots and links remain ephemeral; the existing production Attempt table stores
only attempt and lease/fencing data. Retry and lease reclaim create new sibling
roots linked to the Run's first accepted context.

The proof covers exact catalog/checksum derivation, Job and Reaction first-run
acceptance, duplicate/conflict, rollback, old rows, hostile trace widths,
retry/reclaim, Attempt pruning, and byte-exact backup/restore. It is a
falsifiable schema/acceptance proof, not a second Durable runtime kernel.

Run against a disposable PostgreSQL 17 instance:

```sh
PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres PGDATABASE=postgres \
	bun test docs/v4/prototypes/opentelemetry-boundary/durable-link/check.test.ts
```

Run the static checks:

```sh
bunx tsc -p docs/v4/prototypes/opentelemetry-boundary/durable-link/tsconfig.json
bunx oxlint docs/v4/prototypes/opentelemetry-boundary/durable-link/*.ts
bunx oxfmt --check docs/v4/prototypes/opentelemetry-boundary/durable-link
```
