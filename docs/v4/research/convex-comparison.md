# QUESTPIE v4 and Convex comparison

Status: research note
Research date: 2026-08-10
Scope: the proposed QUESTPIE v4 product boundary and the current Convex
product. This note separates observed facts from architectural inferences. It
does not change an accepted decision.

## Research question

QUESTPIE v4 proposes a host-neutral, PostgreSQL-first transactional application
compiler and runtime. Its proposed contract includes Collections, Queries,
Mutations, Actions, observed-read realtime, a generated client, durable work,
Storage, Search, and an optional Studio.

Convex already combines a database, TypeScript functions, reactive queries,
transactions, generated clients, scheduled work, storage, search, components,
and an operational dashboard.

This note asks four questions.

1. Is QUESTPIE recreating Convex?
2. Which Convex principles should QUESTPIE adopt?
3. Which Convex product boundaries should QUESTPIE not adopt?
4. What proof would show that QUESTPIE has a distinct reason to exist?

## Executive finding

QUESTPIE and Convex now have the same semantic center:

- read-only Query;
- transactional Mutation;
- effectful Action;
- a generated TypeScript client;
- automatic Query reactivity based on observed reads;
- durable work scheduled from a transaction;
- a generic data and function inspector.

This similarity is not superficial. Convex is the strongest current proof that
this small operation vocabulary can support a complete backend product.

The products still have a different possible boundary.

**Convex is an integrated reactive database and application runtime.** It owns
the logical database, the restricted function runtime, the synchronization
protocol, the clients, and the deployment. This ownership lets it enforce
determinism, retry conflicting transactions, cache Queries, and move every
client subscription to one consistent logical database timestamp.
[Convex functions](https://docs.convex.dev/functions/overview),
[Convex OCC and atomicity](https://docs.convex.dev/database/advanced/occ),
[Convex realtime](https://docs.convex.dev/realtime)

**QUESTPIE can be a PostgreSQL-native semantic application runtime.** The
application keeps normal PostgreSQL as its data platform. It can use native
tables, constraints, SQL, extensions, existing data, and database tools.
QUESTPIE adds an application contract, ownership, Policies, transactional
dispatch, observed-read realtime, generated clients, OpenAPI, MCP, and Studio.

The Convex comparison reopens how this runtime is hosted. It can be an embedded
library inside a selected web host, or it can be one standalone QUESTPIE data
plane with its own operation, realtime, worker, and Studio endpoints. The
standalone form gives QUESTPIE more control over the guarantees and creates a
clearer managed-cloud product without hiding PostgreSQL.

This is a useful distinction only if QUESTPIE preserves its guarantees when
PostgreSQL, raw SQL, host routes, libraries, and external writers are present.
If it cannot do this, Convex supplies the same developer model with stronger
system control and fewer user-visible seams.

The strongest product statement is therefore:

> QUESTPIE gives an owned PostgreSQL application a Convex-like semantic
> operation and realtime model without replacing PostgreSQL. Its strongest
> deployment hypothesis is a standalone, self-hostable QUESTPIE runtime rather
> than an in-process adapter for every web framework.

This statement is an architectural inference. It is not yet a verified product
claim.

## Comparison summary

| Area               | Convex                                                              | Proposed QUESTPIE v4                                                        | Main consequence                                                                       |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Product            | Reactive database, function runtime, sync client, and deployment    | PostgreSQL application compiler plus an embedded or standalone runtime      | The standalone option gives QUESTPIE more control while PostgreSQL stays visible.      |
| Data               | Convex document tables and indexes                                  | Native PostgreSQL Collections, Fields, relations, and constraints           | QUESTPIE can use the PostgreSQL ecosystem and existing data.                           |
| Schema composition | One app schema plus isolated Component schemas                      | Statically composed owned Definitions with explicit Augmentation            | QUESTPIE supports one integrated App Contract but accepts more composition complexity. |
| Query              | Deterministic, transactional, cached, reactive                      | Read-only, policy-aware, observed for realtime                              | QUESTPIE must define determinism and cache semantics more precisely.                   |
| Mutation           | Deterministic serializable transaction with automatic OCC retry     | PostgreSQL transaction plus realtime change and durable dispatch            | QUESTPIE adds outbox semantics but cannot retry arbitrary user code safely.            |
| Action             | External effects; no direct database access                         | External effects and Services outside the atomic Mutation claim             | The concepts match closely.                                                            |
| Realtime           | Database-native dependency tracking and consistent client snapshots | PostgreSQL change capture plus observed reads and recomputation             | This is the most difficult QUESTPIE implementation area.                               |
| Auth               | Accepts OIDC/JWT identities; authorization stays in app code        | Stable Principal and compiled Policies; Auth implementation is separable    | QUESTPIE can provide stronger authorization composition.                               |
| Reuse              | Isolated stateful Components with an API boundary                   | Packages contribute owned resources to one App Contract                     | Convex prevents schema collision by isolation. QUESTPIE validates integration.         |
| HTTP               | HTTP Actions on the Convex deployment                               | Route plus currently accepted host adapters; standalone runtime is reopened | QUESTPIE must decide whether HTTP hosts embed it or call it as a service.              |
| Client             | Generated function references and realtime framework clients        | Generated semantic data and operation client                                | Both depend on code generation. QUESTPIE also targets OpenAPI and MCP projections.     |
| Hosting            | Convex Cloud or the self-hosted Convex backend                      | Normal application deployment and selected PostgreSQL provider              | QUESTPIE has less platform lock-in but more operational responsibility.                |
| Dashboard          | Data, schema, functions, logs, schedules, files, and settings       | Optional schema-driven Studio                                               | Convex strongly validates the reduced Studio direction.                                |

## Part I: observed Convex facts

### 1. Convex owns the database and function model

The Convex database stores JSON-like documents in tables. Convex describes the
model as relational because documents can store typed document IDs that refer
to other tables. Application functions read and write through the Convex
JavaScript database API. The application does not write SQL.
[Database overview](https://docs.convex.dev/database/overview),
[data types](https://docs.convex.dev/database/types)

A schema is optional. When present, `schema.ts` describes table document shapes
and indexes with runtime validators. Convex validates existing documents when
the schema is pushed and validates future inserts and updates. The CLI generates
app-specific `dataModel.d.ts` and server types from the schema.
[Schemas](https://docs.convex.dev/database/schemas),
[generated data model](https://docs.convex.dev/generated-api/data-model)

Indexes are explicit. A function selects an index with `withIndex`. Convex does
not use a SQL optimizer to select an application index implicitly. Convex has no
specific query language for joins, aggregation, or grouping. Application code
performs complex work with JavaScript, document lookups, and index scans inside
one consistent function execution.
[Reading data](https://docs.convex.dev/database/reading-data/),
[indexes](https://docs.convex.dev/database/reading-data/indexes/)

Schema changes and online data backfills are separate concerns. The official
writing guide directs data migrations to a Migrations Component that batches
and resumes changes to live documents.
[Writing data](https://docs.convex.dev/database/writing-data)

### 2. Query, Mutation, and Action are runtime constraints

Convex exposes three primary function types.

- A Query reads the database. It is transactional, cached, and reactive.
- A Mutation reads and writes the database in a transaction.
- An Action performs external effects. It cannot access the database directly.

[Function overview](https://docs.convex.dev/functions/overview)

Queries and Mutations run in a restricted deterministic runtime. Convex freezes
time during a function execution and supplies deterministic randomness. The
runtime does not allow a Query or Mutation to call an external API. These rules
allow Convex to retry a transaction after an optimistic concurrency conflict.
[Function runtimes](https://docs.convex.dev/functions/runtimes)

Convex states that its optimistic concurrency control provides serializability.
A Mutation can be rerun after a conflict because the runtime prevents it from
performing an external effect while it proposes database changes.
[OCC and atomicity](https://docs.convex.dev/database/advanced/occ)

Actions can use `fetch` and can run in the Convex runtime or a Node.js runtime.
An Action accesses data by calling a Query or Mutation. Multiple calls are
separate transactions and do not form one consistent snapshot. Convex does not
retry Actions automatically because an Action can have an external effect.
[Actions](https://docs.convex.dev/functions/actions)

Public functions are callable by clients by default. Internal Query, Mutation,
and Action functions can only be called by other Convex functions, schedules,
the dashboard, or the CLI. Convex recommends runtime input validation for all
public functions. A return validator also checks that a function does not
return an undeclared shape.
[Internal functions](https://docs.convex.dev/functions/internal-functions),
[argument and return validation](https://docs.convex.dev/functions/validation)

### 3. Realtime is part of the database contract

Convex records the data dependencies of a Query. Its clients subscribe to the
Query, and Convex updates the subscription when relevant database data changes.
Convex also caches Query results.
[Realtime](https://docs.convex.dev/realtime)

Convex states a stronger client consistency rule: all active subscription
results in one client move to the same logical database timestamp. A client
does not show one Query before a Mutation and another Query after that Mutation.
[Convex overview](https://docs.convex.dev/understanding/overview),
[TanStack Start integration](https://docs.convex.dev/client/tanstack/tanstack-start/)

Paginated Queries are also reactive. A page can grow or shrink when items enter
or leave its range. The client pagination protocol uses explicit cursor ranges
and page splitting to prevent gaps while data changes.
[Paginated Queries](https://docs.convex.dev/database/pagination),
[Pagination options](https://docs.convex.dev/api/interfaces/server.PaginationOptions)

### 4. Convex Auth resolves identity but does not own authorization

Convex accepts ID tokens from OIDC-compatible identity providers. Its official
guidance recommends complete third-party identity products such as Clerk,
WorkOS, or Auth0. Convex Auth is an optional library and is currently marked
beta.
[Authentication overview](https://docs.convex.dev/auth/overview)

Functions read a `UserIdentity` from `ctx.auth`. The stable identity combines
the token subject and issuer. Other claims depend on the provider and token
configuration.
[Auth in functions](https://docs.convex.dev/auth/functions-auth),
[UserIdentity](https://docs.convex.dev/api/interfaces/server.UserIdentity)

Convex does not provide a required authorization or row-policy framework. Its
documentation says that applications normally check authentication and
authorization in public function code.
[Authorization guidance](https://docs.convex.dev/auth/overview#authorization)

Scheduled functions do not inherit the caller's authentication state. An
application must pass the required identity information as function arguments.
[Scheduled function auth](https://docs.convex.dev/scheduling/scheduled-functions#auth)

### 5. Convex Components use isolation instead of schema augmentation

A Convex Component is a stateful backend module. It has its own functions,
schema, database tables, file storage, scheduled functions, generated types,
and isolated execution environment. The application installs a Component
explicitly and calls its exposed function API. Multiple named instances can be
installed.
[Understanding Components](https://docs.convex.dev/components/understanding),
[Using Components](https://docs.convex.dev/components/using)

The application cannot mutate Component tables directly. A Component cannot
read application tables, environment variables, functions, or files unless the
application passes a value or function explicitly. Calls across a Component
Mutation boundary can still commit transactionally with the calling Mutation.
Each Component call is a subtransaction, so a caught Component error can roll
back the Component call without committing partial state.
[Understanding Components](https://docs.convex.dev/components/understanding)

Components do not receive the application's `ctx.auth`. The application
authenticates the caller and passes an identifier or another required value to
the Component. Component HTTP Actions also do not receive application auth or
application environment variables.
[Authoring Components](https://docs.convex.dev/components/authoring)

Convex documents a hybrid Component pattern for functionality such as Better
Auth. It also warns that hybrid Components add significant maintenance and
backward-compatibility complexity.
[Hybrid Components](https://docs.convex.dev/components/authoring#hybrid-components)

### 6. HTTP Actions are the custom transport escape hatch

An HTTP Action receives a Fetch API `Request` and returns a `Response`. It can
receive webhooks, implement a public HTTP API, and call Convex Queries,
Mutations, and Actions. Routes are registered in `convex/http.ts`. HTTP Actions
are effectful and are not retried automatically.
[HTTP Actions](https://docs.convex.dev/functions/http-actions)

Normal callers do not need an HTTP Action to call Convex functions. Convex
clients use the generated function API. The documented HTTP Action request and
response limit is 20 MB.
[HTTP Actions limits](https://docs.convex.dev/functions/http-actions#limits)

### 7. Storage and Search are integrated services

Convex File Storage stores arbitrary files. A file has a typed
`Id<"_storage">`. A generated file URL is a bearer URL. Any holder can access
it until the file is deleted. Applications that need an authorization check on
every download can proxy bytes through an HTTP Action, subject to the HTTP
response size limit.
[File Storage](https://docs.convex.dev/file-storage/overview)

Full-text search indexes are declared in the schema. Full-text search runs as a
normal database Query, so it is transactional, reactive, and paginated. The
implementation uses Tantivy and has a bounded search and filter grammar.
[Full-text search](https://docs.convex.dev/search/text-search)

Vector search is different. It can only run in an Action. The Action can pass
the result IDs to a later Query or Mutation, but those calls do not share the
vector search snapshot. Convex explicitly documents that a result can change or
be deleted between these calls.
[Vector search](https://docs.convex.dev/search/vector-search)

### 8. Scheduling is core; advanced workflows are Components

Convex stores scheduled functions in its database. A Mutation can schedule a
future function as part of its transaction. If the Mutation fails, the function
is not scheduled. Scheduled Mutations are retried for internal failures and are
documented as exactly-once executions. Scheduled Actions are not automatically
retried and are documented as at-most-once executions.
[Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)

Cron jobs are also built in. Workpool and Workflow are higher-level Components,
not additional core function kinds. The Workflow Component records step
results and resumes long-running work after a process failure.
[Scheduling overview](https://docs.convex.dev/scheduling/overview),
[Workflows](https://docs.convex.dev/agents/workflows)

### 9. The generated client is part of the normal workflow

Convex generates app-specific JavaScript and declaration files for the data
model, server builders, public API, internal API, and Component references. The
generated files are committed to the repository and are required for the best
TypeScript checks.
[Generated code](https://docs.convex.dev/generated-api/),
[`convex codegen`](https://docs.convex.dev/cli/reference/codegen)

Clients call generated function references. React has `useQuery`,
`useMutation`, and `useAction`. `useQuery` creates and manages a live
subscription. Mutations can define client-side optimistic updates against the
local Query result store.
[React API](https://docs.convex.dev/api/modules/react),
[optimistic updates](https://docs.convex.dev/client/react/optimistic-updates)

Convex function identity comes from source structure. The path and name of the
file plus the TypeScript export name determine the public API name. For example,
`convex/foo/messages.ts` with `export const list` becomes
`api.foo.messages.list`. A default export becomes `default` at the API boundary.
[Query function names](https://docs.convex.dev/functions/query-functions)

The central schema object determines table names. A Component has its own schema
and generated API. The application chooses the installed Component instance
name. Convex does not need one cross-Component resource ownership or
Augmentation system because Component state remains isolated.
[Schemas](https://docs.convex.dev/database/schemas),
[Component generated code](https://docs.convex.dev/components/authoring#generated-code)

Convex also documents a TypeScript scaling trade. Its normal generated API
relies heavily on TypeScript inference, and the docs state that this can slow
large codebases. A beta static-codegen mode generates more concrete API and data
model declarations. It improves autocomplete and incremental type checking,
but it loses jump-to-definition and cannot infer a function return without an
explicit return validator. That return becomes `v.any()`.
[Static code generation](https://docs.convex.dev/production/project-configuration#using-static-code-generation-beta)

### 10. Convex supplies cloud and self-hosted deployments

Convex Cloud is the primary managed path. The backend, dashboard, CLI, and
clients are also source-available. The backend uses an FSL Apache 2.0 license
that restricts competing hosted products and converts each version to Apache
2.0 after two years.
[Self Hosting](https://docs.convex.dev/self-hosting)

The self-hosted setup runs a Convex backend and dashboard in addition to the
application frontend. It uses SQLite by default and can use PostgreSQL or MySQL
as the Convex backend's persistence database. The self-hosted documentation
states that the self-hosted edition supports free-tier cloud features and that
the managed cloud is optimized for scale.
[Self-hosted README](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md),
[PostgreSQL and MySQL persistence](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/postgres_or_mysql.md)

Using PostgreSQL under a self-hosted Convex backend does not change the
application programming model. Applications still use Convex tables and
functions, not a native application SQL schema. This last sentence is an
inference from the documented Convex database API and the self-hosted storage
configuration.

Convex can export a logical backup as JSON Lines plus file data and can import
it into another deployment. Continuous import and export options are also
documented. The general import and export feature is marked beta.
[Data import and export](https://docs.convex.dev/database/import-export/),
[backup and restore](https://docs.convex.dev/database/backup-restore)

### 11. The dashboard is a Studio, not an operator application framework

The Convex dashboard can view and edit table documents, show a schema diagram,
run functions, display live Query results, inspect logs, inspect files, and
inspect or cancel scheduled functions. It also manages deployment settings,
environment variables, backups, auth configuration, and integrations.
[Data dashboard](https://docs.convex.dev/dashboard/deployments/data),
[schema dashboard](https://docs.convex.dev/dashboard/deployments/schema),
[function runner](https://docs.convex.dev/dashboard/deployments/functions),
[schedules](https://docs.convex.dev/dashboard/deployments/schedules),
[deployment settings](https://docs.convex.dev/dashboard/deployments/deployment-settings)

The reviewed official documentation does not describe the dashboard as a
customizable application-specific operator UI. This is a negative research
finding, not proof that no external library can build such an interface.

### 12. MCP exists, but it has a different boundary

Convex provides an MCP server for AI development tools. It exposes deployment
status, tables, data, environment configuration, function specifications,
insights, logs, and function execution. Production data and production writes
need explicit dangerous flags.
[Convex MCP server](https://docs.convex.dev/ai/convex-mcp-server),
[`convex mcp` reference](https://docs.convex.dev/cli/reference/mcp)

This is an operational development MCP server. The reviewed official sources
do not show a first-party contract that projects selected application Queries,
Mutations, and Actions into an end-user MCP tool API.

Convex Helpers has a beta OpenAPI generator. It reads deployed function
metadata and generates a specification for the Convex HTTP API. Queries called
through this path are not reactive. Better validators improve generated schema
quality, and the documented generator has value-type limitations.
[OpenAPI and other languages](https://docs.convex.dev/client/open-api)

### 13. Convex guarantees come with explicit limits

The current documented limits include one second of application code for a
Query or Mutation, 16 MiB of data read or written per transaction, 32,000
documents scanned per transaction, 16,000 documents written per transaction,
and 4,096 index ranges read. Actions have longer limits. Search, vector,
function size, file, concurrency, and scheduled-work limits are also explicit.
[Convex limits](https://docs.convex.dev/production/state/limits)

These bounds are part of the architecture. They make caching, retries,
reactivity, resource allocation, and predictable managed operation easier to
control.

## Part II: comparison and inference

### 14. Framework organization and type safety are a primary comparison axis

Convex chooses a small public organization model.

- A source file and export name identify a function.
- One schema object identifies application tables and indexes.
- Generated `api`, `internal`, `server`, and `dataModel` files carry app types.
- A Component owns an isolated schema and exposes a typed function API.
- Installing a Component under a name creates its API namespace and private
  state instance.

This model is easy to explain. It also couples public function identity to
source location and export names. Renaming or moving a file changes the API
name. Convex avoids shared-schema collision by preventing Components from
sharing or augmenting application tables directly.

QUESTPIE proposes a different organization model.

- Every Definition has an explicit stable Resource Identity.
- The export value is also the typed Definition Reference.
- File path and export name record origin, but do not define semantic identity.
- Every resource has an Owner and an Origin Map entry.
- A different Owner can change a resource only through an authorized
  Augmentation.
- Package installation activates nothing by itself. Application source names
  the Package exports that enter composition.
- Capability requirements form a compiled closure. An absent Capability is
  absent from the concrete App Context and client.
- The compiler reads small leaf Definition Contracts and emits one concrete App
  Contract instead of asking TypeScript to infer a recursive application-wide
  merge.
- First-party and third-party product capabilities enter the same normalized
  Contribution path.

These rules come from
[ADR 0002](../../adr/0002-static-application-composition.md),
[ADR 0007](../../adr/0007-resource-identity-ownership-and-augmentation.md),
[ADR 0013](../../adr/0013-generate-a-concrete-app-contract.md), and
[ADR 0044](../../adr/0044-use-one-public-contribution-path.md).

#### Genuine QUESTPIE differentiation

The following parts solve problems that Convex intentionally avoids through
isolation.

1. **Stable semantic identity.** Moving a file does not rename a Collection,
   Query, Mutation, Policy, or generated client member.
2. **Visible integrated ownership.** The compiler can explain who owns a shared
   User Collection, who added a field, and which contract permitted the change.
3. **One resolved domain graph.** Relations, Policies, migrations, Studio,
   OpenAPI, and MCP can see accepted Package contributions in one manifest.
4. **Concrete capability absence.** If Auth, Search, or Storage is absent, its
   context and client surface does not degrade to an optional property.
5. **AI and contributor inspectability.** A generated contract and Origin Map
   can show final application structure without executing runtime merge code.
6. **Type-performance strategy.** Leaf contracts stop Package types from
   recursively embedding the full application. Generation materializes final
   concrete maps once.

Convex's own static-codegen beta supports the final point. It shows that a
framework can reach an inference ceiling and need concrete generated
declarations. It also shows a trade: cheap static types can lose handler return
inference.

QUESTPIE can attempt a stronger compiler path. A TypeChecker can read the
inferred operation result, validate that the result has a supported transport
shape, and emit a concrete client result type. Normal application authors would
not repeat a return schema. Package boundaries and unsupported inferred leaves
can require an explicit Schema. This is a proposed advantage, not a proven one.

The type-performance gate must measure both generation time and editor time. A
generated file that contains a concrete alias to one huge recursive inferred
type has not solved the problem.

#### Public conceptual overengineering risk

Convex is a warning against making every compiler invariant part of the normal
application vocabulary. A normal application author should not need to learn
all internal terms before defining data and operations.

The following concepts are useful implementation or contributor terms, but can
be public overengineering if they appear in every application API:

- Contribution IR and Contribution Identity;
- Capability Closure traversal;
- Resource-Kind normalization algebra;
- Runtime Binding Identity;
- Package compiler export conditions;
- Same-Primitives normalization stages.

The smallest useful public ladder is:

| Audience              | Concepts that must be visible                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Application author    | Collection, Field, Query, Mutation, Action, Policy, Service, explicit name, and imported reference |
| Package author        | Owner, exported Definitions, requirements, and authorized Augmentation                             |
| Framework contributor | Contribution IR, Resource Kind, normalization, closure, projections, and Same-Primitives Law       |

Capability should remain public only when it has observable value: it removes
or adds a concrete context, client, runtime-config, migration, or deployment
surface. It must not become a decorative wrapper around a group of files.

The Same-Primitives Law is a strong implementation discipline. It should mean
that first-party Auth, Files, Jobs, and Studio data pass through the same
ownership, Policy, migration, and generated-contract rules after normalization.
It should not require the private Bootstrap Kernel to implement itself through
a public plugin SPI, and it should not expose compiler stages to application
authors. This limited rule matches
[ADR 0054](../../adr/0054-defer-the-public-compiler-spi-and-remove-integration-roots.md).

The comparison therefore favors QUESTPIE's compiler architecture but rejects a
compiler-shaped user experience. If a Barbershop author needs to understand
Contribution Identity and Capability Closure to add an appointment Query,
Convex has the better framework organization.

### 15. The operation vocabulary should stay

The Query, Mutation, and Action vocabulary is not a speculative QUESTPIE
invention. Convex demonstrates that the vocabulary can be the primary backend
authoring model.

The proposed QUESTPIE separation in
[ADR 0010](../../adr/0010-smart-operations-and-http-routes.md) is therefore
well grounded:

- Query is read-only and can be reactive;
- Mutation owns a database transaction;
- Action owns external effects;
- Route is reserved for an actual HTTP contract.

QUESTPIE should not collapse these kinds into generic Routes or a generic
`procedure`. Their restrictions are the source of useful tooling and runtime
guarantees.

The names alone do not create the guarantees. The runtime contract does.

### 16. QUESTPIE currently has a weaker determinism boundary

Convex can automatically retry a Mutation because it owns a restricted runtime
and prevents external effects during the transaction. QUESTPIE intends to run
normal TypeScript in Bun or Node.js and make native libraries and Services
available through App Context.

This creates a hard requirement:

> QUESTPIE must not automatically retry arbitrary Mutation handler code unless
> it can prove that the handler and every called Service are retry-safe.

A PostgreSQL serialization or deadlock retry can repeat logging, local state
changes, calls through an unsafe Service, nondeterministic values, or a hidden
external request. A database rollback cannot undo those effects.

QUESTPIE has four possible contracts.

1. Do not retry Mutation handlers automatically. Return a declared retryable
   conflict error.
2. Retry only a smaller compiler-checked deterministic Mutation subset.
3. Let a Mutation declare an explicit retry-safe contract and validate every
   reachable Service requirement.
4. Add a restricted deterministic runtime similar to Convex.

Option 1 is the KISS baseline. Option 2 can become a later optimization. Option
4 would change QUESTPIE from a normal host runtime into a larger execution
platform and is not justified by the current product boundary.

Transactional Dispatch remains safe because the Mutation writes dispatch
intent inside PostgreSQL and an Action or Job performs the external effect
after commit. This matches the purpose of
[ADR 0016](../../adr/0016-mutations-own-the-transaction-and-durable-dispatch-boundary.md).

### 17. Realtime is the largest overlap and the strongest threat

Convex already implements the behavior that QUESTPIE identifies as a primary
v4 differentiator:

- run the real Query;
- record its database dependencies;
- subscribe to the Query rather than to a manual channel;
- update it after relevant commits;
- keep several active client results on one consistent database snapshot;
- handle reactive pagination.

QUESTPIE's accepted observed-read direction in
[ADR 0015](../../adr/0015-observe-query-reads-for-realtime.md) is therefore the
correct semantic target. It is not by itself a market differentiator.

QUESTPIE's possible differentiation is to provide the target over normal
PostgreSQL. This is substantially harder because the runtime does not own every
read and write path.

QUESTPIE must define all of these cases.

- A supported Collection read records a document, unique lookup, index range,
  search range, or conservative table token.
- A Policy read is part of the Query dependency set.
- A conditional read changes the dependency set after every recomputation.
- A raw SQL read supplies an explicit Dependency Token or becomes non-reactive.
- A direct native PostgreSQL write must either enter change capture or be
  documented as outside realtime guarantees.
- A write from another service must not be lost because it did not write the
  QUESTPIE outbox row.
- A reconnect must recover every committed change after the client's last
  acknowledged position.
- Several active client Queries need a defined cross-query snapshot rule.
- Paginated results need a gap and duplication rule while rows enter or leave
  a page.

Convex can make all database access pass through one observed database API.
QUESTPIE cannot claim the same guarantee while also calling arbitrary SQL
"normal" unless it defines an observation and change-capture boundary.

### 18. PostgreSQL ownership is the main product distinction

Convex can self-host on PostgreSQL, but PostgreSQL is an implementation store
behind the Convex logical database. A Convex application uses the Convex
document model, indexes, transaction limits, runtime, and synchronization
protocol.

QUESTPIE intends PostgreSQL semantics to remain part of the application
contract. This enables a different set of use cases:

- adopt QUESTPIE around an existing PostgreSQL schema;
- inspect and operate data with standard PostgreSQL tools;
- use native constraints, views, functions, triggers, extensions, and SQL;
- use existing analytics and change-data-capture infrastructure;
- select a PostgreSQL provider independently of the application runtime;
- leave QUESTPIE while retaining a normal PostgreSQL database.

These are proposed QUESTPIE properties. The compiler and migration design must
prove them. In particular, QUESTPIE must not hide all application rows in an
opaque internal document store if it claims native PostgreSQL ownership.

The trade is direct:

- Convex gets stronger control and simpler guarantees.
- QUESTPIE can get better interoperability and a lower data-exit cost.

This supports the PostgreSQL product decision in
[ADR 0004](../../adr/0004-postgresql-is-the-v4-data-platform.md) and the
QUESTPIE-owned public Data contract in
[ADR 0045](../../adr/0045-data-capability-uses-postgresql-engine.md).

It does not support exposing Drizzle or Kysely types. Convex also owns its
public data types instead of leaking the types of its persistence database.

### 19. Convex Components expose a real alternative to Augmentation

QUESTPIE began the v4 design because v3 Modules could silently merge and expand
shared Collections. The effective User model was difficult to inspect.

Convex avoids this problem through a stronger boundary:

- a Component owns its schema and data;
- the app cannot mutate it directly;
- the Component cannot read app data directly;
- the boundary is a typed function API;
- the same Component can have several isolated instances.

QUESTPIE instead proposes static integration:

- a Package can contribute Definitions to one App Contract;
- every resource has one Owner;
- cross-owner change needs an authorized Augmentation;
- the compiler shows collisions, origins, and final shape;
- one PostgreSQL transaction can use all accepted resources directly.

Neither model is universally better.

| Need                                                                   | Better default                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Reusable rate limiter, workflow engine, or AI agent with private state | Convex-style isolation                                        |
| Auth package that must add columns and constraints to shared User data | QUESTPIE static contribution or explicit integration contract |
| Independent package upgrades and multiple instances                    | Convex-style isolation                                        |
| One query planner, Policy system, Studio, and relational graph         | QUESTPIE integrated App Contract                              |
| Prevent any cross-package table coupling                               | Convex-style isolation                                        |
| Permit reviewed cross-owner schema integration                         | QUESTPIE Augmentation                                         |

The Convex lesson is not to add a second QUESTPIE Component system now. The
lesson is to prefer ownership and API boundaries. Augmentation should remain an
exception for a package that must integrate with shared application data. It
must not become the default reuse mechanism.

### 20. Convex supports a smaller Auth boundary

Convex proves that a transactional realtime backend does not need to own a
credential product. It accepts trusted OIDC/JWT identity and places that
identity in function context. Third-party systems can own sessions, passkeys,
passwords, OAuth, and account recovery.

This strongly supports keeping QUESTPIE Principal independent from Auth, as
defined in [ADR 0057](../../adr/0057-keep-principal-independent-from-auth.md).

QUESTPIE can still provide more than Convex at the authorization layer:

- typed Principal kinds for user, service, anonymous, and system execution;
- Tenant and Authority propagation;
- compiled Collection and operation Policies;
- policy pushdown into PostgreSQL Queries;
- the same authorization path for client, Route, Studio, OpenAPI, MCP, Job, and
  realtime recomputation.

Convex normally places authorization checks in function code. This is simple,
but it gives the compiler and dashboard less policy information.

The comparison weakens the case for required Better Auth in the framework
core. A smaller product boundary is:

1. core validates or accepts a trusted Principal source;
2. core owns authorization and Principal propagation;
3. an official Better Auth package owns credential and session functions;
4. a host can instead resolve Principal from OIDC/JWT, a session cookie, an API
   gateway, or another trusted source.

This is an inference. It reopens, but does not change, the Better Auth decision
in [ADR 0058](../../adr/0058-use-better-auth-without-a-generic-auth-spi.md).

### 21. Studio should follow the Convex dashboard boundary

Convex provides strong evidence for the reduced Admin direction in
[ADR 0009](../../adr/0009-generic-admin-not-operator-app-platform.md).

A useful QUESTPIE Studio needs to inspect and operate the framework:

- App Contract and Origin Map;
- Collections, Fields, relations, indexes, and migrations;
- policy-filtered data;
- Query runner with live results;
- Mutation and Action runner with explicit danger states;
- Jobs, Workflows, dispatch, and schedules;
- realtime dependencies and reconnect positions;
- files, search, logs, traces, health, and runtime configuration;
- OpenAPI and MCP exposure.

It does not need to become a toolkit for building a domain-specific operator
application. Userland application code should build that interface.

### 22. Convex validates core scheduling, but not a large Workflow core

Convex puts transactional scheduling and cron in its base platform. It puts
work pools, retries for Actions, and multi-step Workflow orchestration in
Components.

QUESTPIE should apply the same sequencing discipline:

1. implement Transactional Dispatch;
2. implement Job enqueue, lease, retry, cancel, and inspect;
3. implement scheduled and recurring Jobs;
4. validate one real multi-step durable Workflow;
5. only then publish a general Workflow Definition.

This does not require copying Convex delivery labels. QUESTPIE must define its
own at-least-once and idempotency contract over PostgreSQL. It should not claim
exactly once for an external effect.

### 23. Some proposed Capabilities can remain small

Convex does not need a distinct public KV system for normal application state.
Its database API is already a suitable key-value store. QUESTPIE should verify
that a separate public KV Capability has a use that a small PostgreSQL
Collection or internal coordination table cannot satisfy.

Convex makes full-text Search a reactive database read. QUESTPIE can do the
same with PostgreSQL full-text indexes. PostgreSQL and pgvector may also let
QUESTPIE execute vector search inside a normal read transaction. This would be
stronger than the documented Convex vector Action boundary, but only if
QUESTPIE defines stable index, policy, pagination, and observation semantics.

Convex File Storage also shows why a file record and a blob store are separate.
The storage ID is safe to store, but a delivery URL has different authorization
semantics. QUESTPIE's proposed File Collection can add metadata, ownership,
Policies, variants, and an upload lifecycle above a provider-owned blob handle.

### 24. OpenAPI and application MCP are projection comparisons

Convex function references and clients use a proprietary semantic transport.
HTTP Actions expose manual Fetch routes. Convex Helpers can generate a beta
OpenAPI specification from deployed function metadata for non-reactive HTTP
calls.

QUESTPIE can still differentiate in the exact projection contract. OpenAPI
exposure can be explicit at the Definition, compiler errors can reject an
unsupported result leaf, and the same exposure can carry declared errors,
Policies, and origin metadata. This is useful for partners and existing
infrastructure, but OpenAPI generation itself is not unique.

Convex MCP is primarily an operational tool for coding agents. QUESTPIE's
proposed MCP projection has a different purpose: explicitly expose selected
application Queries, Mutations, Actions, resources, and prompts to application
agents. The compiler can carry the same Schema, Principal, Policy, declared
error, and destructive-operation metadata into that projection.

These projections are only a differentiator if they reuse one App Contract.
Separate OpenAPI and MCP registries would remove the advantage.

### 25. Limits are part of the semantic design

Convex can promise automatic retries and live Queries because it places strict
bounds on function time, transaction reads and writes, index ranges, result
sizes, and concurrent work.

QUESTPIE currently describes bounds as documentation still to write. They must
become an executable contract.

At minimum, QUESTPIE needs defaults and diagnostics for:

- maximum observed dependency count;
- maximum Query result bytes;
- maximum Live Query execution time;
- maximum reactive page size and active pages;
- maximum Mutation duration and write count;
- maximum dispatches created by one Mutation;
- maximum Action and Job runtime;
- maximum Channel replay backlog;
- maximum reconnect retention;
- maximum raw SQL dependency breadth;
- per-Principal subscription and execution concurrency.

PostgreSQL does not remove the need for these limits. An open runtime makes them
more important because the system cannot assume every handler is small.

## Part III: threats and product choices

### 26. Direct competitive threat

Convex already ships most of the semantic runtime that QUESTPIE proposes:

- Queries, Mutations, and Actions;
- serializable database transactions;
- automatic Query caching and reactivity;
- consistent realtime clients;
- generated TypeScript APIs;
- optimistic client updates;
- auth identity context;
- HTTP escape hatches;
- durable scheduling and cron;
- file storage, text search, and vector search;
- stateful reusable Components;
- a data and function Studio;
- managed and self-hosted operation.

QUESTPIE must not position the existence of these features as its innovation.

### 27. Remaining QUESTPIE differentiation

QUESTPIE can still solve a different problem.

| Requirement                          | Convex                                        | Possible QUESTPIE advantage                                          |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------- |
| Existing native PostgreSQL database  | Requires movement into Convex logical tables  | Can compile around native PostgreSQL tables and constraints.         |
| Direct SQL and PostgreSQL extensions | Not part of the app programming model         | Explicit PostgreSQL contract and non-portable escape hatch.          |
| Host framework ownership             | Convex owns function deployment               | Mount into TanStack Start, Hono, AdonisJS, Next.js, or a Fetch host. |
| Static shared-schema composition     | Components isolate schema                     | Owned Contributions and explicit Augmentation in one App Contract.   |
| Compiled row Policies                | Authorization normally lives in function code | Policy metadata and SQL pushdown across every projection.            |
| OpenAPI partner API                  | Beta projection over non-reactive HTTP API    | Explicit exposure with Policies, errors, and compiler diagnostics.   |
| End-user MCP tools                   | Operational MCP in reviewed docs              | Explicit application operation projection.                           |
| Provider-selectable file storage     | Convex File Storage or Components             | Files SDK provider handles plus QUESTPIE File records.               |
| OpenTelemetry in the host            | Convex platform logs and integrations         | App-owned OpenTelemetry spans and exporters.                         |
| Data exit                            | Logical export and self-hosted Convex runtime | Normal PostgreSQL data and standard database tooling.                |

If these requirements are not important, a greenfield TypeScript application
that wants reactive data should use Convex. Convex is available now and controls
enough of the system to make its guarantees coherent.

### 28. Embedded host-neutral runtime versus standalone runtime

The current ADRs describe a long-lived runtime that mounts into a host
framework through Fetch adapters. The user has reopened a more opinionated
boundary: QUESTPIE can run as its own backend service and can become the data
plane of a managed QUESTPIE platform.

These are different meanings of neutrality.

- **Embedded host-neutral:** QUESTPIE is a library inside Hono, TanStack Start,
  AdonisJS, Next.js, Elysia, or another host process.
- **Standalone client-neutral:** QUESTPIE owns its server process and protocol.
  Any browser, mobile app, frontend framework, or external backend can call it.

The standalone model does not require QUESTPIE to host the frontend. Convex
also runs the database and function backend while the product frontend can live
on another provider.
[Convex self-hosted architecture](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)

#### Embedded host-neutral runtime

Gain:

- one process for a small application;
- direct access to host middleware and request context;
- host-specific routes can call App Context in process;
- gradual adoption inside an existing backend;
- less control-plane and deployment work for QUESTPIE maintainers.

Loss:

- every host, bundler, request lifecycle, streaming behavior, and deployment
  mode becomes part of the support matrix;
- realtime sockets, workers, graceful shutdown, background execution, and
  telemetry compete with host lifecycle rules;
- one consistent client transport and reconnect protocol become harder to
  enforce;
- the managed product looks like hosting arbitrary user web frameworks rather
  than operating one defined backend data plane;
- host escape hatches can bypass Principal, Mutation, change capture, and
  durable dispatch in the same process.

#### Standalone QUESTPIE runtime

One compiled deployment artifact starts a defined set of services:

- semantic Query, Mutation, Action, and Collection transport;
- Live Query and Channel transport;
- Route dispatch for webhooks and custom HTTP contracts;
- Application, Execution, and Transaction Scopes;
- Job and Workflow workers;
- migration and health endpoints;
- Studio and operational APIs;
- telemetry and deployment metadata.

Gain:

- one lifecycle, transport protocol, cancellation model, and graceful-shutdown
  contract;
- one place to enforce Principal resolution, admission limits, transaction
  rules, realtime positions, and dispatch recovery;
- one deployment unit for local, self-hosted, and managed-cloud operation;
- a much smaller test matrix than several in-process host adapters;
- a direct path to preview deployments, usage metering, logs, backups,
  observability, scaling, custom domains, and a control plane;
- framework-neutral frontend integration remains through the generated client,
  HTTP, OpenAPI, and MCP.

Loss:

- an existing backend cannot call App Context in process;
- custom host-framework code must call the generated client or a public
  transport;
- a separate process adds a network boundary and deployment topology;
- QUESTPIE must own server hardening, protocol compatibility, worker operation,
  upgrades, and self-host documentation;
- local development must coordinate the compiler, runtime, PostgreSQL, workers,
  and frontend;
- the company commits to an infrastructure and control-plane product, not only
  an npm framework.

#### Supabase shows the PostgreSQL-native platform form

Supabase provides a useful second reference. Its architecture keeps PostgreSQL
visible with full privileges and combines separate services for Auth, REST,
Realtime, Storage, Functions, Studio, metadata, connection pooling, and an API
gateway around one PostgreSQL database.
[Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture)

Supabase explicitly states that every project gets a full PostgreSQL database,
not a database abstraction. Users can connect with normal PostgreSQL clients,
run migrations, and use `pg_dump`.
[Supabase database](https://supabase.com/docs/guides/database/overview),
[database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)

Its managed platform provisions PostgreSQL, APIs, Auth, Functions, Realtime,
and Storage. Its self-hosted stack represents one project. Several control-plane
features, including organizations, multiple projects, branching, advanced
metrics, managed backup and point-in-time recovery, and the management API, are
managed-platform features rather than self-hosted data-plane features.
[Supabase Platform](https://supabase.com/docs/guides/platform),
[Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)

This separation is relevant to QUESTPIE:

- the open runtime is the self-hostable data plane for one application;
- the managed service owns organizations, projects, regions, deploys, preview
  environments, secrets, logs, metering, backups, recovery, and billing;
- the App Contract must not depend on the managed control plane;
- the managed control plane can add operational value without changing
  application semantics.

Supabase also states architectural principles that are useful here: tools work
in isolation, integrate through APIs and webhooks, remain extensible, and favor
portable standards such as PostgreSQL, `pg_dump`, and CSV.
[Supabase architecture principles](https://supabase.com/docs/guides/getting-started/architecture#product-principles)

#### PostgreSQL portability must stay separate from runtime ownership

A standalone QUESTPIE runtime does not require a closed database service.

V4 can make these commitments.

1. PostgreSQL remains the semantic database contract.
2. Application Collections compile to normal inspectable PostgreSQL objects.
3. Migrations remain reviewable PostgreSQL SQL.
4. Self-hosted users can connect a supported PostgreSQL deployment.
5. Managed QUESTPIE can provision and operate PostgreSQL for the user.
6. `pg_dump`, logical replication, and normal SQL tools remain valid data paths.

The runtime still needs a concrete PostgreSQL connection implementation. That
implementation does not need to become a public database-provider Adapter or a
database-neutral SPI. Connection URL, TLS, pool mode, prepared-statement mode,
and supported serverless transports can be Runtime Config for the fixed
PostgreSQL contract.

Redis can be an optional internal accelerator for presence, fanout, rate
limiting, or ephemeral coordination. It must not own durable application truth,
transactional dispatch, reconnect positions, or correctness. Removing Redis
must preserve semantics and can only reduce throughput. This rule lets managed
hosting optimize the data plane without adding Redis to the public application
model.

File bytes are a separate physical concern. A standalone Cloud still needs an
object store. QUESTPIE can support one narrow Files SDK or S3-compatible binding
without introducing a general provider system for every Capability. File
records, Policies, relations, and upload state remain in PostgreSQL.

#### Effect on public primitives

The standalone choice simplifies some primitives and does not change others.

| Primitive                         | Effect of standalone runtime                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Collection, Global, Field, Policy | No semantic change. They remain PostgreSQL application resources.                                   |
| Query, Mutation, Action           | Stronger fixed execution and transport boundary.                                                    |
| Route                             | Becomes the only framework-owned custom HTTP primitive. It no longer depends on a host router.      |
| App Context and Scopes            | Remain. Host-framework `createExecution` is no longer public.                                       |
| Service                           | Remains the native-library and external-system integration seam inside the runtime.                 |
| Principal                         | The QUESTPIE ingress and operation transport resolve it consistently.                               |
| Client                            | Uses one QUESTPIE protocol. Frontend-framework adapters remain client libraries, not backend hosts. |
| Runtime Config                    | Supplies deployment bindings. It does not become application composition.                           |
| Host Adapter                      | Removed from the v4.0 primary surface. A later sidecar or embedded profile needs a separate proof.  |
| PostgreSQL Adapter                | Not public. PostgreSQL is the product contract; connection support is runtime implementation.       |
| Redis                             | Optional private accelerator with no semantic effect.                                               |
| Control plane                     | Separate operational product. It is not a Capability or Definition Source.                          |

The standalone choice can also remove some conceptual pressure. There is no
need to model every host framework as an Adapter. There is no host-owned request
context to merge. The compiler emits one server target, one client target, and
one deployment manifest.

It does not remove static composition, ownership, or type generation. Those
remain the way the standalone runtime knows exactly what it must start and
expose.

#### Cloud moat and business implications

Hosting a standalone runtime is not the moat by itself. The managed product
must operate the closed application loop better than a generic container host.

The control plane can own:

- project and organization lifecycle;
- PostgreSQL provisioning, pooling, upgrades, backups, and point-in-time
  recovery;
- deterministic build and deploy from the Compiled Manifest;
- preview environments and migration safety;
- secrets and Runtime Config;
- runtime, worker, realtime, and Studio deployment;
- log, trace, query, transaction, Job, and Live Query diagnostics;
- usage limits, metering, quotas, and billing;
- custom domains and certificate management;
- health, restore, rollback, and version compatibility;
- safe management APIs and operational MCP.

The application contract must remain runnable without this control plane. This
keeps the open-source framework credible and prevents Cloud-only semantics from
entering Collections, Mutations, or clients.

#### ADRs that this choice reopens

The standalone hypothesis does not change accepted ADRs automatically. It
requires an explicit superseding decision.

| ADR                                                                                 | Required review                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ADR 0001](../../adr/0001-smart-backend-product-boundary.md)                        | Change “Smart Backend Framework” to a standalone PostgreSQL application runtime and define the managed platform as a separate product.                                         |
| [ADR 0005](../../adr/0005-bun-node-long-lived-runtime.md)                           | Keep long-lived Bun/Node, but remove the primary Fetch host-integration boundary and define the owned server lifecycle.                                                        |
| [ADR 0008](../../adr/0008-three-primary-package-surfaces.md)                        | Decide whether Cloud/control-plane client packages or a runtime CLI create a real package and release boundary. Do not add packages only for marketing.                        |
| [ADR 0010](../../adr/0010-smart-operations-and-http-routes.md)                      | Keep the operation kinds. Clarify that Route runs in the QUESTPIE runtime rather than a host router.                                                                           |
| [ADR 0014](../../adr/0014-context-shaped-handlers-and-semantic-client.md)           | Keep App Context and semantic client. Fix one owned transport contract.                                                                                                        |
| [ADR 0018](../../adr/0018-three-scopes-and-a-compiled-service-graph.md)             | Keep the scope graph. Remove host-specific execution entry points and define process/worker ownership.                                                                         |
| [ADR 0041](../../adr/0041-live-state-channels-and-http-routes.md)                   | Supersede `app.handle` and host `createExecution` with standalone ingress and Route dispatch.                                                                                  |
| [ADR 0046](../../adr/0046-separate-compiler-config-from-application-composition.md) | Keep compiler config separate. Add a separate deployment manifest; do not turn `questpie.config.ts` into Cloud configuration.                                                  |
| [ADR 0066](../../adr/0066-slice-environment-runtime-slots-at-compile-time.md)       | Keep server/client slicing, but reduce the server target matrix to one QUESTPIE runtime target.                                                                                |
| [ADR 0073](../../adr/0073-let-the-host-own-client-bootstrap-configuration.md)       | Reopen “host owns endpoint.” A self-host deployment or Cloud project can publish bootstrap metadata, while each consumer must still select credentials and an endpoint safely. |

The following central decisions remain compatible and do not need reopening
only because the runtime becomes standalone:

- static application composition;
- explicit resource identity, ownership, and Augmentation;
- the concrete generated App Contract;
- PostgreSQL as the v4 Data platform;
- Query-observed realtime;
- Mutation-owned transaction and durable dispatch;
- Principal independent from Auth;
- optional Studio rather than operator-app framework.

#### Recommendation on the hosting boundary

The standalone data-plane hypothesis is stronger than the embedded-host
hypothesis if QUESTPIE intends to sell managed hosting and to promise
Convex-quality realtime and durable execution.

It gives up in-process incremental adoption. It gains one enforceable runtime,
one test matrix, and one cloud deployment unit. Frontend and client neutrality
remain intact.

The next architecture decision should therefore compare these exact choices:

- embedded runtime with several supported host adapters;
- standalone runtime with public Route and semantic client protocols;
- standalone-first runtime with one explicitly secondary embedded profile.

The recommended bootstrap choice is standalone-only. Add an embedded profile
only after a real application proves that a network boundary is unacceptable
and that the profile can preserve Principal, transaction, dispatch, and
realtime semantics.

### 29. Four strategic variants

#### Variant A: Standalone PostgreSQL-native Convex semantics

QUESTPIE keeps Query, Mutation, Action, observed-read realtime, generated
clients, Transactional Dispatch, Policies, and Studio. It runs as one defined
backend data plane over normal PostgreSQL.

This is the recommended differentiating direction. It is also the hardest.

Gain:

- strong product identity;
- native PostgreSQL data ownership;
- framework-neutral clients and compatibility with existing PostgreSQL
  infrastructure;
- one semantic contract for client, Studio, OpenAPI, and MCP.

Loss:

- more complex dependency tracking and change capture than Convex;
- weaker ability to enforce handler determinism;
- a larger operations and support matrix;
- difficult consistent-client and external-writer semantics.

#### Variant B: Embedded PostgreSQL runtime

QUESTPIE keeps the same semantics but mounts inside selected host frameworks.

Gain:

- incremental adoption and in-process host integration;
- fewer standalone deployment services for small applications.

Loss:

- larger lifecycle, transport, bundler, and support matrix;
- weaker managed-cloud boundary;
- more bypass paths around framework ingress and workers.

This is the current accepted direction and is now reopened.

#### Variant C: Use Convex as the Data Engine

QUESTPIE keeps compiler ownership, Policies, projections, and Studio, but stores
data and runs operations on Convex.

Gain:

- mature reactive transactions and clients;
- much less database-runtime work.

Loss:

- abandons the PostgreSQL product contract;
- duplicates Convex code generation and function model;
- weakens the reason for QUESTPIE to exist;
- makes native SQL, existing schemas, and PostgreSQL tooling secondary.

This variant is not recommended.

#### Variant D: PostgreSQL compiler without strong realtime semantics

QUESTPIE focuses on Collections, Policies, schema, generated CRUD, OpenAPI, MCP,
and Studio. Realtime becomes manual invalidation or explicit Channels.

Gain:

- substantially smaller runtime;
- simpler support for native and external PostgreSQL writes.

Loss:

- removes the strongest user-facing semantic improvement;
- moves QUESTPIE closer to ORM, backend framework, and CMS competition;
- weakens the Query, Mutation, Action model.

This is a valid fallback if the realtime tracer fails. It must be positioned as
a different product, not as Convex-like reactivity.

#### Variant E: Stop and use Convex or another framework

If users do not require native PostgreSQL ownership, client and frontend
neutrality, compiled Policies, and open projections, QUESTPIE should not
reproduce Convex.

This is the correct outcome if the existential tracer does not prove the
distinction.

## Part IV: required proof

### 30. Convex comparison tracer

Implement the same bounded Barbershop feature in Convex and in a skeletal
QUESTPIE v4 runtime.

The feature has these resources and operations.

1. `appointments` has Tenant, customer, barber, start, end, and status.
2. A Query returns one policy-filtered reactive appointment page and one
   available-slot count.
3. A Mutation books one slot and must prevent a conflicting booking.
4. The Mutation creates a durable confirmation dispatch in the same commit.
5. An Action sends the confirmation through a fake external provider.
6. A role or Tenant change removes data that the caller can no longer read.
7. A second process writes an appointment directly through PostgreSQL.
8. A client disconnects before commits and reconnects after several commits.

Run these cases.

#### Transaction cases

- Start 100 concurrent bookings for one slot.
- Verify that one booking commits.
- Verify that a constraint or serializable transaction rejects every conflict.
- Verify the visible error contract.
- Force a serialization failure and prove whether QUESTPIE retries user code.
- Put a retry-unsafe Service in the Mutation and verify that QUESTPIE does not
  repeat its effect silently.

#### Durable-effect cases

- Crash after the database commit and before Action dispatch.
- Restart the worker.
- Verify that the confirmation is not lost.
- Deliver the same Job more than once.
- Verify that the external-effect adapter uses an idempotency key.

#### Realtime cases

- Observe a Query whose second read depends on the result of its first read.
- Change the first result so the Query follows a different branch.
- Verify that the new dependency set replaces the old set.
- Change a row so it enters and leaves the first page.
- Verify no gap and no duplicate across loaded pages.
- Revoke a Policy while the subscription is open.
- Verify that hidden data leaves the client without an intermediate leak.
- Update the count and list in one Mutation.
- Verify that the client never shows results from different commit positions.
- Disconnect, commit several changes, and reconnect.
- Verify exact recovery from the last acknowledged position.

#### PostgreSQL interoperability cases

- Write through the QUESTPIE Mutation API.
- Write the same table through sanctioned raw SQL in a QUESTPIE Route.
- Write it through an external PostgreSQL connection.
- State which writes update live Queries and why.
- Inspect the table with `psql` and a normal PostgreSQL tool.
- Remove QUESTPIE runtime metadata and verify that application rows remain a
  readable normal PostgreSQL schema.

#### Type and compiler cases

- Put the base Collection and its authorized Augmentation in different
  Packages.
- Generate the final App Contract and Origin Map.
- Verify that no Drizzle, Kysely, or Convex type appears in public `.d.ts`.
- Measure TypeScript instantiations for a 40-field, three-relation model.
- Generate client, Studio manifest, OpenAPI, and MCP from the same operation
  definitions.

#### Runtime-boundary cases

- Run the same compiled artifact locally and in one isolated hosted
  environment.
- Connect a TanStack client and a non-JavaScript HTTP client without changing
  the backend artifact.
- Run a custom webhook through a QUESTPIE Route.
- Call the runtime from an existing external backend through the generated
  client.
- Restart the operation server while workers and realtime clients are active.
- Verify that lifecycle, reconnect, and dispatch guarantees do not depend on a
  host-framework adapter.
- Compare deployment and bypass paths with the embedded version of the same
  tracer.

### 31. Falsification conditions

Revise or stop Variant A if any of these conditions remain true after the
tracer.

1. A supported Collection Query needs a manual watch list.
2. A normal Mutation can commit data without producing recoverable realtime
   change capture.
3. A reconnect can miss a committed change.
4. Two active client Queries can expose a state combination that never existed
   in PostgreSQL without this weaker rule being explicit in the contract.
5. A Policy change can leave forbidden data in an active client cache.
6. Reactive pagination cannot prevent gaps or duplicates with bounded cost.
7. An automatic transaction retry can repeat an external or local side effect.
8. External PostgreSQL writes are advertised as reactive but can bypass change
   capture.
9. The generated client or App Contract needs recursive framework-wide generic
   expansion comparable to v3.
10. The QUESTPIE implementation has no material source, operations, or data-exit
    advantage over the Convex implementation.

## Recommended decision

Continue with the PostgreSQL-first runtime hypothesis and treat Convex as the
minimum semantic quality bar. Reopen the embedded host-adapter decision. Use a
standalone, self-hostable QUESTPIE data plane as the preferred bootstrap
hypothesis because it gives the runtime one lifecycle and creates a coherent
managed-platform boundary.

Keep these choices.

- Keep Query, Mutation, Action, and Route as distinct kinds.
- Keep observed-read Live Queries as the target.
- Keep Mutation-owned transaction and durable dispatch.
- Keep a concrete generated App Contract and client.
- Keep normal PostgreSQL as the application data platform.
- Keep Principal independent from credential authentication.
- Reduce Admin to Studio and operational inspection.
- Keep frontend and client frameworks independent through generated clients and
  standard projections.
- Keep the managed control plane separate from the open application contract.

Change or clarify these choices before implementation.

- Do not promise automatic Mutation retry for arbitrary native TypeScript.
- Define cross-Query client snapshot semantics.
- Define external and raw PostgreSQL write observation.
- Make reactive pagination a first-class protocol, not a normal cursor plus
  invalidation.
- Prefer isolated owned package state and typed APIs; use Augmentation only when
  shared application data requires it.
- Start with scheduler and Jobs before a general Workflow language.
- Re-evaluate whether a distinct public KV Capability is necessary.
- Keep Better Auth optional behind the Principal boundary unless a concrete
  product requirement proves that Auth must be core.
- Decide whether standalone-only is acceptable for v4.0. Do not keep host
  adapters only because v3 had them.
- Define a self-hosted and managed deployment compatibility contract.
- Keep Redis and other accelerators private and semantically optional.

## Final assessment

Convex does not invalidate the proposed QUESTPIE direction. It invalidates any
claim that the operation vocabulary, generated TypeScript client, or automatic
reactive Query is by itself a unique idea.

Convex also proves why the model works: strong semantics come from restrictions
and total system ownership, not from builder syntax.

QUESTPIE has a reason to exist only if it proves a harder combination:

> native PostgreSQL ownership, a standalone self-hostable runtime, static
> application composition, compiled authorization, durable effects, open
> projections, and Convex-quality reactive operation semantics.

That combination is coherent. It is not yet proven. The tracer above must be a
bootstrap gate, not a late integration test.
