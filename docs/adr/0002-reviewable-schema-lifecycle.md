# ADR 0002: Use one reviewable schema and migration lifecycle

- Status: Accepted
- Date: 2026-08-10

## Context

An agent cannot work safely when the desired schema, migration history, and
actual database state can change through unrelated paths. An unrecorded schema
push makes the database an implicit source of truth and hides why a change
exists.

QUESTPIE already compiles application Definitions and needs deterministic
migrations, Drift checks, and generated contracts from the same Compiled
Manifest.

## Decision

QUESTPIE distinguishes three schema facts:

- the Compiled Manifest is desired state;
- committed migrations are reviewed history;
- the Schema Fingerprint is actual PostgreSQL state.

The CLI compares all three. The normal change path is compile, plan, review,
commit, apply, and verify drift.

QUESTPIE does not provide an unrecorded `db push` path. A fast local interaction
may combine plan and apply, but it must expose and preserve the same Migration
Plan.

Every Committed Migration has stable identity and checksum. Every Seed has
stable identity, dependencies, and an explicit idempotency contract.

## Consequences

- Human and AI contributors can explain every schema change from source to
  database.
- Destructive operations, ownership, and PostgreSQL requirements are visible
  before apply.
- CI and deployment can reject checksum mismatch and drift.
- Code generation and migrations cannot silently use different application
  models.

## Rejected alternatives

- Treat the live database as the only schema authority.
- Allow development push and production migrations to use separate planners.
- Generate TypeScript only by introspecting whatever schema currently exists.
