# QUESTPIE v3, QUESTPIE v4, and Supabase comparison

Status: research note
Research date: 2026-08-10
Scope: the implemented QUESTPIE v3 repository, the current QUESTPIE v4 ADR
set, and the current Supabase product. This note does not change an ADR.

## Research question

QUESTPIE v4 is moving toward one standalone PostgreSQL application runtime.
Supabase already provides PostgreSQL, generated data APIs, Auth, Realtime,
Storage, Queues, Cron, Edge Functions, Studio, self-hosting, and a managed
platform.

This note asks five questions.

1. What does QUESTPIE v3 already prove?
2. What does Supabase already solve?
3. What distinct product can QUESTPIE v4 supply?
4. Which accepted v4 ADRs still support that product?
5. With no external users, is a v4 rewrite an honest evolution or an
   unjustified restart?

## Executive finding

The standalone PostgreSQL direction is coherent. It is also narrower than the
current v4 ADR set.

Supabase is a PostgreSQL platform. Its physical database schema is the center.
PostgREST and `pg_graphql` reflect that schema into APIs. The CLI introspects
the database to generate TypeScript row, insert, and update types. PostgreSQL
grants and Row-Level Security protect the reflected data surface. Separate
services provide Auth, Realtime, Storage, and Edge Functions.
[Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture),
[Data REST API](https://supabase.com/docs/guides/api),
[generated TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types)

QUESTPIE v4 has no reason to reproduce this product list. A weaker copy would
add a TypeScript declaration layer while keeping the same database-first CRUD
center.

QUESTPIE has a reason to exist if its center is different:

> QUESTPIE compiles one owned application contract into PostgreSQL schema,
> policy-aware Operations, transaction boundaries, durable reactions,
> observed-read Live Queries, and a concrete generated client.

The database remains normal PostgreSQL. Supabase, Neon, RDS, or another
compatible provider can host it. The QUESTPIE Runtime owns application
semantics above the database. It does not hide PostgreSQL and it does not try
to become a generic infrastructure platform.

This product boundary is a direct evolution of v3 learning:

- v3 already implemented PostgreSQL-native transactions, a durable change
  outbox, queue dispatch, realtime recovery, authorization fences, generated
  clients, and concrete application examples;
- v3 also proved that runtime Module merging, codegen plugin registries,
  fluent builder state, Admin extension systems, host adapters, and leaked ORM
  types create a large and fragile architecture;
- the repository has no external users, so v4 does not need to preserve these
  mechanisms as compatibility contracts;
- the repository still contains valuable semantic tests and failure research.
  A rewrite must use them as an executable oracle.

The rewrite is justified only as a deletion-driven vertical slice. Rewriting
all capabilities described by the current 75 ADRs before the core slice works
would repeat the v3 scope mistake.

## Comparison summary

| Area             | QUESTPIE v3                                                                        | Proposed QUESTPIE v4                                              | Supabase                                                         | Main conclusion                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Product center   | Embedded TypeScript framework plus CMS-like Admin and adapter matrix               | Standalone-default PostgreSQL application compiler and runtime    | Managed or self-hosted PostgreSQL platform                       | QUESTPIE must own application semantics, not infrastructure breadth.                      |
| Schema authority | QUESTPIE Field and Collection builders coupled to executable Drizzle schema types  | QUESTPIE App Contract lowers to PostgreSQL                        | Physical PostgreSQL schema                                       | Keep QUESTPIE semantic definitions, but keep PostgreSQL visible.                          |
| API              | Generated CRUD routes, custom Routes, and typed client                             | Query, Mutation, Action, Route, semantic data client              | Reflected REST/GraphQL plus Edge Functions                       | Generic CRUD is not enough. Semantic Operations are the differentiator.                   |
| Type system      | Recursive builder and module inference with Drizzle leakage                        | Concrete generated App Contract with small leaf Definition types  | Database-introspected row/insert/update types                    | Generate concrete application types once. Do not expose ORM types.                        |
| Authorization    | TypeScript access callbacks and field access in CRUD                               | Compiled Policies and explicit Principal/Authority                | PostgreSQL grants and RLS                                        | QUESTPIE must define its relation to RLS and service-role bypass.                         |
| Transactions     | Framework CRUD transactions, realtime outbox, queue dispatch, `afterCommit`        | Mutation owns transaction, changes, and durable dispatch          | PostgreSQL transactions; products are separate surfaces          | Preserve v3 transaction research and make the boundary simpler.                           |
| Realtime         | Durable change log, live-query refresh, channels, replay, broker/provider variants | Observed-read Query recomputation from a PostgreSQL change ledger | Row changes, Broadcast, and Presence                             | Live Query result maintenance is a real QUESTPIE distinction.                             |
| Auth             | Better Auth integrated into core and starter-owned records                         | Principal in core; Auth integration remains optional              | Separate GoTrue-derived service and `auth` schema                | Do not make one Auth library part of the compiler ABI.                                    |
| Storage          | Files SDK integration, upload fields, metadata Collections, cleanup                | Deferred File records plus external blob service                  | Full Storage service with RLS metadata and S3 interface          | Do not rebuild Supabase Storage in the first v4 slice.                                    |
| Durable work     | Queue adapters, transactional dispatch, Jobs, separate Workflows package           | PostgreSQL dispatch and Jobs first; Workflows later               | `pgmq` Queues and `pg_cron`; no current durable workflow product | Typed transactional application dispatch can differ; infrastructure queue breadth cannot. |
| Packages         | Runtime Modules plus codegen plugins and implicit merge rules                      | Explicit owned Definitions and static composition                 | PostgreSQL extensions and independently deployed services        | Keep ownership and explicit activation. Remove generic runtime plugin merging.            |
| Admin            | Extensible CMS Admin and private registries                                        | Optional application-contract Studio                              | Infrastructure and database Studio                               | QUESTPIE Studio must inspect app semantics. It must not clone a database dashboard.       |
| Cloud            | Several adapters and an early cloud CLI                                            | Open runtime plus possible managed control plane                  | Mature managed platform plus self-hosted single-project stack    | Cloud is plausible after the runtime contract is proven.                                  |

## Part I: observed QUESTPIE v3 facts

This part reports repository evidence. It does not claim that file size or a
type cast is automatically a design defect.

### 1. V3 already contains a broad backend product

The `questpie` package publishes more than 40 explicit subpaths. They include
Auth, CRUD, Channels, Realtime, Queue, Search, Storage, KV, Mailer, Executor,
CRDT, migrations, HTTP, client APIs, codegen, and provider adapters. The
monorepo has 17 packages. The main source trees contain approximately 145,000
TypeScript lines in `packages/questpie/src` and 106,000 TypeScript or TSX lines
in `packages/admin/src`.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/package.json`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/admin/package.json`.

These counts show product breadth. They do not measure quality. They do show
that v4 cannot safely port the repository layer by layer and simplify it later.
The port unit must be one required guarantee.

### 2. Module composition is implicit runtime merging

`createApp()` flattens Module dependencies depth-first and left-to-right. A
module name is a deduplication key. Known Module properties use a private
`MERGE_FNS` table. Unknown extension keys use shape-based merging:

- array plus array concatenates;
- object plus object spreads;
- another value uses the incoming value.

The framework has special merge branches for `auth` and `admin` config. Other
unknown config keys use last-wins replacement. Application entities are placed
in an implicit `__user` Module at the end of the list. They therefore override
same-key Module entities. Core is automatically prepended.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/config/create-app.ts`.

This model has no explicit owner for a merged Collection member. Import and
Module topology help decide the result. A user who sees only the final
Collection source cannot see every inherited field, policy, hook, or Admin
extension.

The v3 changelog records concrete consequences:

- same-key Module Collections once collapsed their types to `never`;
- application Collections were changed to override Module Collections;
- `.merge()` once dropped extension keys such as Admin actions and forms;
- a deeply merged Collection required additional generated type-fold logic.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/CHANGELOG.md`.

These events support v4 ADR 0002, ADR 0007, and ADR 0013: composition should be
static, ownership should be explicit, and the compiler should emit the final
contract.

### 3. The codegen plugin system became a second framework

The v3 code generator exposes declarations for categories, discovery patterns,
registry extraction, module registries, singleton factories, builder
factories, builder extensions, callback proxies, environment targets, and
cross-target validators.

`CategoryDeclaration` contains both discovery and emission policy. Discovery
can use a two-pass regular-expression scan for factory exports. Admin adds
categories, generated factories, Field and Collection builder methods,
callback parameters, type registries, server-to-client projection validation,
and scaffolds through this interface.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/cli/codegen/types.ts`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/cli/codegen/discover.ts`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/admin/src/server/plugin.ts`.

The useful lesson is not that code generation failed. Code generation is
necessary for a strong concrete client. The failed boundary is that arbitrary
product extensions could change discovery, builder grammar, type registries,
and client projections through one plugin object.

### 4. V3 type safety transfers Drizzle complexity into QUESTPIE

Public Collection, Global, Field, CRUD, config, and builder types import
Drizzle symbols such as `BuildColumns`, `GetColumnData`, `PgTableWithColumns`,
`PgColumn`, `PgJsonbBuilder`, and `SQL`. The root package also re-exports
Drizzle and PostgreSQL schema packages.

Source examples:

- `/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/collection/builder/types.ts`;
- `/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/global/builder/types.ts`;
- `/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/fields/field-class-types.ts`;
- `/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/exports/drizzle.ts`;
- `/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/exports/drizzle-pg-core.ts`.

The committed TypeScript performance budget records these instantiation counts
with TypeScript 5.9.2:

| Target              |     Types | Instantiations |
| ------------------- | --------: | -------------: |
| `packages/questpie` |   504,920 |      1,831,510 |
| Toy Factory         |   781,255 |      2,826,959 |
| TanStack Barbershop | 1,027,947 |      3,618,124 |
| City Portal         |   863,138 |      2,980,539 |

The budget script states that variance annotations on CRUD and Field hot-path
generics reduced example application instantiations by approximately 40%.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/scripts/type-budget.json`,
`/Users/drepkovsky/questpie/repos/questpie-cms/scripts/type-budget.ts`.

The v3 changelog also records a published declaration-bundling defect that
renamed a builder type parameter. It broke declaration merging and reduced
consumer Collections to `any`. The project added a built-declaration consumer
gate after this failure.

This evidence supports generated concrete types. It does not support another
large generic framework written with QUESTPIE-owned names.

### 5. V3 learned how generated layers can remain acyclic

The current generator emits a four-level, downward-only type graph:

- names;
- entity maps;
- App Context;
- runtime index.

CI parses generated imports and rejects upward edges and cycles. The generator
also enumerates Services directly to avoid reconstructing an App Context cycle
through Module type folds.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/scripts/codegen-layer-graph.md`,
`/Users/drepkovsky/questpie/repos/questpie-cms/scripts/check-codegen-layers.ts`.

This is reusable design knowledge. V4 should preserve the one-way generated
graph and remove the ambient registry mechanisms that made the repair
necessary.

### 6. V3 contains serious transaction and realtime research

V3 distinguishes a durable outbox from a lossy wake. A business transaction
appends its change record before commit. The broker sends only a notice after
commit. Reconciliation reads durable database state when a notice is missing.

The realtime design also defines:

- a notice-only `ChangeBroker` and a separate client transport;
- access-equivalence keys for safe snapshot sharing;
- latest-wins coalescing for Live Query snapshots;
- ordered, non-coalescable Channel events;
- replay gaps and slow-consumer behavior;
- authorization-generation fences;
- recovery after broker reconnect;
- PostgreSQL transaction identifiers and visibility watermarks for drain
  ordering.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/modules/core/integrated/realtime/TRANSPORT.md`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/modules/core/integrated/realtime/AUTHORITY.md`.

V3 Queue dispatch separately persists intent in
`questpie_queue_dispatch`. It has stable idempotency identities, relay leases,
execution claims, retry limits, and terminal states. The table exists because
an external Queue adapter cannot join the PostgreSQL transaction.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/modules/core/integrated/queue/dispatch-table.ts`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/questpie/src/server/modules/core/integrated/queue/dispatch-store.ts`.

These semantics are stronger assets than the v3 public class or adapter names.
V4 should preserve the invariants and rewrite the mechanism around one
PostgreSQL Runtime.

### 7. V3 Admin is coupled through codegen and builder extension

The Admin plugin adds backend Field Kinds, server categories, module
registries, Collection extensions, Global extensions, Field extensions,
callback proxies, singleton factories, scaffolds, and a separate client
projection. Admin metadata also enters backend Field definitions.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/admin/src/server/plugin.ts`,
`/Users/drepkovsky/questpie/repos/questpie-cms/packages/admin/src/augmentation.ts`.

The published Admin package is approximately 2.7 MB unpacked with 622 entries.
The main `questpie` package is approximately 4.0 MB unpacked with 782 entries.
These figures are the current repository's own package budgets.

Source:
`/Users/drepkovsky/questpie/repos/questpie-cms/scripts/size-budget.json`.

The reusable Admin assets are selected table, form, file, inspection,
localization, and diagnostic components. The Admin builder and extension
architecture should not define the v4 backend.

### 8. V3 has a valuable executable knowledge base

The repository currently contains approximately 351 QUESTPIE test files, 40
Admin test files, and 3,683 `describe` or `it` calls across those test trees.
It also has committed budgets for TypeScript instantiations, package size,
browser bundle size, `any` usage, code duplication, dead modules, published
types, package exports, security advisories, and generated-layer cycles.

These checks do not prove that the architecture is simple. They do provide a
large set of learned failure cases that a v4 rewrite should convert into
contract tests.

## Part II: observed Supabase facts

### 1. Supabase is a platform around normal PostgreSQL

Each Supabase project has one complete PostgreSQL database. Separate services
provide the API gateway, PostgREST, Auth, Realtime, Storage, Functions, and
database metadata. Applications can connect to PostgreSQL directly.
[Architecture](https://supabase.com/docs/guides/getting-started/architecture),
[database overview](https://supabase.com/docs/guides/database/overview)

This means Supabase does not need one TypeScript application compiler. The
database is the integration contract between services.

### 2. The Data API reflects physical database objects

PostgREST reflects exposed tables, views, foreign tables, relations, functions,
computed columns, roles, grants, and RLS into REST. An application can call it
directly from a browser or through another application server. Each request is
resolved to one SQL statement.
[Data REST API](https://supabase.com/docs/guides/api)

Exposure and authorization are separate:

1. an exposed schema makes objects visible to the Data API;
2. grants decide which PostgreSQL roles can reach each object;
3. RLS decides which rows a role can read or change.

Supabase can disable the Data API. It is also moving new projects toward
explicit object grants instead of automatic exposure of every new table.
[Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api),
[custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas),
[2026 exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

Supabase also offers `pg_graphql`, but it stopped enabling the extension by
default for new projects in 2026. GraphQL follows PostgreSQL privileges and
RLS.
[GraphQL security](https://supabase.com/docs/guides/graphql/security),
[2026 exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)

### 3. Supabase TypeScript generation is database-first

The dashboard and CLI introspect a hosted, local, or self-hosted PostgreSQL
database. They generate `Row`, `Insert`, and `Update` types for its schemas.
[Generating TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types)

This gives strong table and RPC typing. It does not provide one source-level
contract for TypeScript handlers, Services, durable reactions, package
ownership, Live Query dependency plans, or client exposure. This sentence is
an inference from the documented generation inputs and outputs.

### 4. Supabase authorization is PostgreSQL-native

Supabase maps anonymous and authenticated requests to PostgreSQL roles. Grants
control object access. RLS policies use PostgreSQL `USING` and `WITH CHECK`
expressions. `auth.uid()` and JWT claims connect authentication to data rules.
[Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

Tables created in the dashboard enable RLS by default. Tables created through
SQL require explicit RLS activation. A secret or service role bypasses RLS and
must stay on the server.
[Securing data](https://supabase.com/docs/guides/database/secure-data)

Supabase therefore has a stronger database-enforced boundary than an
application-only policy callback. QUESTPIE must state when it emits RLS, when it
enforces a compiled predicate in its own SQL, and when raw or privileged access
bypasses that policy.

### 5. Edge Functions are a separate HTTP compute product

Supabase Edge Functions are TypeScript functions in a Deno-compatible runtime.
They can implement HTTP methods, nested routing, webhooks, and integration
logic. Managed Supabase deploys them globally. They also run locally or on
compatible self-hosted infrastructure.
[Edge Functions](https://supabase.com/docs/guides/functions),
[HTTP methods](https://supabase.com/docs/guides/functions/http-methods)

Supabase recommends short-lived and idempotent Functions. It directs heavy or
long-running work to background workers. A Function commonly calls the Data
API or connects to PostgreSQL. It is not the transaction retry boundary for a
database mutation.

### 6. Supabase Realtime sends events, not Live Query results

Supabase Realtime provides Broadcast, Presence, and Postgres Changes over
WebSockets. Postgres Changes reads the WAL through logical replication.
[Realtime overview](https://supabase.com/docs/guides/realtime),
[Realtime architecture](https://supabase.com/docs/guides/realtime/architecture)

Supabase currently recommends trigger-based Broadcast for most scalable and
security-sensitive database notifications. Direct Postgres Changes has less
setup but scales less well.
[Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)

The official Realtime repository states that every message is not guaranteed
to arrive. Database Broadcast supports bounded replay for eligible private
database messages, but it is not a durable exactly-once event log.
[Supabase Realtime source](https://github.com/supabase/realtime),
[Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

Supabase does not execute an arbitrary application Query, record its complete
read set, and deliver one consistent recomputed result after related rows or
policy inputs change. This is a scoped inference from the documented Realtime
protocols.

This gap is the most important QUESTPIE opportunity.

### 7. Auth and Storage are independent services that share PostgreSQL

Supabase Auth is a GoTrue-derived API service. It issues and refreshes JWTs,
integrates external identity providers, and stores its state in a protected
`auth` schema. That schema is not exposed through the Data API. Applications
normally create a public profile table that references `auth.users`.
[Auth architecture](https://supabase.com/docs/guides/auth/architecture),
[user data](https://supabase.com/docs/guides/auth/managing-user-data)

Supabase Storage stores bucket and object metadata in the `storage` schema and
uses RLS for authorization. Object bytes live in an object provider. Mutations
must use the Storage API because changing the PostgreSQL metadata does not
change the object.
[Storage schema](https://supabase.com/docs/guides/storage/schema/design)

Its S3-compatible API supports server credentials that bypass RLS and
JWT-backed sessions that retain RLS enforcement.
[S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)

These products demonstrate useful seams. They do not imply that QUESTPIE must
build competing Auth and Storage services in its first release.

### 8. Queues and Cron are PostgreSQL modules

Supabase Queues uses the `pgmq` PostgreSQL extension. It is a pull-based durable
JSON message queue with visibility timeouts, archival, and optional controlled
Data API exposure. A message that is not acknowledged can become visible
again. `pop()` deletes when it reads and therefore has at-most-once failure
behavior.
[Queues](https://supabase.com/docs/guides/queues),
[`pgmq` semantics](https://supabase.com/docs/guides/queues/pgmq),
[Queues quickstart](https://supabase.com/docs/guides/queues/quickstart)

Supabase Cron is a dashboard and SQL layer over `pg_cron`. It can execute SQL,
database functions, or HTTP requests. Job definitions and run history remain
in PostgreSQL.
[Cron](https://supabase.com/docs/guides/cron)

The reviewed current product documentation exposes Queues and Cron. It does
not expose a current durable multi-step workflow product. A 2021 blog post
announced Workflows as future work and is not evidence of a shipped product.
[Workflows announcement](https://supabase.com/blog/supabase-workflows)

### 9. Extensions are database extensions, not application packages

Hosted Supabase preinstalls many PostgreSQL extensions, including `pg_cron`,
`pgmq`, `pg_net`, `pg_graphql`, PostGIS, vector, and foreign data wrappers.
Pure SQL extensions can be installed through SQL. Native extensions depend on
provider availability and supported versions.
[PostgreSQL extensions](https://supabase.com/docs/guides/database/extensions)

Database Webhooks are convenience triggers over the asynchronous `pg_net`
extension.
[Database Webhooks](https://supabase.com/docs/guides/database/webhooks)

Supabase extensions add database behavior. They do not solve static ownership
and augmentation between TypeScript application packages.

### 10. Studio is an infrastructure and data console

Supabase Studio manages tables, rows, SQL, policies, Auth users, Storage,
Functions, Queues, Cron, logs, and integrations. The Table Editor supports a
focused subset of PostgreSQL types. The SQL Editor preserves full database
access.
[Tables and data](https://supabase.com/docs/guides/database/tables),
[SQL Editor](https://supabase.com/features/sql-editor)

This validates a reduced QUESTPIE Studio, but it also defines a non-goal.
QUESTPIE should not rebuild a general PostgreSQL Table Editor or SQL console.
Its Studio should explain the Compiled App Contract, Origins, Policies,
Operations, subscriptions, and deployment compatibility.

QUESTPIE Studio also has a distinct operational role. The Runtime owns
application-level guarantees that a generic database console cannot explain.
Studio can show:

- the compiled schema and migration plan, migration checksum history, drift,
  and the Owner and Origin of each schema change;
- Seed runs, idempotency identities, dependencies, and failures;
- active and degraded Live Queries, their compiled dependencies, refresh
  causes, change-ledger cursor, lag, invalidation, recomputation, and reconnect
  state;
- Mutation and PostgreSQL transaction traces, including transaction identity,
  outbox entries, and idempotency keys;
- Transactional Dispatch state from commit to durable acceptance;
- Queue, Job, and later Workflow attempts, leases, retries, cancellation,
  dead-letter state, and execution history;
- declared operation errors, logs, traces, audit events, and causation links;
- Policy and Principal decisions for one operation execution.

The Runtime should emit one stable execution envelope with shared run,
transaction, dispatch, and causation identities. Studio, CLI, OpenTelemetry,
and a future Cloud control plane should consume this envelope. They should not
reconstruct separate operational truths from private databases or log text.

Supabase Studio can manage its database and infrastructure services. QUESTPIE
Studio can explain one compiled application and the guarantees of its Runtime.
These surfaces can complement each other when Supabase hosts the PostgreSQL
database.

### 11. Supabase has a clear open data-plane and managed-platform boundary

Self-hosted Supabase models one project. The operator owns provisioning,
patching, security, PostgreSQL operations, scale, high availability, backups,
recovery, monitoring, and uptime. Self-hosting is community-supported.

The managed platform adds organizations, projects, branching, managed backups
and PITR, advanced metrics, analytics and vector buckets, ETL, and a management
API.
[Self-hosting](https://supabase.com/docs/guides/self-hosting)

Supabase supports PostgreSQL dumps and documents migration from its platform to
self-hosting. The relational schema, data, roles, functions, triggers, and RLS
can move. Storage objects, Function source, service configuration, secrets,
identity providers, and live sessions need separate migration or recreation.
[Restore from the platform](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

“PostgreSQL portable” is therefore accurate for the data core. It is not an
automatic guarantee for the complete application envelope.

## Part III: the real product boundary

### 1. The weak QUESTPIE product is already Supabase

The following pitch is not sufficient:

> Define tables, get CRUD, Auth, file upload, realtime row events, jobs, and an
> Admin.

Supabase already offers this system with a mature hosted platform and a
self-hosted stack. It also keeps PostgreSQL directly accessible.

If QUESTPIE v4 uses this pitch, the rewrite is unjustified.

### 2. The strong QUESTPIE product is an application semantics layer

QUESTPIE can own contracts that Supabase does not try to own:

- stable Resource Identity that is independent of file layout;
- one Owner for each Resource;
- explicit, authorized cross-package Augmentation;
- one resolved Origin Map;
- semantic Query, Mutation, and Action definitions;
- a Mutation-owned PostgreSQL transaction and durable dispatch boundary;
- typed, compiled Policies that affect SQL, result types, Studio, and client
  exposure;
- Live Queries derived from the complete compiled read plan, including policy
  and tenancy reads;
- one concrete generated client that exposes application intent instead of
  only table CRUD;
- static collision and dependency diagnostics before runtime;
- manifest-aware deployment checks.

This is not a PostgreSQL replacement. It is a compiler and runtime for one
PostgreSQL application.

### 3. Supabase can host a QUESTPIE database

No Supabase-specific Data adapter is necessary for the core model. A QUESTPIE
Runtime can connect to a Supabase PostgreSQL database through a normal
PostgreSQL connection. A trigger-based QUESTPIE change ledger can preserve
external-writer capture without requiring a managed logical-replication
product.

This is an architectural hypothesis. It needs a deployment tracer against an
actual Supabase project. Provider constraints, pooler transaction modes,
extension versions, connection limits, and migration privileges must be tested.

The relationship can therefore be complementary:

- Supabase can provide managed PostgreSQL, Auth, or Storage;
- QUESTPIE can provide the application compiler, standalone runtime, semantic
  client, transactional dispatch, and Live Queries;
- QUESTPIE Cloud can later provide the integrated deployment experience.

The first QUESTPIE release should not require Supabase and should not duplicate
the whole Supabase stack.

## Part IV: v4 ADR audit after the Supabase comparison

### Decisions that remain strong

The following accepted decisions support the narrower product:

- ADR 0002: compile composition before runtime;
- ADR 0003: do not make v3 source compatibility a v4 constraint;
- ADR 0004 and ADR 0045: PostgreSQL is the data contract; do not publish a
  generic database provider interface;
- ADR 0007: separate identity, ownership, provenance, and augmentation;
- ADR 0010: distinguish Query, Mutation, Action, and HTTP Route;
- ADR 0013: generate one concrete App Contract;
- ADR 0014: use context-shaped handlers and a semantic client;
- ADR 0016: make Mutation the transaction and durable-dispatch boundary;
- ADR 0017: keep operation Schema separate from the Field protocol;
- ADR 0019: make Principal, Tenant, and Authority explicit;
- ADR 0020: use explicit names and typed Definition references;
- ADR 0022: keep system Fields visible and CRUD vocabulary small;
- ADR 0023: use Policy, Invariant, and Reaction instead of a general hook
  matrix;
- ADR 0029: use PostgreSQL constraints and durable Reactions;
- ADR 0032: push row Policy filters into SQL;
- ADR 0033 and ADR 0034: declared errors and one bounded query grammar;
- ADR 0043: Feature is source organization, not a framework primitive;
- ADR 0044 and ADR 0061: first-party and external behavior use the same
  downstream primitives after normalization;
- ADR 0046 to ADR 0048: separate compiler config, deterministic discovery, and
  one naming grammar;
- ADR 0054: do not publish a general compiler SPI;
- ADR 0065: keep Definition values as leaf-local typed references;
- ADR 0073: generate the App client contract and let the frontend host supply
  its endpoint.

These decisions describe the architectural spine. They do not require all
other accepted Capabilities to ship in v4.0.

### Decisions that need correction or clarification

#### Product and hosting

ADR 0001 still calls QUESTPIE a general Smart Backend Framework. ADR 0005 says
the full Runtime exposes a Fetch boundary for host frameworks. ADR 0008 includes
host adapters in the primary package surface.

The accepted product direction is now more specific:

- standalone-default PostgreSQL application runtime;
- one low-level Fetch interface for tests and embedding;
- no official host-adapter matrix or lifecycle-parity promise.

These ADRs should be superseded after the exact standalone contract is grilled.

#### Realtime observation

ADR 0015 says that the runtime records supported reads through App Context.
That is insufficient when a compiled Policy adds an `EXISTS`, tenancy predicate,
relation load, or pagination boundary that is not visible at the authored call
site.

The dependency set must come from the complete compiled query plan and its
executed reads. ADR 0030's safe broad fallback remains useful.

ADR 0019 says raw writes do not automatically provide resource change capture.
A PostgreSQL trigger-based change ledger can provide broader capture for
reactive Collections, including external writers and cascades. The raw-write
contract should be reopened after the change-ledger tracer.

#### Authorization and RLS

ADR 0032 defines typed Policy filters in generated SQL. It does not yet define
their relationship to PostgreSQL RLS and grants.

The Supabase comparison exposes four required rules:

1. public API exposure is not the same as row authorization;
2. database grants and RLS remain relevant when a browser or external tool can
   reach PostgreSQL-derived APIs;
3. a privileged runtime role can bypass RLS;
4. not every TypeScript Policy can safely compile to PostgreSQL RLS.

V4 must decide whether a Policy is:

- runtime SQL pushdown only;
- runtime SQL pushdown plus generated RLS when representable;
- or a database-native RLS Definition with a restricted expression language.

The product cannot promise database-enforced authorization until this decision
is explicit and tested.

### Decisions that should leave the first vertical slice

The following areas can remain research or later projections. They should not
block the data-operation-realtime tracer:

- ADR 0026: Effect kernel;
- ADR 0038: complete Files SDK and File Collection contract;
- ADR 0039: KV and Search as integrated Capabilities;
- ADR 0040: complete Jobs and durable Workflows;
- ADR 0041: Channels beyond the minimum Live Query transport;
- ADR 0042: OpenAPI and MCP projections;
- ADR 0049 to ADR 0053: general Capability activation and closure model;
- ADR 0062 to ADR 0064 and ADR 0067: full Requirement, Resolution, Composition
  Algebra, and Candidate Set Fingerprint system;
- ADR 0066 and ADR 0068: general environment slicing for packages;
- ADR 0070 to ADR 0072: the complete Config Resource and provider model;
- the full optional Admin Presentation system.

The ideas can remain in the workbench. Implementing them before one application
slice passes the deletion test would be speculative architecture.

This deferral is an implementation-order decision. It is not a statement that
operational Studio, Jobs, or durable Workflows are a poor architectural fit.
They fit the standalone Runtime well because the Runtime owns their lifecycle
and can expose truthful state. KISS means that the first tracer proves the
shared transaction, dispatch, and observation spine before the project builds
every operator view and orchestration feature on top of it.

### Auth ADRs conflict with the narrower core

ADR 0021, ADR 0025, ADR 0055 to ADR 0060, ADR 0069, ADR 0074, and ADR 0075 make
Better Auth schema and plugin construction a major compiler concern.

Supabase demonstrates a simpler separation:

- an Auth service resolves credentials and produces a trusted JWT identity;
- PostgreSQL and the application use claims for authorization;
- the Auth service owns its private schema;
- application profile data remains application-owned.

For the first v4 slice, core should own Principal, Tenant, Authority, and Policy.
Credential verification can be one explicit bootstrap integration. Better Auth
can remain a recommended package without defining Data Capability composition.

This change would remove a large compiler surface while retaining normal Auth
use.

## Part V: what to preserve and what to delete

### Preserve as contract and evidence

Preserve these v3 assets:

1. PostgreSQL transaction semantics and nested transaction research.
2. The durable realtime change ledger and lossy-wake distinction.
3. Queue dispatch intent, idempotency, leases, retry, and terminal-state tests.
4. Realtime snapshot coalescing, replay gaps, authorization fences, and
   reconnect tests.
5. Policy fail-closed behavior and field-output filtering tests.
6. CRUD behavior for relations, localization, constraints, optimistic
   concurrency, bulk atomicity, and migrations.
7. The concrete Barbershop and City Portal domain models as tracer fixtures.
8. The generated one-way layer DAG and built-declaration consumer test.
9. TypeScript instantiation, package-size, bundle-size, `any`, dead-module,
   clone, export, and audit gates.
10. Selected Admin table, form, file, localization, and diagnostic UI parts,
    but only after they consume the new public client.

Preserve the behavior. Do not preserve the class, builder, Module, plugin, or
adapter name by default.

### Delete from the new architecture

Do not port these v3 mechanisms:

1. runtime Module tree flattening and shape-based generic merging;
2. last-wins entity and config composition;
3. implicit `__user` override authority;
4. Module names as merge and deduplication keys;
5. codegen plugins that can add arbitrary categories and builder grammar;
6. regex-based factory discovery as the semantic compiler foundation;
7. global declaration registries and fallback `string` discriminants;
8. application-wide recursive builder-state inference;
9. public Drizzle tables, columns, SQL, and generic types;
10. a 5,100-line Collection CRUD generator as one orchestration unit;
11. Admin-specific backend builder methods and callback proxy registries;
12. Admin as an Operator App framework;
13. official Hono, Elysia, Next, and other host lifecycle adapter packages;
14. generic provider abstractions for core data correctness;
15. Better Auth plugin schema as a required compiler protocol;
16. first-release KV, generic Channels, full Workflows, CRDT, sandbox, and
    provider matrices.

This is not deletion of learned behavior. It is deletion of the mechanisms
that made the behavior difficult to see.

## Part VI: rewrite judgment with zero external users

### Why the rewrite is honest

The repository has no external users whose production source code constrains
v4. The team can optimize for the right architecture instead of preserving
accidental compatibility.

The rewrite also follows observed evidence:

- v3 Module composition required repeated fixes for override order and type
  collapse;
- v3 Admin extensions became codegen and backend architecture;
- v3 public types leaked Drizzle and required multi-million-instantiation
  budgets;
- v3 adapter breadth added several correctness matrices;
- v3's strongest behavior already converged on PostgreSQL transactions and
  durable ledgers.

Moving to a standalone PostgreSQL Runtime removes false portability and gives
one process ownership of operation dispatch, subscriptions, workers, health,
and shutdown. Static composition makes the final model inspectable. Concrete
generation makes type costs controllable.

This is an evidence-based architectural correction.

### When the rewrite becomes unjustified

The rewrite becomes another learning detour if the team:

- implements the complete 75-ADR architecture before one vertical slice;
- builds Auth, Storage, Search, KV, Workflows, OpenAPI, MCP, and Studio before
  the Query-Mutation-Live Query loop;
- writes a generic database or host adapter system without a second required
  implementation;
- creates a large QUESTPIE-owned generic type graph instead of generated
  concrete types;
- promises Convex-style consistency without proving PostgreSQL change capture,
  policy dependencies, pagination, and reconnect recovery;
- starts a proprietary control plane before the open Runtime is useful to
  independent applications;
- preserves v3 source compatibility when it conflicts with the new model.

Zero users remove migration risk. They do not remove validation risk.

## Part VII: minimum proof before broader implementation

Build one Barbershop tracer with these properties:

1. `appointments` has explicit identity and one Owner.
2. Another package adds one authorized augmentation.
3. A typed Policy uses Principal, Tenant, and a membership relation.
4. A Query returns a selected, sorted, paginated appointment view.
5. The generated client infers the exact input and result.
6. A subscriber watches that Query.
7. A Mutation changes one appointment and writes one durable Reaction intent in
   the same PostgreSQL transaction.
8. The change ledger captures the write before commit.
9. The compiled dependency plan includes Collection reads, policy reads,
   relation reads, and the pagination boundary.
10. The client receives one correct recomputed result after commit.
11. A process crash after commit and before wake does not lose the refresh or
    Reaction.
12. The same result and authorization apply through direct server execution,
    the generated network client, and the minimal Studio inspector.
13. Public declarations contain no Drizzle or Kysely types.
14. TypeScript instantiations are below a fixed fraction of the v3 Barbershop
    baseline.
15. The same application runs against local PostgreSQL and one managed
    Supabase PostgreSQL project without application-definition changes.

This tracer compares the proposed product against both v3 and Supabase.

If it passes, QUESTPIE has a distinct product. If it only generates table CRUD
and row-change subscriptions, Supabase already supplies the simpler system.

## Part VIII: managed hosting boundary

Supabase validates a useful business model:

- an open, self-hostable single-project data plane;
- a proprietary or managed multi-project control plane;
- paid operations, scale, backup, branch, observability, and team features.

QUESTPIE can use a similar boundary after the Runtime contract is stable.

The open product should include:

- compiler;
- standalone Runtime;
- PostgreSQL migrations and change ledger;
- worker and transactional dispatch;
- realtime protocol and generated client;
- CLI and local development;
- conformance tests;
- minimal application-contract Studio;
- complete export and self-host documentation.

A managed platform can add:

- organizations and projects;
- builds and artifact storage;
- managed PostgreSQL or provider orchestration;
- migration gates and rollback coordination;
- preview environments;
- secrets and runtime configuration;
- backups and PITR;
- runtime autoscaling and regional realtime gateways;
- logs, traces, subscription diagnostics, and usage history;
- team RBAC, SSO, audit, and billing;
- App Contract compatibility and Origin Map diffs;
- subscription-aware rolling deployment.

The cloud moat is not “host a Bun server and PostgreSQL.” Supabase, Railway,
Render, Fly.io, Neon, and others already cover infrastructure. The possible
moat is deployment that understands the Compiled App Contract and its semantic
compatibility.

This remains a business hypothesis. The framework tracer must pass before the
control plane becomes an implementation project.

## Final conclusion

QUESTPIE v4 makes sense as an outcome of v3, not despite v3.

V3 supplied two kinds of evidence:

- positive evidence that PostgreSQL transactions, durable dispatch, generated
  clients, policy-aware CRUD, and realtime recovery belong together;
- negative evidence that runtime Modules, open codegen plugins, fluent builder
  state, Admin coupling, public ORM types, and adapter matrices hide that value.

Supabase sharpens the boundary. QUESTPIE must not compete by assembling the
same infrastructure checklist. It must compile and run application semantics
that remain absent from a database platform.

The justified direction is:

> An open, standalone-default, PostgreSQL-native application compiler and
> runtime with semantic Operations, concrete type generation, compiled
> authorization, Mutation-owned durable dispatch, and observed-read Live
> Queries. A managed control plane can follow after this contract is proven.

The justified implementation plan is smaller than the current ADR inventory.
Keep the ADRs as research history. Supersede or defer the ones that no longer
serve the first tracer. Port guarantees from v3. Do not port its architecture.
