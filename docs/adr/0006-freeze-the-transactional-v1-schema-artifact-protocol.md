# ADR 0006: Freeze the transactional v1 schema artifact protocol

- Status: Accepted
- Date: 2026-08-10

## Context

ADR 0002 separates desired state, reviewed history, and actual PostgreSQL
state. It did not define stable member identity, artifact bytes, destructive
approval, migration concurrency, Seed retries, or the boundary of drift. Those
choices affect stored names, checksums, and history and must be fixed before
runtime code starts.

PostgreSQL also has useful schema operations that cannot share one transaction,
including concurrent index creation. Supporting them honestly requires a
resumable multi-phase protocol. The Barbershop tracer does not need that
protocol.

## Decision

The first tracer uses the v1 artifact protocol in
`docs/v4/schema-lifecycle.md`.

- Application objects live in one explicit application schema.
- Resource and member identity is semantic. PostgreSQL names are deterministic
  projections or explicit physical names.
- The Compiled Manifest contains a versioned Schema Projection. Schema
  Projection, Migration Plan, base and target snapshots, and Schema Fingerprint
  have canonical JSON formats and domain-separated SHA-256 digests.
- A rename requires an explicit one-to-one planner mapping. The planner never
  guesses.
- A Committed Migration has one linear six-digit identity and one checksum over
  the exact reviewed metadata, Plan, base and target Schema Projections, and
  generated SQL.
- A destructive plan is accepted by its exact Plan Digest when the migration is
  created.
- Each v1 migration executes in one PostgreSQL transaction and records its
  immutable Migration Receipt in that transaction.
- Non-transactional DDL, handwritten SQL migrations, down migrations, and
  branch DAG merging are not part of schema artifact v1.
- Seeds are immutable, dependency-ordered, once-only artifacts. Their writes
  and Seed Receipt commit in one transaction. V1 Seeds contain only typed,
  data-only insert, update, upsert, and delete steps.
- Schema and Seed authoring modules execute inside the controlled structural
  evaluator. The evaluator forbids environment, I/O, clock, random, process,
  and other nondeterministic build-time effects. It is a determinism boundary,
  not a security sandbox for hostile Package code.
- Drift covers every object inside the application schema and every declared
  external dependency.

## Consequences

- A response lost after migration or Seed commit is safe to retry.
- A checksum mismatch, unknown applied migration, or manual application-schema
  DDL stops deployment instead of being repaired implicitly.
- Parallel branches can conflict on a sequence number and must replan.
- The first tracer can prove one atomic path without pretending to provide
  production online DDL.
- Later non-schema Resources can extend the Compiled Manifest without changing
  the Schema Projection Digest or creating migrations.
- A later online migration protocol requires a new artifact version and crash
  recovery proof. It cannot weaken v1 receipts or reinterpret v1 checksums.

## Rejected alternatives

- Infer renames from similar names or column shapes.
- Approve destructive changes with a generic `--force` at apply time.
- Let development push an ephemeral schema while production uses migrations.
- Permit Package-specific migration tables or migrators.
- Claim one transaction while silently executing concurrent DDL outside it.
- Make applied Seeds mutable or rerunnable with an unchecked callback.
