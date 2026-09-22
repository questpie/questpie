# ADR-0045: Freeze public testing surface

- Status: Accepted (owner, 2026-09-22)
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
	createIsolatedApplicationDatabase,
	createMigratedTemplateDatabase,
	createTestDatabaseFromTemplate,
	reapTestDatabases,
	runQuestpieCli,
} from "questpie/testing";
```

`questpie/testing` exports:

- `CleanupStack` — defers teardown callbacks and disposes them in reverse
  order, aggregating failures instead of hiding one behind another. Prefer it
  over a bare `try`/`finally` around a `dispose()` call: a `finally` block
  that itself throws replaces an exception already in flight from `try`,
  while `CleanupStack.dispose()` aggregates every failure into one
  `AggregateError` instead of silently dropping one.
- `eventually(probe, { accept, timeoutMilliseconds?, intervalMilliseconds?, description? })`
  — polls until `accept` is satisfied or the timeout elapses. This is the
  seam for deterministically awaiting a **Job**'s Durable Run terminal state
  or worker drain without a fixed sleep. It does **not** cover **Reactions**;
  see "Reaction draining is not provided" below.
- `waitForOutputLine(stream, { accept, timeoutMilliseconds?, description? })`
  — waits for a matching line on a child process's stdout, e.g. a hosted
  application's readiness line.
- `createTestDatabase({ adminConnectionUrl, namePrefix?, databaseCollation?, databaseCType? })`
  — creates one empty PostgreSQL database on the named server, created with
  `LC_COLLATE`/`LC_CTYPE` set to `databaseCollation`/`databaseCType` (default
  `"C.UTF-8"` for both), and returns `{ connectionUrl, databaseName, dispose() }`.
  `dispose()` drops the database with `DROP DATABASE ... WITH (FORCE)`
  (PostgreSQL 13+) and only marks itself done once the drop actually
  succeeds, so a failed `dispose()` can be retried. `namePrefix` (default
  `"questpie_test"`) must match `/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/`; the
  generated name is `<namePrefix>_<creation time, base36>_<16 lowercase hex>`
  and is rejected before any connection is opened if it would exceed
  PostgreSQL's 63-byte identifier limit (PostgreSQL silently truncates a
  too-long identifier instead of rejecting it, which would otherwise create a
  database under a different name than the handle tracks).
- `createIsolatedApplicationDatabase({ adminConnectionUrl, applicationRoot, namePrefix?, seed? })`
  — reads the application's own `questpie.json#postgres.databaseCollation`/`databaseCType`,
  creates an isolated database matching them, runs `questpie migration apply`
  against it, optionally runs `questpie seed apply`, and drops the database
  before rethrowing on any setup failure so a failed setup never leaks a
  database. Returns the same handle shape as `createTestDatabase`.
- `createMigratedTemplateDatabase({ adminConnectionUrl, applicationRoot, namePrefix?, seed? })`
  / `createTestDatabaseFromTemplate({ adminConnectionUrl, template, namePrefix? })`
  — the "migrate once per run, clone per file" seam: the former migrates
  (and optionally seeds) one database, then marks it a PostgreSQL template
  (`ALTER DATABASE ... WITH ALLOW_CONNECTIONS false`, then `WITH IS_TEMPLATE true`);
  the latter clones it with `CREATE DATABASE ... TEMPLATE <name>`, a
  PostgreSQL file-copy that skips migration/Seed replay entirely. See "Cost
  of one full migration replay per test file" below.
- `reapTestDatabases({ adminConnectionUrl, namePrefix, olderThanMinutes })` —
  recovers databases a `namePrefix`-based helper above created and left
  behind (a SIGINT, OOM kill, or CI timeout between `create*` and `dispose()`
  cannot run the disposer). It matches only databases whose name parses back
  to the exact `namePrefix_<time>_<random>` shape and whose embedded creation
  time is older than `olderThanMinutes`; PostgreSQL stores no database
  creation timestamp itself, which is why the timestamp is embedded in the
  name. Returns `{ dropped, failed }`; never throws for an individual failed
  drop.
- `runQuestpieCli({ applicationRoot, arguments, connectionUrl?, env?, timeoutMilliseconds? })`
  — resolves the installed `questpie` CLI binary from the consuming
  application's own `node_modules` (via `import.meta.resolve("questpie/package.json")`,
  which requires the new `"./package.json"` export below, and that package's
  declared `bin`) and runs it non-blocking, killing it if it runs past
  `timeoutMilliseconds` (default 60 000 ms). `connectionUrl` is optional —
  `DATABASE_URL` is only set when given, so CLI subcommands that touch no
  PostgreSQL (`build`, `check`) need no placeholder connection string. Its
  child environment is `PATH`/`HOME`/`TMPDIR`/`TEMP`/`TMP` inherited from the
  caller's process plus `env` plus `DATABASE_URL` — never the caller's full
  environment, so an unrelated credential in the caller's process cannot leak
  into the spawned CLI's environment. Any `postgres://`/`postgresql://`
  connection-string credential appearing in the child's combined
  stdout/stderr is redacted (`user:***@host`) before it can reach a thrown
  error. It never reimplements build, migration, or Seed application; it
  always shells out to the exact CLI the application already ships with.

These are the entire subpath. `questpie/testing` does not export a browser
driver, an MCP/OTLP wire client, a tracer host, a `principal` forging path, or
any proof-only machinery; those stay in the private `packages/testkit` and
`tests/support` because they encode this repository's own hostile,
multi-instance, and protocol-conformance proof scaffolding, which has no
stable external contract and must be free to change without a public
deprecation cycle. `questpie` also gains a `"./package.json": "./package.json"`
export: Node's `import.meta.resolve` rejects a path into a package that is not
declared in that package's own `exports` map (`ERR_PACKAGE_PATH_NOT_EXPORTED`);
Bun is lenient about this, but `runQuestpieCli` must work under Node too.

## Isolation model and PostgreSQL version

Isolation is one PostgreSQL **database** per call to
`createTestDatabase`/`createIsolatedApplicationDatabase`, not a shared
database with per-test schemas. A fresh, empty, uniquely named database
(`<namePrefix>_<creation time, base36>_<16 lowercase hex>`) needs no
knowledge of an application's configured `postgres` schema name, cannot
collide with another test file or another agent's session running in
parallel against the same PostgreSQL server, and drops cleanly as one
physical object. The embedded creation time exists solely so
`reapTestDatabases` can find and drop leaked databases later without
PostgreSQL storing a database creation timestamp anywhere itself. The caller
supplies `adminConnectionUrl`; it must name a role permitted `CREATE DATABASE`
/ `DROP DATABASE` on that server. This is the same operational assumption
QUESTPIE's own PostgreSQL-backed tests already make (a superuser-equivalent
local connection), just exposed instead of hand-rolled per test file.

`questpie/testing` makes no PostgreSQL-version-specific assumption beyond what
the framework already requires: PostgreSQL 16 or 17, matching
`tests/integration/postgres/helpers/postgres-major.ts` and this repository's
own PostgreSQL-backed suite. `dispose()`'s `DROP DATABASE ... WITH (FORCE)`
needs PostgreSQL 13+, comfortably inside that range.

## Reaction draining is not provided

`eventually` plus a compiled application's own generated
`app.durable.worker().poll()` is a deterministic seam for **Jobs**: accept a
Job, poll the worker, and use `eventually` to wait for its Durable Run to
reach a terminal outcome — exactly what
`tests/support/public-testing-cases/collaboration-consumer.case.ts` does in
the acceptance evidence below. `app.durable` is part of the generated App
Contract (public per compiled application, not a `questpie/testing` export)
and existed before this ADR.

**Reactions** (side effects QUESTPIE's committed-fact dispatch triggers, not
explicitly accepted like a Job) have no equivalent public deterministic seam
today, in this module or anywhere else in the public surface. An application
that needs to wait for a Reaction to finish must poll its own observable
effect — a row it expects the Reaction to write, a Query result it expects to
change, a test-only webhook/notification receiver it controls — with
`eventually`. This is an explicit, named gap, not an oversight: closing it
would require deciding a public Reaction-observation contract, which is
outside this ADR's scope and is not proposed here.

## Cost of one full migration replay per test file

Without `createMigratedTemplateDatabase`/`createTestDatabaseFromTemplate`, an
application with N DB-backed test files pays one cold `bun` CLI process and
one full committed-migration (plus Seed) replay per file:
`createIsolatedApplicationDatabase` alone spawns two `bun` cold starts
(`migration apply`, `seed apply`) and re-runs every committed migration from
scratch. For Autopilot's stated 144 scenario tests, at a conservative
150–250 ms per Bun cold start and a migration/Seed replay on the order of a
few seconds once a schema has non-trivial history, that is roughly
10–15 minutes of pure setup time across the suite, run serially — the
motivating reason this ADR implements the template option rather than
deferring it: it was judged small enough (two new exports, each composing
existing pieces, no new protocol) to build now rather than carry that cost or
defer the seam to a later ADR.

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
versioned subpath of the one `questpie` release train, **with one difference**:
unlike `questpie/react-query`, `questpie/testing` is runtime-neutral, not
Bun-only. It uses `node:child_process` and `setTimeout`, not `Bun.spawnSync`/
`Bun.sleep`; its only Bun-specific surface is `crypto.randomUUID()` (a
standard Web Crypto API, not Bun-only) and `ReadableStream<Uint8Array>` in
`waitForOutputLine` (standard Web Streams, present in Node 18+ too).
`questpie/react-query`'s Bun requirement is not extended by this ADR.
`CleanupStack`, `eventually`, and `waitForOutputLine` keep their exact
existing signatures (moved, not rewritten — `eventually`'s internal
`Bun.sleep` call was replaced with a `setTimeout`-based `delay`, with no
observable behavior change) so the private `@questpie/testkit` workspace can
re-export them from `questpie/testing`'s source instead of duplicating their
implementation.

## What stays private, and why

- **`@questpie/testkit` stays private.** After this change it becomes a thin
  re-export of `questpie/testing`'s three lifecycle helpers, imported by
  relative path to `packages/questpie/src/testing/index.ts` (source, not the
  built `dist/` the public subpath resolves to) so internal consumers of
  `@questpie/testkit` never require `packages/questpie/dist` — a gitignored,
  build-step-only artifact — to exist first. The package itself is retained
  (not deleted) because deleting it would force an unrelated import-path
  migration across every `tests/integration/postgres/*` file for no external
  benefit — internal tests already import it by relative path, not as a
  published dependency.
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
- **`packages/questpie/src/testing/internal.ts` (identifier quoting, name
  generation/parsing, credential redaction, CLI environment building) is not
  reachable through any published export.** `package.json#exports` maps
  `./testing` to `./testing/index.js` only; `internal.ts` exists purely so
  this repository's own unit tests
  (`tests/unit/questpie-testing-database-naming.test.ts`) can exercise these
  pure functions directly instead of only indirectly through a real
  PostgreSQL connection.

## Release contract

`scripts/package-contract.ts` is updated to require the packed `questpie`
tarball to contain `dist/testing/index.d.ts` and `dist/testing/index.js`, and
its exact-exports check now expects
`[".", "./internal/client-projection", "./internal/observability", "./package.json", "./react-query", "./testing"]`.
`scripts/release.ts`'s declaration inventory derives generically from
`package.json#exports`, so it picks up `./testing` and `./package.json`
without a hardcoded change. Its consumer-install proofs, which _are_
hardcoded per subpath, are updated explicitly to `import("questpie/testing")`
and assert `createIsolatedApplicationDatabase`/`createTestDatabase`/
`runQuestpieCli`/`eventually` are functions in the core-package, react-query,
and combined-consumer checks — a broken `./testing` subpath now fails the
dry-run the same way a broken `./react-query` subpath would.
`questpie-opentelemetry`'s existing `dist/testing` rejection
(`scripts/package-contract.ts`) is unaffected — it continues to assert that
package never ships a test harness of its own.

The pinned `quality/release/package-artifacts.json` manifest (SHA-256 archive
and declaration digests bound at the last beta.2 candidate, per ADR-0042's
release contract) predates this ADR's package-surface change and therefore
does not match a tarball packed after it; `bun run scripts/release.ts --dry-run`
fails against it until that manifest is deliberately regenerated as part of
assembling a new release candidate. Regenerating it is a release-authority
action (it re-pins the exact bytes a formal acceptance review would certify)
outside this ADR's and this ticket's scope; see the delivery record for the
exact failure observed.

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
Before acceptance, executable proof must show:

- an external-consumer-style test that imports only `questpie` and
  `questpie/testing` public specifiers _resolved through an actually
  installed copy_ (both the dev-symlink path and a real `bun pm pack`
  tarball under `QUESTPIE_PACKED_TARBALL` — not a repo-relative import that
  only happens to work in one of the two), compiles a fixture application
  through the CLI binary declared in that installed copy's own
  `package.json#bin` (not a repo-relative `dist/cli.js` path), creates an
  isolated database with `createIsolatedApplicationDatabase`, obtains a
  trusted Principal via `principal.user()`, calls a generated Query/Mutation
  in-process and a Route over HTTP, drains a Job with the generated Durable
  worker using `eventually`, and disposes the isolated database;
- unit coverage for `namePrefix`/generated-name length and character
  validation, credential redaction, and the CLI environment allowlist
  (pure-function tests against `./internal`, not requiring PostgreSQL);
- integration coverage for FORCE-drop teardown, `dispose()`'s
  success-only-then-latched contract (including a real forced-failure retry
  when the PostgreSQL server allows prepared transactions), the database
  reaper (drops only its own matching, aged databases), the migrated-template
  clone path, and `runQuestpieCli`'s timeout;
- `bun run package:check` passing with the new subpath and the new
  `"./package.json"` export; and
- `bun run scripts/release.ts --dry-run` either passing or failing only
  because the pinned `quality/release/package-artifacts.json` manifest
  predates this change (see Release contract) — recorded exactly, not
  claimed green.

It does not, by itself, authorize deleting or further shrinking
`packages/testkit`, and it does not propose a public Reaction-observation
seam (see "Reaction draining is not provided").
