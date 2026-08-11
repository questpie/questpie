# Data engine and framework boundary research

Status: research note
Research date: 2026-08-10
Scope: PostgreSQL, Drizzle ORM, Kysely, and AdonisJS. This note separates
observed facts from architectural inferences. It does not change an accepted
decision.

## Research questions

This note investigates five questions.

1. Should QUESTPIE expose PostgreSQL, Drizzle, Kysely, or its own data engine as
   part of the public contract?
2. What do Drizzle and Kysely provide, and what would QUESTPIE still have to
   build?
3. Does QUESTPIE have a differentiated reason to exist beside AdonisJS?
4. Should QUESTPIE remain a full framework, become a host-mounted runtime, or
   become a set of packages for another framework?
5. Which seams can be chosen now without making an unsupported portability
   promise?

## Executive finding

The database and the TypeScript database library are two separate lock-in
axes.

- A **PostgreSQL product contract** allows QUESTPIE to promise PostgreSQL
  transaction, locking, notification, full-text, and change-stream semantics.
- A **Drizzle or Kysely public contract** makes application source depend on
  that library's types and API. It does not by itself define which database
  semantics QUESTPIE promises.
- A **private Drizzle or Kysely implementation** can be replaced without
  changing normal application definitions, provided that QUESTPIE owns its
  semantic Data IR and does not leak library types into those definitions.

The strongest current direction is therefore not “PostgreSQL or Drizzle.” It
is:

1. decide whether PostgreSQL semantics are a deliberate product feature;
2. keep the normal QUESTPIE Data API independent of Drizzle and Kysely;
3. make no public engine-portability promise in v4.0;
4. select the private query/schema engine with a proof, not by architecture
   taste;
5. provide any raw SQL or native-engine access as an explicitly non-portable
   escape hatch.

AdonisJS now covers most conventional backend-framework territory. It has an
HTTP framework, lifecycle and dependency injection, Lucid ORM, authentication,
authorization, validation, queues, server-sent events, and a generated typed
HTTP client. QUESTPIE is not differentiated if it only assembles a similar list
of facilities.

QUESTPIE remains differentiated only if its primary product is the compiled
semantic application contract: owned and augmentable definitions, concrete
generated types, policy-aware semantic operations, transaction-owned durable
reactions, query-derived realtime dependencies, and projections to client,
OpenAPI, MCP, and Admin/Studio. That product can run inside several HTTP hosts.
It does not need to replace those hosts.

## Part I: observed facts

### 1. PostgreSQL provides product-level semantics

PostgreSQL is more than a SQL wire protocol.

- PostgreSQL documents Read Committed, Repeatable Read, and Serializable
  semantics. Serializable execution can abort transactions with serialization
  failures, so the application needs a retry policy. Repeatable Read can also
  require retries after concurrent updates.
  [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- PostgreSQL has row and table locks. It also has application-defined advisory
  locks at session or transaction scope. Transaction-scoped advisory locks are
  released at the end of the transaction.
  [PostgreSQL explicit and advisory locking](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
- `NOTIFY` events issued in a transaction are delivered only after commit.
  Duplicate channel and payload pairs in one transaction can be folded into
  one event. The payload is small, and the documentation recommends a database
  table for larger data.
  [PostgreSQL `NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html)
- Logical decoding converts persistent table changes from the write-ahead log
  into an application-consumable stream. Replication slots are persistent, but
  a consumer must handle replay after a crash and must prevent unused slots
  from retaining storage indefinitely.
  [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html)
- PostgreSQL includes full-text document parsing, normalization, ranking, the
  `tsvector` and `tsquery` types, and index-supported matching.
  [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch-intro.html)
- PostgreSQL Row-Level Security can restrict selected and modified rows. When
  RLS is enabled and no policy applies, the result is default-deny. Table
  owners and roles with `BYPASSRLS` require special care.
  [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

These are database facts. Drizzle and Kysely can expose or compile SQL that
uses them, but neither library makes another database implement them with the
same behavior.

### 2. Kysely is a typed SQL query builder

Kysely describes itself as a type-safe TypeScript SQL query builder. It tracks
tables and columns visible to each query and infers selected result columns,
aliases, joins, subqueries, and common table expressions.
[Kysely introduction](https://www.kysely.dev/docs/intro)

#### Schema knowledge and runtime metadata

- Query typing requires a TypeScript `Database` interface whose keys are table
  names and whose values describe table rows.
  [Kysely getting started: types](https://www.kysely.dev/docs/getting-started#types)
- Kysely recommends generating that interface for production systems. The
  documented generators are separate libraries that introspect a database or
  another schema source.
  [Kysely generating types](https://www.kysely.dev/docs/generating-types)
- The TypeScript interface is not a runtime schema model. Kysely says it only
  handles these types at the TypeScript level. Runtime JavaScript values are
  determined by the driver, and the developer must describe those types
  correctly.
  [Kysely runtime types](https://www.kysely.dev/docs/getting-started#types)
- Kysely does expose runtime database introspection through dialect
  implementations. Its `DatabaseIntrospector` returns schema, table, view, and
  column metadata from the connected database.
  [Kysely database introspection recipe](https://www.kysely.dev/docs/recipes/introspecting-relation-metadata),
  [Kysely `DatabaseIntrospector`](https://kysely-org.github.io/kysely-apidoc/interfaces/DatabaseIntrospector.html)

Kysely therefore provides database introspection, but it does not provide one
application-owned runtime schema object that simultaneously defines relations,
migrations, validation, Admin metadata, and query types.

#### Schema creation and migrations

- Kysely has a DDL schema builder and classic `up` and `down` migrations.
- Migration functions receive `Kysely<any>`. The documentation explicitly says
  that migrations must be frozen in time and must not depend on the current
  application database type.
- Migration order, a migration provider, and migration execution are provided.
  A migration provider can be implemented by the application.
- The optional Kysely CLI is separate from core. Kysely does not document a
  core schema-diff engine that turns the `Database` interface into migrations.

[Kysely migrations](https://www.kysely.dev/docs/migrations)

#### Transactions

Kysely provides callback transactions and controlled transactions. The
transaction builder retains the application `DB` type and supports isolation
and read-only/read-write access modes. Controlled transactions expose commit,
rollback, and savepoint operations.
[Kysely `TransactionBuilder`](https://kysely-org.github.io/kysely-apidoc/classes/TransactionBuilder.html),
[Kysely `ControlledTransaction`](https://kysely-org.github.io/kysely-apidoc/classes/ControlledTransaction.html)

The actual transaction behavior remains dialect and database behavior.

#### Dialects and drivers

Kysely has built-in dialects for PostgreSQL, MySQL, MSSQL, SQLite, and PGlite.
A dialect connects the query compiler to a database driver. Third-party and
organization dialects add more drivers and databases.
[Kysely dialects](https://www.kysely.dev/docs/dialects)

The existence of several dialects means the query builder can target several
databases. It does not mean that one application contract can use all SQL and
concurrency features unchanged across those databases.

#### Relations

Kysely states directly that it is not an ORM and has no concept of relations.
Its relation recipe builds nested rows with SQL subqueries and dialect-specific
JSON helpers.
[Kysely relations recipe](https://www.kysely.dev/docs/recipes/relations)

QUESTPIE would still own relation identity, cardinality, inverse relations,
referential actions, nested selection semantics, and relation metadata.

#### Plugins and extensibility

Kysely has a documented plugin interface. A plugin can transform the immutable
query operation tree before execution and transform the result after execution.
[Kysely plugin system](https://www.kysely.dev/docs/plugins),
[Kysely `KyselyPlugin`](https://kysely-org.github.io/kysely-apidoc/interfaces/KyselyPlugin.html)

Kysely also exposes expression and aliased-expression interfaces. Custom
helpers can lower to operation nodes, commonly through its parameterized `sql`
template. Kysely discourages inheritance and does not support builder extension
through module augmentation as a normal extension strategy.
[Extending Kysely](https://www.kysely.dev/docs/recipes/extending-kysely)

This operation tree is relevant to read observation and query rewriting. A
proof is still required to show that it exposes every dependency that QUESTPIE
needs for realtime invalidation.

#### Raw SQL

Kysely provides a parameterized `sql` template and typed raw builders. The type
argument remains an assertion made by the author when the database cannot be
inferred statically.
[Kysely raw SQL recipe](https://www.kysely.dev/docs/recipes/raw-sql)

### 3. Drizzle is a schema model, query layer, and toolchain

Drizzle describes itself as a TypeScript ORM with both SQL-like and relational
query APIs. It also describes the core as a library plus opt-in tools rather
than an application framework.
[Drizzle overview](https://orm.drizzle.team/docs/overview)

#### Schema knowledge and runtime metadata

- Drizzle tables, columns, indexes, constraints, enums, and other database
  objects are declared as executable TypeScript values.
- The exported schema is the source used by Drizzle ORM queries and by Drizzle
  Kit migration generation.
- A project can split schema values across files. Drizzle Kit imports the
  exported values from configured paths.

[Drizzle schema declaration](https://orm.drizzle.team/docs/sql-schema-declaration)

This model gives Drizzle runtime table and column objects that toolmakers can
inspect. The documented type utilities derive select and insert types from
those table values, and runtime helpers expose columns and PostgreSQL table
configuration.
[Drizzle type and table helpers](https://orm.drizzle.team/docs/goodies)

It is closer than Kysely's erased `Database` interface to the runtime metadata
a schema-driven framework needs. It is still a SQL schema model, not a QUESTPIE
Collection model: it does not intrinsically contain Principal policy, semantic
operation exposure, Admin presentation, client serialization, or realtime
meaning.

#### Migrations

Drizzle Kit supports database-first and code-first workflows. It can pull a
database schema into TypeScript, push a TypeScript schema directly, generate
SQL migrations, apply migrations, or export SQL.
[Drizzle migration fundamentals](https://orm.drizzle.team/docs/migrations)

Its configuration selects a dialect and schema paths. The current documented
dialect choices include PostgreSQL, MySQL, SQLite, Turso, SingleStore, MSSQL,
and CockroachDB. Generated migration folders contain SQL and schema snapshots.
[Drizzle Kit configuration](https://orm.drizzle.team/docs/drizzle-config-file)

This is materially more than Kysely core provides for code-first schema diff.
QUESTPIE would still need to control migration ownership, package contribution
collisions, deterministic snapshots, review policy, and production execution.

#### Transactions

Drizzle provides callback transactions, nested transactions through
savepoints, rollback, returned values, relational queries in a transaction,
and dialect-specific transaction options.
[Drizzle transactions](https://orm.drizzle.team/docs/transactions)

As with Kysely, the database defines the actual concurrency guarantees.

#### Dialects and drivers

Drizzle has dialect-specific schema packages and query implementations. Its
PostgreSQL connection documentation lists multiple PostgreSQL drivers and
providers, including PGlite and serverless transports.
[Drizzle connection overview](https://orm.drizzle.team/docs/connect-overview)

Multi-dialect support exists, but schema constructors and some query and
transaction types are dialect-specific. Exposing `PgTable`, PostgreSQL column
builders, or PostgreSQL transaction types is both Drizzle lock-in and
PostgreSQL lock-in.

#### Relations

Drizzle defines soft relation metadata separately from foreign-key constraints.
The relational query API can return nested typed objects and supports one,
many, and through relations. The documented API is currently part of the
Drizzle v1 release-candidate documentation.
[Drizzle relations](https://orm.drizzle.team/docs/relations)

This can implement part of QUESTPIE's relation query lowering. QUESTPIE would
still need to own stable public relation semantics because relation metadata,
foreign keys, authorization, exposure, and client selection are different
concerns.

#### Extensibility

Drizzle documents:

- custom column types with SQL data-type generation and driver-value mapping;
- a parameterized SQL template and custom SQL helpers;
- dynamic query builders for reusable query enhancement;
- dialect-specific database extensions.

[Drizzle custom types](https://orm.drizzle.team/docs/custom-types),
[Drizzle dynamic query building](https://orm.drizzle.team/docs/dynamic-query-building),
[Drizzle PostgreSQL extensions](https://orm.drizzle.team/docs/extensions)

The official documentation reviewed for this note does not expose a general
query-AST plugin interface equivalent to Kysely's `transformQuery` and
`transformResult`. This is a scoped documentation observation, not proof that
Drizzle internals cannot be instrumented.

#### Raw SQL

Drizzle provides a parameterized `sql` template that can be used for complete
queries or embedded in query-builder clauses. Its `sql<T>` generic does not
perform runtime mapping; the documentation identifies it as a typing helper.
Runtime mapping can be supplied separately. `sql.raw()` intentionally inserts
an unescaped raw string.
[Drizzle SQL template](https://orm.drizzle.team/docs/sql)

### 4. Kysely and Drizzle comparison

| Concern               | Kysely                                                      | Drizzle                                                          | Work still owned by QUESTPIE                                             |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Primary abstraction   | Typed SQL query builder                                     | SQL schema values, SQL-like queries, relational queries, and Kit | Semantic Collections, Globals, Fields, operations, and ownership         |
| Query typing          | Strong scope and result inference from `Database` interface | Strong inference from runtime schema values                      | Stable selection/filter/pagination contract and generated client types   |
| Runtime schema        | Database introspection; TS database interface is erased     | Executable table and column values                               | Framework metadata, policies, presentation, exposure, and provenance     |
| Relations             | No relation concept                                         | Soft relation metadata and relational query API                  | Stable relation semantics, constraints, policy, and client contract      |
| Migration authoring   | DDL builder and ordered `up`/`down` runner                  | Schema diff, SQL generation, pull, push, migrate                 | Contribution merge, ownership, diagnostics, review, and production rules |
| Transactions          | Callback and controlled transactions, isolation, savepoints | Callback transactions, savepoints, dialect options               | Mutation boundary, retry policy, durable reaction/outbox semantics       |
| Dialects              | PostgreSQL, MySQL, MSSQL, SQLite, PGlite plus extensions    | Several SQL dialects and drivers                                 | Decide which semantics the product promises                              |
| Query plugins         | Documented operation-tree and result transforms             | No comparable public SPI found in reviewed docs                  | Read observation, policy injection, telemetry, cancellation              |
| Raw SQL               | Parameterized typed raw builders                            | Parameterized SQL template plus explicitly unsafe raw insertion  | Mark escape-hatch portability, policy, and realtime limitations          |
| Runtime value mapping | Driver decides values; application types must match         | Columns and codecs can map driver values                         | Public serialization and client-safe value contract                      |

### 5. AdonisJS already covers conventional framework breadth

#### Core, lifecycle, and dependency injection

AdonisJS is a backend-first TypeScript framework. It provides routing,
middleware, request context, application lifecycle, service providers, and an
IoC container. Service providers register bindings and run ordered lifecycle
phases. Request-specific values use scoped resolvers.
[AdonisJS introduction](https://docs.adonisjs.com/introduction),
[AdonisJS service providers](https://docs.adonisjs.com/guides/concepts/service-providers),
[AdonisJS dependency injection](https://docs.adonisjs.com/guides/concepts/dependency-injection)

#### Data

Lucid is AdonisJS's Active Record ORM on top of Knex. Current documentation
describes PostgreSQL, MySQL, Turso, SQLite, and MSSQL support; migrations;
generated schema classes; direct query-builder access; transactions;
relationships; hooks; pagination; serialization; and factories. Its current
schema-generation workflow is migrations-first: the database is migrated,
then Lucid introspects it and generates typed schema classes that application
models extend.
[AdonisJS Lucid overview](https://docs.adonisjs.com/guides/database/lucid),
[Lucid migrations](https://lucid.adonisjs.com/docs/migrations),
[Lucid schema generation](https://lucid.adonisjs.com/docs/schema-generation)

Lucid model hooks are not a universal mutation boundary. The documentation
warns that direct query-builder updates bypass model hooks and automatic
timestamps. This differs from a framework in which every semantic mutation is
required to cross one transaction and durable-dispatch boundary.

#### Authentication and authorization

AdonisJS Auth provides session, access-token, and basic-auth guards. Guards use
providers for user lookup and token verification; Lucid providers are built in,
and custom providers or guards are supported.
[AdonisJS authentication](https://docs.adonisjs.com/guides/auth/introduction)

Authorization uses Bouncer abilities and policies. It consumes the currently
authenticated user and supports guest checks and policy hooks.
[AdonisJS authorization](https://docs.adonisjs.com/guides/auth/authorization)

#### Validation

AdonisJS integrates VineJS validators with the request lifecycle and HTTP error
responses. Validators are compiled and can infer TypeScript output types.
[AdonisJS validation](https://docs.adonisjs.com/guides/basics/validation)

#### Queues

The official `@adonisjs/queue` package provides typed job payloads, Redis,
database, and synchronous backends, delays, priorities, retry strategies,
deduplication, batches, schedules, workers, and test fakes. The official guide
currently marks this package experimental and advises pinning its version.
[AdonisJS queues](https://docs.adonisjs.com/guides/digging-deeper/queues)

The reviewed queue documentation does not state that dispatch is atomically
committed with the application's Lucid transaction. An implementation proof is
required before treating it as a transactional outbox.

#### Realtime

The official Transmit package implements server-to-client Server-Sent Events
with named channels, authorization callbacks, lifecycle hooks, a browser
client, and transports for synchronizing several server instances. Client to
server communication remains normal HTTP.
[AdonisJS Transmit](https://docs.adonisjs.com/guides/digging-deeper/server-sent-events)

Transmit is explicit channel pub/sub. The documentation does not describe
automatic dependency capture from the reads performed by a query handler.

#### Typed client

Tuyau generates a typed route registry from Adonis routes, controllers, and
validators. Its client types request path, params, query, body, responses, and
validation errors, and models JSON serialization across the HTTP boundary.
[AdonisJS type-safe API client](https://docs.adonisjs.com/guides/frontend/api-client)

A generated TypeScript client is therefore not a unique QUESTPIE feature.

#### OpenAPI and Admin/Studio scope observation

The current official AdonisJS guide navigation reviewed in this research has a
typed client and OpenTelemetry, but it does not list a first-party OpenAPI
generation guide or a generic schema-driven Admin/Studio product. The testing
guide can validate responses against an existing OpenAPI specification.
[AdonisJS guide index as shown in the typed-client guide](https://docs.adonisjs.com/guides/frontend/api-client),
[AdonisJS API test OpenAPI assertion](https://docs.adonisjs.com/guides/testing/api-tests)

This is a statement about the first-party documentation reviewed on the
research date. It is not a claim that no community package exists.

### 6. Local v3 evidence about Drizzle coupling

The current QUESTPIE repository provides concrete evidence about the cost of
making Drizzle types part of the framework's public type graph.

- The committed TypeScript budget records 1,831,510 instantiations for the
  `questpie` package and 2,826,959, 3,618,124, and 2,980,539 for the three
  measured example applications. The package measurement includes package
  type tests, while the examples are the user-facing signal.
  [`scripts/type-budget.json`](../../../scripts/type-budget.json)
- The budget script records that adding variance annotations to hot CRUD and
  Field generics reduced example-application instantiations by about 40%. This
  means the type graph has already required dedicated performance engineering.
  [`scripts/type-budget.ts`](../../../scripts/type-budget.ts)
- Public Collection builder types directly construct Drizzle
  `PgTableWithColumns` types from `BuildColumns` and carry `PgColumn` and `SQL`
  types.
  [`packages/questpie/src/server/collection/builder/types.ts`](../../../packages/questpie/src/server/collection/builder/types.ts)
- Generated App typing derives and exports a Drizzle client type, and the
  runtime App stores that concrete database client.
  [`packages/questpie/src/cli/codegen/template.ts`](../../../packages/questpie/src/cli/codegen/template.ts),
  [`packages/questpie/src/server/config/questpie.ts`](../../../packages/questpie/src/server/config/questpie.ts)
- Admin integration contains `as any` assertions documented as workarounds for
  duplicate Drizzle dependency resolution, including index creation and a
  direct database update.
  [`admin-preferences.ts`](../../../packages/admin/src/server/modules/admin-preferences/collections/admin-preferences.ts),
  [`setup.ts`](../../../packages/admin/src/server/modules/admin/routes/setup.ts)

These numbers do not prove that Drizzle alone causes every instantiation. They
do prove that QUESTPIE v3's public builder design is coupled to large Drizzle
generic types and that package identity can leak into application correctness.
“Use PostgreSQL semantics” does not require repeating this public type shape in
v4.

## Part II: architectural inferences

The following sections are analysis, not upstream product facts.

### 7. Lock-in choices are two-dimensional

#### Axis A: promised database semantics

**A1. Public PostgreSQL contract**

QUESTPIE can make transaction retries, row locks, advisory locks, commit-ordered
notifications, PostgreSQL full-text search, and a PostgreSQL change feed part
of its documented behavior.

Benefits:

- The framework can provide strong, testable semantics instead of a lowest
  common denominator.
- Data, durable Jobs, realtime, search, and tenant policy can share one
  transactional substrate.
- The implementation and failure model are easier to specify.

Costs:

- Supporting another database becomes a new semantic implementation, not a
  driver change.
- Some edge and embedded deployments become unavailable or require PGlite.
- Applications can depend on PostgreSQL behavior even when the surface syntax
  looks database-neutral.

**A2. Database-neutral public contract**

QUESTPIE could define only an intersection of database behaviors and add
capability checks for stronger features.

Benefits:

- More database targets become possible in principle.
- Embedded SQLite and vendor-specific serverless databases can be first-class.

Costs:

- Transactions, locking, search, realtime capture, migrations, relation
  constraints, and raw SQL all need capability matrices.
- The current product thesis becomes weaker unless two real engines prove the
  abstraction.
- A nominally portable application can still become non-portable through
  fields, operators, raw queries, migrations, or concurrency assumptions.

**A3. No database portability promise**

QUESTPIE can keep the public semantic Data API independent of a database
library without claiming that an application runs on several databases.

This is not the same as database neutrality. It preserves an internal seam and
avoids unnecessary public leakage while allowing v4.0 to implement PostgreSQL
semantics only.

#### Axis B: public TypeScript engine

**B1. Public Drizzle lock-in**

Collections could be Drizzle tables, or expose Drizzle table and query types
throughout normal application code.

Benefits:

- One executable TypeScript schema serves queries and Drizzle Kit.
- Users receive the complete Drizzle ecosystem and raw query power.
- QUESTPIE writes less query-builder code.

Costs:

- Drizzle becomes part of QUESTPIE's source compatibility and major-version
  policy.
- Package contributions and Collection augmentation must compose Drizzle table
  definitions before table construction. They cannot safely mutate an already
  constructed table as if it were QUESTPIE's own Definition IR.
- Drizzle's SQL schema vocabulary can become the design limit for non-SQL
  framework metadata.
- A future engine replacement requires application rewrites.
- Drizzle's current v1 relation and internal changes increase risk if public
  framework abstractions depend on detailed generic types.

**B2. Public Kysely lock-in**

Applications could define or receive a Kysely `Database` interface and use
Kysely as the normal Data API.

Benefits:

- Excellent SQL query typing and a documented query transformation seam.
- A small, honest abstraction close to SQL.
- Several dialects and drivers already exist.

Costs:

- QUESTPIE must still own schema values, relations, validation, migrations,
  introspection, Admin metadata, and package augmentation.
- The generated `Database` type and the runtime framework schema have separate
  authorities unless QUESTPIE generates the former from its IR.
- Kysely query types become part of the public compatibility policy.
- Semantic operations and policy-aware Collection APIs risk collapsing into a
  generic raw database API.

**B3. Private Drizzle or Kysely engine**

QUESTPIE owns public Definitions and a normalized Data IR. A private lowerer
creates engine schema/query objects.

Benefits:

- Ownership, collision, augmentation, policies, Admin metadata, and client
  projection remain framework concepts.
- The engine can be selected and replaced using evidence.
- Normal application definitions do not inherit engine version churn.

Costs:

- QUESTPIE needs an explicit semantic query IR and engine error mapping.
- The raw-engine escape hatch must be clearly marked because it bypasses some
  portability, policy, and realtime guarantees.
- Engine swaps are still large internal rewrites. The seam does not make them
  free.

### 8. Drizzle versus Kysely as a private engine

Drizzle is the stronger candidate when the private engine must provide:

- executable SQL schema objects;
- dialect-specific columns and value mapping;
- relational query lowering;
- schema diff and generated SQL migrations;
- an existing schema-aware Studio tool.

Kysely is the stronger candidate when the private engine must provide:

- a small query compiler close to SQL;
- precise selection and alias inference;
- a documented immutable operation tree;
- query and result transformation plugins;
- a clean boundary between query compilation and execution.

Neither choice removes the need for QUESTPIE's semantic Data IR. A plausible
hybrid is to use QUESTPIE IR as the only authority, use a dedicated migration
lowerer, and use Kysely for runtime queries. Another plausible implementation
uses generated Drizzle schema objects for both migration input and runtime
queries. A hybrid that exposes both libraries publicly would combine, not
remove, their lock-in.

The decisive unknown is realtime read observation. QUESTPIE needs to know the
actual semantic dependencies of a handler, including nested relations,
subqueries, raw fragments, policy predicates, and conditional execution.
Kysely has a documented AST transform point. Drizzle has richer runtime schema
objects but no comparable documented general query plugin. This must be tested
with representative queries before choosing an engine.

An adversarial objection remains: if QUESTPIE erases Kysely from all public
types and uses it only to turn an already normalized IR into SQL, Kysely may buy
little more than a SQL printer. Its private use is justified only if the
operation tree, dialect/driver separation, cancellation, transaction API, or
instrumentation materially removes framework code. If those seams are not
used, focused PostgreSQL SQL generation or Drizzle may be smaller.

The minimum private seam should not be a public `StorageEngine` interface. It
only needs internal boundaries for:

- lowering compiled schema and migration IR;
- opening one PostgreSQL transaction and passing its handle through the
  Mutation runtime;
- compiling and executing queries with cancellation and observation;
- mapping driver values and errors;
- inspecting deployed schema state.

Different PostgreSQL drivers and PGlite can sit below this seam without
claiming database portability. This seam is valuable only when it keeps engine
generic types out of public declarations and permits conformance tests against
more than one PostgreSQL connection implementation.

### 9. Building an own SQL engine is the wrong default

“Own the semantic engine” and “write a SQL query builder, dialect compiler, and
driver stack” are different decisions.

QUESTPIE should own:

- Definition and Contribution IR;
- Collection, Field, relation, policy, and operation semantics;
- selection, filter, order, and pagination grammar;
- mutation and transaction boundaries;
- read-dependency and durable-reaction metadata;
- generated client, OpenAPI, MCP, and Admin projections;
- error and serialization contracts.

Writing a new low-level SQL engine additionally requires:

- SQL AST and compiler correctness;
- identifier and parameter escaping;
- dialect feature matrices;
- driver, pool, cancellation, prepared-query, and streaming behavior;
- transaction and savepoint behavior;
- runtime value codecs;
- schema DDL and migration diff;
- extensive SQL and database conformance testing.

Kysely and Drizzle already solve large parts of that list. A QUESTPIE-owned SQL
engine is justified only if a prototype proves that neither library exposes the
instrumentation or compilation seam required by the semantic runtime. It
should not be chosen to avoid the appearance of a dependency.

### 10. Does QUESTPIE still have a reason to exist?

#### What is no longer differentiating

AdonisJS already supplies:

- a structured TypeScript backend framework;
- lifecycle, dependency injection, package providers, and test swaps;
- ORM, migrations, relations, transactions, and multiple databases;
- authentication and authorization;
- validation;
- queues and scheduling, although the current official queue is experimental;
- authorized realtime channels over SSE;
- a generated typed HTTP client;
- a broad set of official operational packages.

Rebuilding this list with function builders instead of classes is not enough
reason for a new framework.

#### Potential differentiated core

QUESTPIE has a distinct thesis if the following form one coherent contract:

1. Packages contribute owned, qualified Definitions. The compiler detects
   collisions and applies explicit augmentation before runtime.
2. The compiler produces a concrete application contract rather than a global
   bag of loosely typed extensions.
3. Collections and Globals project through the same semantic selection,
   policy, serialization, and exposure rules to server, client, OpenAPI, MCP,
   and Admin.
4. Mutations own the transaction and durable dispatch boundary. Side effects
   become durable reactions instead of best-effort model hooks.
5. Realtime watches derive dependencies from reads performed by a handler,
   rather than requiring the author to maintain parallel channel invalidation
   lists.
6. Principal, Tenant, and Authority apply across HTTP, realtime, Jobs, MCP, and
   direct execution.

AdonisJS can host such a runtime. It does not make this semantic compiler
redundant.

### 11. Drastic product variants

| Variant                                                    | Product                                                                                                                                  | Gains                                                                                           | Losses and risks                                                                                                | Differentiation                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Stop QUESTPIE and build Adonis packages                    | Auth, Admin, or realtime helpers for Adonis                                                                                              | Mature host, lifecycle, DI, routing, auth, Lucid, testing, typed client                         | QUESTPIE composition compiler and host independence disappear; package augmentation must fit Adonis conventions | Low unless one package contains the semantic transaction/realtime compiler |
| QUESTPIE compiler/runtime mounted in hosts                 | Definitions, compiler, Data operations, transactions, durable reactions, realtime, generated client; Adonis/Hono/TanStack mount adapters | Smallest overlap with hosts; Adonis becomes complementary; normal custom HTTP stays in the host | Host integration and Execution Scope propagation need precise seams; turnkey experience needs official mounts   | High if semantic contract works identically across hosts                   |
| Retain a full independent framework                        | QUESTPIE owns HTTP, services, Data, auth integration, Jobs, realtime, telemetry, client, and optional Admin                              | One coherent installation and opinionated DX                                                    | Duplicates mature host features; largest maintenance and security surface; risks breadth without depth          | Medium only if compiler semantics remain primary                           |
| Focus only on operations, Data, realtime, and transactions | A backend semantic runtime rather than a general web framework                                                                           | Sharp thesis; direct investment in unique behavior; can mount anywhere                          | Users assemble auth, HTTP, mail, storage, and other facilities; integrations must map Principal and services    | Highest technical differentiation, narrower market promise                 |
| Public Drizzle framework                                   | QUESTPIE becomes a high-level Drizzle compiler plus client/realtime                                                                      | Leverages schema ecosystem and Drizzle Studio                                                   | Framework contract follows Drizzle; package augmentation and policy semantics may fight table construction      | Medium                                                                     |
| Public Kysely framework                                    | QUESTPIE becomes semantic schema/codegen around a Kysely query API                                                                       | Excellent SQL/query extensibility                                                               | QUESTPIE must still build almost all schema metadata; raw query API can dominate semantic operations            | Medium                                                                     |

### 12. A conservative foundation that preserves drastic options

The least-regret architecture is:

```text
application and package Definitions
                │
                ▼
     normalized QUESTPIE App IR
     ownership · policy · relations
     operations · exposure · metadata
                │
       ┌────────┼─────────┬───────────┐
       ▼        ▼         ▼           ▼
  PostgreSQL  generated  client     OpenAPI/
  lowerer     App types  contract    MCP/Admin
       │
       ▼
 private Drizzle, Kysely, or focused SQL compiler
```

Rules implied by this seam:

- Normal Definition types do not mention Drizzle or Kysely.
- Normal published declaration files contain no Drizzle or Kysely symbols. A
  separate native-engine escape-hatch entrypoint may expose them deliberately.
- The compiled App IR contains enough data to generate schema, migrations,
  queries, client serialization, and diagnostics.
- PostgreSQL-specific Field Kinds and operators may exist. They are named as
  PostgreSQL-specific instead of pretending to be portable.
- A native SQL or engine escape hatch is allowed, but its contract says which
  policy, read-observation, client, and portability guarantees it bypasses.
- HTTP hosts authenticate requests and map them to a trusted Principal. The
  semantic runtime owns authorization and Execution Scope.
- Custom host routes may call the generated App runtime. QUESTPIE does not need
  to replace the host router.
- The first implementation may be PostgreSQL-only without publishing a generic
  persistence SPI.

This architecture supports both a future full QUESTPIE distribution and an
Adonis-mounted distribution. The decision can remain packaging and product
positioning until host prototypes reveal material semantic differences.

## Part III: proof plan before an ADR change

### 13. Engine bake-off

Implement the same small internal Data IR with two private lowerers:

1. PostgreSQL plus Drizzle;
2. PostgreSQL plus Kysely.

The test application must include:

- scalar, JSON, enum, date, generated, and custom PostgreSQL fields;
- hostile PostgreSQL cases: JSONB operators, full-text search, `SKIP LOCKED`,
  advisory locks, and `RETURNING`;
- one-to-one, one-to-many, many-to-many, and self relations;
- package-owned tables plus an application augmentation;
- select, nested select, filters, ordering, offset and cursor pagination;
- policy predicates using Principal and Tenant;
- proof that policy predicates are pushed into SQL and do not become
  post-query filtering;
- a mutation that writes several tables, inserts an outbox record, and commits
  one notification atomically;
- transaction retry after a serialization failure;
- query cancellation;
- raw SQL;
- migration generation and a reviewed destructive change;
- runtime schema projection for Admin and OpenAPI;
- dependency capture for ordinary, relation, conditional, aggregate, and raw
  queries.

Measure:

- generated SQL and number of queries;
- type-check time and type quality at the public boundary;
- amount of unsafe casting in the lowerer;
- migration determinism;
- completeness of read dependency capture;
- error and cancellation mapping;
- number of engine types that leak into normal application source;
- effort to add one PostgreSQL-specific operator;
- TypeScript instantiations, with a provisional target of at most 10% of the v3
  example budgets for equivalent public examples.

Reject an engine if normal application Definitions must expose its generic
types or if complete read observation requires unsupported internal monkey
patching.

Run one additional one-day SQLite “bluff spike.” Do not build a SQLite engine.
List every public semantic contract that fails or weakens when the PostgreSQL
lowerer is replaced by SQLite. This distinguishes a real engine seam from a
PostgreSQL contract hidden behind generic names.

### 14. Host bake-off

Mount the same compiled application in:

1. the smallest QUESTPIE fetch adapter;
2. AdonisJS;
3. one existing Fetch-native host used by QUESTPIE examples.

Prove:

- trusted Principal creation at the host boundary;
- one Execution Scope across request, mutation, services, telemetry, and
  realtime subscription authorization;
- exact generated client behavior in every host;
- no host-specific code in Collection, Mutation, or policy Definitions;
- host-native custom routes can call the generated App runtime;
- graceful startup, shutdown, worker, and test lifecycle integration.

If the Adonis mount is thin and loses no semantic guarantee, QUESTPIE does not
need to compete with Adonis at the HTTP/lifecycle layer. If every host needs a
large custom integration, a full distribution may be the simpler product.

## Questions left deliberately open

1. Is PostgreSQL a named user-facing product requirement or only the v4.0
   implementation with no portability promise?
2. Does normal server userland receive a semantic Collection API only, or also
   a clearly marked native SQL engine?
3. Can raw SQL participate in read observation through explicit dependency
   declaration when static/runtime observation is incomplete?
4. Can Drizzle's public schema values be generated from QUESTPIE IR without
   making Drizzle types part of Definition authoring?
5. Can Kysely's operation-tree plugin capture all actual table and relation
   dependencies after policy injection and query lowering?
6. Are migration diffs owned by QUESTPIE IR, delegated to Drizzle Kit, or
   generated through a focused PostgreSQL schema-diff component?
7. Does QUESTPIE ship as a full distribution and a host-mounted runtime, or is
   one explicitly primary?

## Research conclusion

Do not replace “PostgreSQL lock-in” with “Drizzle lock-in.” They answer
different questions.

The evidence supports a sharper temporary position:

- own the QUESTPIE semantic Data and operation contract;
- retain PostgreSQL as the only proven v4.0 database semantics;
- publish no database portability SPI yet;
- keep Drizzle or Kysely private until the engine bake-off is complete;
- do not build a new SQL engine unless both fail a concrete required seam;
- treat AdonisJS as a potential host and benchmark, not as proof that the
  compiled semantic runtime is redundant;
- stop the full-framework direction if QUESTPIE cannot prove transaction-owned
  durable reactions and query-derived realtime as one coherent developer
  experience.
