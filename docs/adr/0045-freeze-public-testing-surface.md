# ADR-0045: Freeze public testing surface

- Status: Proposed
- Date: 2026-09-21
- Owners: Product architecture, public TypeScript surface, release

## Context

`packages/testkit` (`@questpie/testkit`) is `private: true`. It carries a
small set of generic test-lifecycle helpers (`CleanupStack`, `eventually`,
`waitForOutputLine`) that `tests/integration/postgres/*.test.ts` already uses
to drive Team Support Desk, Collaboration, and Archive against real
PostgreSQL. Those fixtures also already boot a compiled application, obtain a
trusted `Principal` through `principal.user()`/`principal.service()` (public
today from the `questpie` root), call generated Queries/Mutations/Actions
in-process (`app.execution`) and over HTTP (`app.fetch`), and drive the
Durable worker (`app.durable.worker().poll()`), all through the compiled
application's own generated `.questpie/generated` output and the `questpie`
package root. None of that machinery is private; it is simply undocumented as
a consumer-facing seam.

An application outside this repository, compiling against QUESTPIE through
published exports only, has no way to reach `CleanupStack`/`eventually` (they
live in a `private` workspace) and no reusable way to get an isolated
PostgreSQL database with committed migrations applied and torn down. Today
`tests/integration/postgres/team-support-desk.test.ts` gets isolation by
hand-writing `DROP SCHEMA ... CASCADE` against a schema name it only knows
because it is inside this monorepo and can read the fixture's generated
`schema-projection.json`. That is framework-internal proof machinery, not a
seam an external application can depend on.

ADR-0042 is Accepted and fixes QUESTPIE's release cardinality at exactly two
public npm packages, `questpie` and `questpie-opentelemetry`, with no
workspace-only public identity and no third publishable archive. This
decision does not reopen that cardinality: it proposes one additional export
subpath on the existing `questpie` package, the same mechanism ADR-0042
itself already uses for `./react-query`.

## Proposed decision

`questpie` gains exactly one additional export subpath:

```ts
import {
	CleanupStack,
	eventually,
	waitForOutputLine,
	createTestDatabase,
	runQuestpieCli,
	createIsolatedApplicationDatabase,
} from "questpie/testing";
```

`questpie/testing` exports:

- `CleanupStack` — defers teardown callbacks and disposes them in reverse
  order, aggregating failures instead of hiding one behind another.
- `eventually(probe, { accept, timeoutMilliseconds?, intervalMilliseconds?, description? })`
  — polls until `accept` is satisfied or the timeout elapses. This is the
  seam for deterministically awaiting a Durable Run's terminal state or a
  worker drain without a fixed sleep.
- `waitForOutputLine(stream, { accept, timeoutMilliseconds?, description? })`
  — waits for a matching line on a child process's stdout, e.g. a hosted
  application's readiness line.
- `createTestDatabase({ adminConnectionUrl, namePrefix? })` — creates one
  empty PostgreSQL database on the named server and returns
  `{ connectionUrl, databaseName, dispose() }`. `dispose()` terminates other
  backends on the database and drops it; it is idempotent.
- `runQuestpieCli({ applicationRoot, arguments, connectionUrl, env? })` —
  resolves the installed `questpie` CLI binary from the consuming
  application's own `node_modules` (via `import.meta.resolve("questpie/package.json")`
  and that package's declared `bin`) and runs it with `DATABASE_URL` set to
  `connectionUrl`. It never reimplements migration or Seed application; it
  always shells out to the exact CLI the application already ships with.
- `createIsolatedApplicationDatabase({ adminConnectionUrl, applicationRoot, namePrefix?, seed? })`
  — composes the two: creates an isolated database, runs
  `questpie migration apply` against it, optionally runs `questpie seed apply`,
  and drops the database before rethrowing on any setup failure so a failed
  setup never leaks a database. Returns the same handle shape as
  `createTestDatabase`.

These three original testkit helpers and the two Postgres-isolation helpers
are the entire subpath. `questpie/testing` does not export a browser driver,
an MCP/OTLP wire client, a tracer host, a `principal` forging path, or any
proof-only machinery; those stay in the private `packages/testkit` and
`tests/support` because they encode this repository's own hostile,
multi-instance, and protocol-conformance proof scaffolding, which has no
stable external contract and must be free to change without a public
deprecation cycle.

## Isolation model and PostgreSQL version

Isolation is one PostgreSQL **database** per call to
`createTestDatabase`/`createIsolatedApplicationDatabase`, not a shared
database with per-test schemas. A fresh, empty, uniquely named database
(`<namePrefix>_<uuid>`) needs no knowledge of an application's configured
`postgres` schema name, cannot collide with another test file or another
agent's session running in parallel against the same PostgreSQL server, and
drops cleanly as one physical object. The caller supplies
`adminConnectionUrl`; it must name a role permitted `CREATE DATABASE` /
`DROP DATABASE` on that server. This is the same operational assumption
QUESTPIE's own PostgreSQL-backed tests already make (a superuser-equivalent
local connection), just exposed instead of hand-rolled per test file.

`questpie/testing` makes no PostgreSQL-version-specific assumption beyond what
the framework already requires: PostgreSQL 16 or 17, matching
`tests/integration/postgres/helpers/postgres-major.ts` and this repository's
own PostgreSQL-backed suite.

## Trusted Principal: no new surface

Item 3 of the driving problem — obtaining a trusted Principal without forging
— needs no new export. `principal.user()`, `principal.service()`, and
`principal.anonymous()` are already public from the `questpie` root
(`packages/questpie/src/context.ts`); each call registers the returned value
in a module-private `WeakSet` that the credential resolver and Context
resolver both consult, so a test cannot fabricate a trusted Principal by
constructing an object literal. `questpie/testing` intentionally does not
re-export or wrap `principal`; doing so would create a second, potentially
drifting, entry point to the same trust boundary.

## Stability statement

`questpie/testing` is Product surface under ADR-0027, not a Kernel change: it
adds no transaction, dispatch, Policy, credential, or durable-identity
semantics, and changes no existing export's behavior. It follows the same
stability contract as `questpie/react-query` — an optional, independently
versioned subpath of the one `questpie` release train. `CleanupStack`,
`eventually`, and `waitForOutputLine` keep their exact existing signatures
(moved, not rewritten) so the private `@questpie/testkit` workspace can
re-export them from `questpie/testing` instead of duplicating their
implementation.

## What stays private, and why

- **`@questpie/testkit` stays private.** After this change it becomes a thin
  re-export of `questpie/testing`'s three lifecycle helpers; the package
  itself is retained (not deleted) because deleting it would force an
  unrelated import-path migration across every `tests/integration/postgres/*`
  file for no external benefit — internal tests already import it by relative
  path, not as a published dependency.
- **Tracer hosts, Firefox journeys, MCP/OTLP wire clients, and hostile
  multi-instance harnesses (`tests/support/*`) stay private.** They encode
  proof obligations specific to this repository's own Kernel/Product
  acceptance process (ADR-0027's runnable tracer, DELIVERY-FLOW's hostile and
  multi-instance evidence). They have no stable contract an external
  application should compile against, and their shape is expected to keep
  changing as this repository's own proof needs change.
- **Generated App Contract execution (`app.execution`, `app.fetch`,
  `app.durable`) stays exactly where it already is: emitted per application
  by the private compiler into that application's own
  `.questpie/generated/app.ts`.** It was never testkit-owned and needs no new
  export; `questpie/testing` only supplies the database isolation and
  lifecycle bookkeeping around it.

## Release contract

`scripts/package-contract.ts` is updated to require the packed `questpie`
tarball to contain `dist/testing/index.d.ts` and `dist/testing/index.js`, and
its exact-exports check now expects
`[".", "./internal/client-projection", "./internal/observability", "./react-query", "./testing"]`.
`scripts/release.ts`'s declaration inventory and consumer-install proof derive
generically from `package.json#exports`, so they pick up `./testing` without a
hardcoded change; no new hardcoded proof was added there for this ADR.
`questpie-opentelemetry`'s existing `dist/testing` rejection
(`scripts/package-contract.ts`) is unaffected — it continues to assert that
package never ships a test harness of its own.

## Alternatives rejected

- **Flip `@questpie/testkit` to a third public package.** Rejected: it would
  reopen ADR-0042's Accepted "exactly two public npm packages" cardinality for
  a handful of generic helpers, and would also make private proof machinery
  (tracer hosts, MCP wire client, Firefox journeys) either public alongside
  the useful parts or require a second private/public split inside the same
  package — strictly worse than one curated subpath on an already-public
  package.
- **Ship a testkit-owned Postgres schema-isolation helper that reads an
  application's `schema-projection.json`.** Rejected: it would couple the
  public surface to a private generated-artifact shape and produce a false
  sense of per-test isolation when two test files reuse one shared database —
  concurrent DDL/DML from unrelated fixtures can still interleave. One
  database per isolation unit removes that class of interference entirely.
- **Have `questpie/testing` open its own `pg` connection to run migrations
  in-process instead of shelling out to the CLI.** Rejected: the CLI is the
  one place migration/Seed application logic is owned
  (`questpie migration apply` / `questpie seed apply`); reimplementing that
  logic in the testing helper would create a second, potentially drifting,
  migration runner.
- **Re-export `principal` from `questpie/testing`.** Rejected: the trust
  boundary already lives at the `questpie` root; a second entry point adds
  nothing and risks import-order confusion about which one is authoritative.

## Acceptance

This is a Proposed decision. It authorizes no push, tag, publish, or deploy.
Before acceptance, executable proof must show: an external-consumer-style test
that imports only `questpie` and `questpie/testing` public specifiers,
compiles a fixture application, creates an isolated database with
`createIsolatedApplicationDatabase`, obtains a trusted Principal via
`principal.user()`, calls a generated Query/Mutation/Action in-process and
over HTTP, drains a Job with the generated Durable worker using `eventually`,
and disposes the isolated database; `bun run package:check` passing with the
new subpath; and `bun run scripts/release.ts --dry-run` passing (or its
result honestly recorded as not run, with reason). It does not, by itself,
authorize deleting or further shrinking `packages/testkit`.
