# BETA-09: the PostgreSQL matrix, and why the counts differ

The issue's verification asks for `test:postgres --scenario beta09`. This records
the matrix across all three supported majors, and explains the count difference
that BETA-08's fourth review round flagged as unexplained.

Measured at the performance-baseline head, containers `questpie-beta02-pg16`,
`-pg17` and `-pg18`.

| PostgreSQL | Passing | Skipped | Failing |
| ---------- | ------- | ------- | ------- |
| 16         | 115     | 3       | 0       |
| 17         | 115     | 3       | 0       |
| 18         | 118     | 0       | 0       |

## Why 18 runs three more

BETA-08's review recorded this as "minor, unexplained: PostgreSQL 18 reports 108
passing where 16 and 17 report 105, with no note on which three tests are
version-gated." The same three tests produce the same shape here, and they are
named rather than left as a discrepancy.

All three live in `tests/integration/postgres/beta02-catalog-reader.test.ts` and
are gated by `test.skipIf(process.env.QUESTPIE_POSTGRES_MAJOR !== "18")`:

- `rejects a PostgreSQL 18 NOT ENFORCED check constraint` (`:669`)
- `rejects PostgreSQL 18 PERIOD constraints` (`:700`)
- `rejects a non-inherited PostgreSQL 18 NOT NULL catalog constraint` (`:731`)

Each drives a catalog construct that exists only in PostgreSQL 18, so on 16 and
17 there is nothing to reject and the test would assert against a feature the
server cannot express. Skipping is the correct behaviour and the gate is
deliberate; the count difference is evidence that the gate works rather than a
gap in coverage.

## What the matrix does and does not prove

It proves the durable kernel, the internal protocol v5 upgrade, the inspection
projection, the worklist, the maintenance guard and the Studio mount behave
identically on every supported major, including the v4-to-v5 upgrade running on
each.

It does not prove anything about the interface, which has no test that a browser
executes, or about the four criteria behind the prohibitions in
`narrower-claims.md`. A green matrix is not a substitute for the parts of the
slice that are not built.

## Measured at `91eeb3db`, and the lane matters

| PostgreSQL | Passing | Failing |
| ---------- | ------- | ------- |
| 16         | 115     | 0       |
| 17         | 115     | 0       |
| 18         | 118     | 0       |

The 18 difference is the three version-gated catalog cases in
`beta02-catalog-reader.test.ts` — NOT ENFORCED check constraints, PERIOD
constraints, and a non-inherited NOT NULL catalog constraint. Each drives a
construct only 18 has, so the delta is evidence the gate works rather than
coverage drift.

**Run it through `bun run test:postgres`, never `bun test
tests/integration/postgres/`.** The difference is not cosmetic and it cost real
time here. `scripts/quality.ts:187` runs **one file per process, sequentially**
(`for (const root of roots) run(["bun", "test", root])`). The directory form
loads all twenty-one files into a single process, where
`beta08-internal-protocol.test.ts` drops the shared `questpie_internal` schema in
`beforeEach` and `helpers/beta08-durable.ts` calls `pg_terminate_backend` on
every other connection to the database.

Five directory-form runs against PostgreSQL 16 reported 0, 13, 0, 2 and 0
failures. That reads as a version-specific flake and is not one: the same suite
is clean every time through the sequenced lane, and BETA-09's own two files pass
ten of ten on 16 three runs running. BETA-08's fourth review recorded this hazard
as an observation — "PostgreSQL suite correctness depends on strict per-file
sequencing enforced outside this packet" — and this is what falling into it looks
like from the inside.
