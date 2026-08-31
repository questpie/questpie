# Durable trace-link PostgreSQL proof

This isolated Proposed-ADR-0033 proof models a non-rolling internal protocol v8
cutover. Protocol v7 has no trace columns. The explicit zero-runtime v8 cutover
adds one all-null-or-complete trace context to each Durable Run and creates
Physical Attempt rows whose fresh root contexts link to that first accepted
context.

The proof covers Job and Reaction acceptance, replay, rollback, old null rows,
retry/reclaim siblings, two v8 instances, disclosure-safe storage, and byte-exact
backup/restore plus pruning. It does not edit or stand in for the production
Durable kernel.

Run against PostgreSQL 17:

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
