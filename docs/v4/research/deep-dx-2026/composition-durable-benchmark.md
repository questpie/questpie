# Composition and durable-work DX benchmark

> Status: research input, not product authority or a proposed public API.
> Date: 2026-08-26. Sources are official product documentation or the current
> repository. Final QUESTPIE syntax is intentionally absent.

## Question

What can QUESTPIE learn from well-liked configuration, dependency, Auth,
routing, durable-work, and extension systems without weakening its compiler,
Policy, PostgreSQL, or capability boundaries?

The useful unit of comparison is not a helper call. It is a complete vertical:

```text
configuration and secrets
  -> dependency construction and lifetime
  -> request credential verification
  -> Principal -> Context -> Policy
  -> native provider Route and client
  -> cancellation, cleanup, and observability
  -> provider schema and migrations
```

For durable work the corresponding vertical is:

```text
acceptance identity -> schedule -> claim/lease -> fresh attempt authority
  -> retry/cancellation -> optional durable checkpoint -> settlement/recovery
```

## Current QUESTPIE evidence

The accepted boundary is coherent but not yet pleasant:

- ADR-0015 gives a Service stable identity, explicit dependencies,
  `application` or `execution` lifetime, effect classification, lazy coalesced
  creation, and reverse-order disposal. A raw Route owns its execution scope
  through response EOF/error/cancellation. A credential resolver may use one
  application-lifetime external Service and may resolve a Principal, anonymous,
  or a typed ingress failure. It cannot decide Context, Tenant, Authority, or
  Policy ([ADR-0015](../../../adr/0015-freeze-service-route-and-auth-composition.md)).
- ADR-0005 keeps Better Auth's server, client, plugin graph, and credential
  state outside the compiler ABI. Provider tables must still use QUESTPIE's
  migration/fingerprint lifecycle if exposed through an Auth Package
  ([ADR-0005](../../../adr/0005-keep-principal-core-and-auth-outside-the-compiler-abi.md)).
- ADR-0007 admits only explicitly activated, sealed Package Definitions and
  rejects runtime merge, import-order precedence, install-time activation, and
  generic compiler hooks ([ADR-0007](../../../adr/0007-compile-static-composition-before-runtime.md)).
- ADR-0026 keeps one Job Resource, PostgreSQL durable truth, closed generated
  checkpoint commands, and no generic callback checkpoint
  ([ADR-0026](../../../adr/0026-freeze-action-and-unify-checkpointed-work-in-job.md)).

The Team Support Desk Better Auth tracer proves the composition works, while
also proving its friction:

- the Service reads `DATABASE_URL`, `BETTER_AUTH_SECRET`, and trusted-host
  configuration from ambient process state because generated app configuration
  is not projected into Services;
- Better Auth owns a second bounded `pg.Pool` because no public lifecycle-owned
  database adapter can satisfy the provider without exposing QUESTPIE's raw
  pool;
- the app manually pairs one Service, two wildcard Routes, one credential
  resolver, and the native React client;
- a runtime-only dynamic import keeps Better Auth outside the generated Bun
  bundle after the full package graph exposed a bundler defect;
- the Job reconstructs wall time from the process performance clock because
  the attempt exposes no owned clock.

These are recorded as application evidence, not permission for Better
Auth-specific framework helpers
([DX evidence](../../implementation/team-support-desk/DX-EVIDENCE.md),
[Better Auth runtime](../../../../fixtures/team-support-desk/runtime/better-auth.ts),
[Auth Service](../../../../fixtures/team-support-desk/src/auth/service.ts),
[Auth Routes](../../../../fixtures/team-support-desk/src/auth/routes.ts),
[SLA Job](../../../../fixtures/team-support-desk/src/ticket-sla-follow-up-job.ts)).

## Benchmark summary

| System                    | What makes the DX work                                                                                                    | Hidden or explicit authority                                  | QUESTPIE lesson                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Better Auth               | One server object, native handler/API, paired client plugins, schema and hooks                                            | Provider owns Auth HTTP behavior and credential tables        | Preserve native provider pair; integrate lifecycle, configuration, migration evidence, and Principal handoff without wrapping every plugin |
| Effect Config/Layer/Scope | Typed config descriptions, provider substitution, explicit dependency graph, scoped acquisition/release                   | Application supplies Layers and config provider               | Borrow ownership and test substitution; reject exposing Effect's full algebra as QUESTPIE's user model                                     |
| Hono                      | Web-standard Request/Response, tiny route mounting, typed context variables                                               | Registration order and middleware order are runtime authority | Borrow native handler mounting; retain compile-time collision/precedence and reject a mutable middleware chain                             |
| Inngest                   | Ordinary async authoring around named retriable steps, sleeps, waits, and persisted results                               | Hosted durable engine interprets step identity/history        | Borrow progressive disclosure and named durable commands; reject arbitrary callback checkpoints and vague external-effect guarantees       |
| Temporal                  | Strict deterministic Workflow/Activity split, explicit retries, heartbeats, cancellation, history                         | Temporal Service owns durable history and replay              | Borrow precise retry/cancellation documentation and stable command identity; QUESTPIE need not expose a second Workflow language           |
| Trigger.dev               | Small task declaration, run context, AbortSignal, waits, retries, lifecycle hooks, scoped idempotency                     | Trigger platform owns workers and checkpoint/resume           | Borrow approachable happy path and explicit idempotency scopes; reject a broad hook registry and platform-global context bag               |
| Drizzle                   | Custom stored type feels like a built-in and carries driver transforms/codecs                                             | User may emit SQL and must provision PostgreSQL extensions    | Borrow coherent type+codec projection; reject raw SQL/operator callbacks and assumed extension installation                                |
| Prisma                    | Generated client is discoverable; `$extends` adds model/query/result/client capabilities without mutating the base client | Extension order can affect chained query behavior             | Borrow named capability-scoped extension surfaces; reject ordered runtime interception and host-wide patching                              |

## Configuration: describe once, supply at the runtime edge

Effect separates a typed `Config` description from the `ConfigProvider` that
loads values. Its default provider reads environment variables, while tests or
hosts may provide JSON or another provider. It supports composition,
validation, defaults, nesting, and redacted values whose normal string form
does not reveal the secret
([Effect configuration](https://www.effect.website/docs/v3/configuration)).

### Borrow

- A configuration declaration should own decoding, validation, optionality,
  defaults, documentation metadata, and secret/redaction status once.
- The deployment edge should supply values from environment, JSON, a secrets
  manager, tests, or an embedded host without changing application source.
- Missing/invalid configuration should fail readiness with precise paths before
  the first request, unless a Service is explicitly lazy and its delayed failure
  is part of the contract.
- Secrets must remain absent from manifests, digests, generated declarations,
  logs, errors, and Studio values. Structural schema can enter the Build Input;
  runtime values cannot.
- Test replacement should be an ordinary app-construction capability, not
  mutation of `process.env`.

### Reject

- Reading ambient environment variables in every Service.
- A universal `config.get(string)` bag, which loses discoverability and lets
  undeclared runtime dependencies escape compile-time review.
- Secret defaults for anything except visibly local fixture code.
- Making the config provider a Package ordering or middleware mechanism.

### Vertical requirement

Configuration must cover CLI migration/seed commands, generated server start,
direct tests, Routes, application Services, and worker attempts. A design that
only makes `Service.create()` shorter is incomplete.

## Services: deep lifecycle, small projection

Effect Layers describe provided Services and required dependencies, compose
those requirements, and can be scoped. `Effect.acquireRelease` guarantees that
release runs after successful acquisition when the Scope closes
([Layers](https://www.effect.website/docs/v3/requirements-management/layers),
[Scope](https://www.effect.website/docs/v3/resource-management/scope)).

QUESTPIE already owns most of the valuable semantics. The redesign should make
them visible and complete rather than importing Effect wholesale.

### Borrow

- Required dependencies should be visible in the Service definition and
  strongly typed at creation.
- Acquisition and release are one ownership unit. The framework must pass a
  cancellation signal to acquisition and close resources once after all users.
- Tests should replace a dependency at one explicit composition boundary.
- Construction failure, cancellation during construction, disposal failure,
  and Runtime drain need separate documented outcomes.
- A provider adapter should be able to receive a narrow Runtime-owned
  capability when that capability is its legitimate infrastructure dependency.

### Reject

- A public graph-building DSL as powerful as Layer. QUESTPIE's compiler already
  owns one static graph and should keep invalid lifetime/effect edges
  unrepresentable.
- Service locators, ambient tags, or `ctx.services.get(name)`.
- Exposing the raw PostgreSQL pool. Better Auth needs a database adapter/lane,
  not unrestricted access that ordinary Query/Mutation code could reuse to
  bypass Policy.
- Treating `application` as a process or cluster singleton. It remains one
  instance per Runtime instance.

### Unresolved lifecycle facts

The current runtime caches the Promise for application Service creation. A
transient rejected creation therefore poisons that Service for the remaining
Runtime lifetime. The approval packet must choose and document fail-fast cached
failure, safe retry on the next consumer, or explicit readiness-owned eager
construction; this cannot remain accidental implementation behavior.

## Auth: preserve the provider, narrow the handoff

Better Auth's plugin contract can add endpoints, schemas, hooks, middleware,
rate limits, and trusted origins. Server and client plugins are paired by the
same ID, and client endpoints can infer their server plugin surface. Better
Auth recommends separate server and client files
([Better Auth plugins](https://better-auth.com/docs/concepts/plugins)). Its
database layer includes provider schema and hooks; its CLI can migrate the
built-in adapter or generate schema for an ORM-owned migration path
([Better Auth database](https://better-auth.com/docs/concepts/database)). The
native React client points to the auth server/base path and owns reactive Auth
state ([Better Auth client](https://better-auth.com/docs/concepts/client)).

### Borrow

- A reusable Auth integration must preserve the provider's native server
  object, standard handler, typed API, plugin order, and native browser client.
- Server/client pairing is one package-level contract. The user should not have
  to independently remember server plugin and browser inference wiring.
- Provider-native wildcard Routes should mount as one explicit HTTP
  integration surface while QUESTPIE retains compile-time path ownership.
- Session or token verification returns only credential facts. QUESTPIE then
  constructs Principal, re-resolves current Context facts, and runs Policy.
- Provider unavailable, malformed/invalid credential, absent credential,
  conflicting credentials, cancellation, and handler failure must remain
  distinguishable and observable without disclosing secrets.

### Reject

- A core Better Auth dependency or compiler model of every Better Auth plugin.
- Provider session roles or tenant hints as Policy authority. Team Support's
  Context re-read is the correct pattern.
- Better Auth's middleware ordering as QUESTPIE authorization ordering. Better
  Auth itself distinguishes hooks that apply to direct calls from middleware
  that only runs through client API requests; QUESTPIE cannot let this become a
  second Policy path.
- A `credential.cookie`, `credential.apiKey`, or `betterAuth()` convenience
  family before one primitive proves custom cookie, API key/JWT, provider
  handler, Package distribution, testing, and failure precedence.
- A second migration authority. Provider schema must either project into the
  QUESTPIE migration/fingerprint lifecycle or have an explicitly bounded,
  reviewed external-schema contract that cannot claim unified drift safety.

### Credential precedence must be explicit

The full design must answer these hostile cases before syntax:

1. valid cookie plus invalid integration key;
2. two valid credential mechanisms naming different Principals;
3. provider timeout while another mechanism is absent;
4. malformed credentials versus no credentials;
5. a credential resolver cancellation racing Runtime drain;
6. direct invocation, which must never replay network credentials;
7. credential logs and metrics that reveal mechanism/outcome but no token.

No failure may silently downgrade to anonymous. Precedence must derive from a
closed declaration, not source order.

## Route integration: native HTTP without mutable middleware authority

Hono demonstrates the appeal of small Web-standard handlers, mountable
sub-applications, and typed request context. It also makes middleware execution
and route grouping registration-order-sensitive
([Hono routing](https://hono.dev/docs/api/routing),
[Hono middleware](https://hono.dev/docs/guides/middleware)).

### Borrow

- Accept a standard `(Request) -> Response` provider handler without wrapping
  every provider endpoint.
- Keep literal mount/prefix, method coverage, limits, credentials mode, and
  native response behavior visible at the QUESTPIE Route boundary.
- Make composition readable as one integration rather than two nearly
  identical GET/POST wrappers plus a hidden Service lookup.

### Reject

- Runtime route registration or order-sensitive middleware.
- Typed context variables as an ambient substitute for Principal/Context.
- Provider middleware that can call data or elevate authority before the
  explicit `ctx.execution` transition.

The same transport-projection research must decide when a semantic
Query/Mutation/Action receives generated HTTP/OpenAPI projection and when raw
Route remains correct. Auth callbacks, webhooks, streaming, and provider-native
protocols remain raw Route jobs.

## Jobs and checkpoints: simple first, exact underneath

### What competitors get right

Inngest presents named steps, durable sleep/wait, persisted step results, and
independent retries. Its docs explicitly tell authors to keep non-deterministic
side effects inside steps and still require application idempotency because a
write can succeed before its response is observed
([Inngest steps](https://www.inngest.com/docs/learn/inngest-steps),
[Inngest retries](https://www.inngest.com/docs/guides/error-handling),
[Inngest idempotency](https://www.inngest.com/docs/guides/handling-idempotency)).

Temporal separates deterministic Workflow code from failure-prone Activities.
Activities retry by default; Workflow executions do not. Activity cancellation
is delivered through heartbeats, heartbeat details can persist incremental
progress, and replay checks generated commands against history
([Temporal retries](https://docs.temporal.io/encyclopedia/retry-policies),
[Temporal cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation),
[Temporal Activities](https://docs.temporal.io/activities),
[Temporal replay](https://docs.temporal.io/workflow-execution)).

Trigger.dev keeps the ordinary task shape small, exposes an AbortSignal, retry
settings, cancellation hooks, attempt lifecycle, durable waits, and
run/attempt/global idempotency scopes. Its own docs note that `onCancel` is not
called for queued or suspended runs, an example of why cancellation guarantees
must be exact rather than implied
([Trigger tasks](https://trigger.dev/docs/tasks/overview),
[Trigger waits](https://trigger.dev/docs/wait),
[Trigger idempotency](https://trigger.dev/docs/idempotency)).

### Borrow

- Documentation starts with a Job whose handler is just application code. It
  introduces retry, cancellation, manual heartbeat, and checkpoints only when
  the application job needs them.
- An AbortSignal should compose with fetch, timers, and libraries. The docs
  must say what Runtime operations observe automatically and what happens when
  user code ignores cancellation.
- Automatic worker heartbeat is infrastructure. Manual heartbeat is an
  optional progress/cancellation checkpoint for long CPU/batch work, not
  ceremony at the top of every handler.
- Attempt time must come from a Runtime-owned clock. Absolute scheduling and
  in-attempt current time must not require ambient `Date.now()` or a
  `performance` reconstruction.
- Idempotency identity and scope need names and examples: acceptance identity,
  per-run checkpoint identity, retry attempt, and external Action effect
  identity are different things.
- Checkpoint docs must state stored command digest, output/receipt, retry unit,
  cancellation behavior, code compatibility, and ambiguity after an external
  effect.

### Reject

- Inngest-style arbitrary `step.run(async () => ...)`. It cannot provide a
  closed command identity or prove what code/effect is replayed. ADR-0026's
  named generated Mutation/Action/sleep/signal language is the stronger seam.
- A second public Workflow Resource merely because a Job adds checkpoints.
- A universal trigger/hook array that mixes cron, event, collection change,
  webhook, and direct acceptance without one identity/run-as/input contract.
- Claiming exactly-once provider effects from a persisted step result. An
  unknown external outcome remains ambiguity unless the provider supplies a
  reliable idempotency/receipt lookup contract.
- Temporal's full replay programming model or Trigger's global lifecycle-hook
  surface as QUESTPIE's mental model.

## Package authoring: activate capabilities, do not install magic

Better Auth plugins are attractive because one plugin can pair server/client
behavior and schema. That breadth also shows why QUESTPIE must not treat a
vendor plugin object as compiler authority. Drizzle custom types combine the
application type, driver representation, codec, and transforms so a custom
column feels built-in; its PostgreSQL extension docs assume the database
extension has already been installed, and permit raw operators/SQL
([Drizzle custom types](https://orm.drizzle.team/docs/custom-types),
[Drizzle PostgreSQL extensions](https://orm.drizzle.team/docs/extensions)).
Prisma Client extensions provide named `model`, `client`, `query`, and `result`
components on a derived client rather than mutating the base client, but chained
query extensions execute in order
([Prisma Client extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions)).

### Borrow

- An explicitly activated Package should contribute a coherent capability:
  owned Definitions, exact requirements, runtime implementation, generated
  server/client types where legitimate, migrations, and documentation.
- A stored type must own TS value, canonical wire bytes, PostgreSQL type,
  driver codec, migration/fingerprint identity, allowed operators, indexes,
  and generated-client projection together.
- Provider packages should expose native provider exports alongside their
  QUESTPIE composition; installation alone activates nothing.
- Package requirements must be narrow and typed: required PostgreSQL extension,
  required host config keys, accepted Resource references, runtime packages,
  and compatible QUESTPIE version.
- Activation must produce reviewable inventory and migration diffs before
  runtime.

### Reject

- Runtime `$extends`, middleware chaining, last-wins patching, or host-wide
  prototype augmentation.
- Raw SQL, arbitrary DDL, compiler callbacks, install hooks, or a generic
  provider registry.
- One universal extension API for stored scalars, Auth, PostGIS, full-text,
  pgvector, transport, and Jobs. Their invariants differ too much.
- A Package-local migration table or hidden provider migrator that bypasses the
  app's accepted migration/fingerprint authority.

## Cross-cutting borrow/reject rules

### Borrow

1. **Progressive disclosure:** the common path should read like the application
   job, while ownership facts are inspectable and documented.
2. **Native pairing:** preserve provider-native server/client surfaces and
   ordinary Request/Response integration.
3. **Static capability projection:** each handler sees only what its execution
   kind can safely use.
4. **One declaration of truth:** config schema, dependency, codec, operation,
   migration, and idempotency facts must not be repeated in adapters.
5. **Test substitution:** config and provider dependencies replace at a typed
   construction seam without global mutation.
6. **Explicit failure vocabulary:** absence, denial, invalid input, outage,
   cancellation, retry, and ambiguity remain distinct.
7. **Generated discoverability:** Package or provider pairing should produce
   exact named types and editor navigation rather than string registries.

### Reject

1. Runtime registration order as authority.
2. Universal builders or capability bags with invalid combinations.
3. Ambient env, clocks, service locators, raw database access, or untracked
   dynamic imports in application code.
4. Vendor Auth/ORM roles as QUESTPIE Policy authority.
5. Hidden migrations or extension installation.
6. Arbitrary durable callbacks presented as replay-safe checkpoints.
7. Convenience APIs proven by only one fixture.

## Approval questions

No public syntax should be selected until these are answered.

### Configuration and Service

1. Is configuration validated eagerly at generated app creation, lazily per
   Service, or both through an explicit declaration?
2. Which runtime providers are supported initially, and how do tests supply
   values without ambient environment mutation?
3. Are secret values represented by a redacted wrapper, and which exact sinks
   may unwrap them?
4. Does application Service construction failure remain cached, retry on next
   use, or make the Runtime unready?
5. Which narrow Runtime-owned capabilities may Services request, especially
   database adapters, and how is Policy-bypass prevented?
6. How are runtime-only npm dependencies declared, verified, bundled/external,
   and included in deployment integrity?

### Auth and Route

7. Can one integration own a provider handler mount plus credential
   verification without creating a new Auth Resource or middleware registry?
8. How are multiple credential mechanisms declared and how are conflicts,
   precedence, and anti-downgrade behavior compiled?
9. What exact ingress failure taxonomy is public, observable, and safely
   redacted?
10. How does a reusable Auth Package pair its native browser client types with
    server plugins while remaining outside `#questpie/client` authority?
11. How does provider schema enter one migration/fingerprint lifecycle without
    forcing QUESTPIE to understand arbitrary provider plugin internals?
12. Does a raw provider handler mount own one route prefix/method set, and how
    are overlap, limits, direct invocation, and response lifetime represented?

### Job and checkpoints

13. What is the smallest Job happy-path context, and which controls appear only
    after authoring retry/cancellation/checkpoint behavior?
14. What does automatic heartbeat guarantee, when is manual heartbeat useful,
    and what is the cost/failure result of calling it?
15. Which Runtime clock facts are exposed to an attempt, and how do they relate
    to accepted `notBefore`, deadline, and PostgreSQL transaction time?
16. Which named Query/Mutation/Action commands belong in the closed checkpoint
    language, and may ordinary Jobs perform a narrower current-state read?
17. How are checkpoint compatibility, command digest, result retention,
    cancellation, and external-effect ambiguity explained to a beginner?
18. Which cron/event/collection causes eventually accept a Job directly, and
    can they share one input/idempotency/run-as contract without a second Event
    relay?

### Package

19. What exact Package contract can compile independently yet activate against
    a wider host without seeing undeclared host Resources?
20. Which capability-specific Package vertical should prove the seam first:
    Better Auth, one custom stored type plus PostgreSQL extension, or another
    real consumer?
21. How are Package config, runtime dependencies, migrations, generated types,
    and native exports reviewed as one activation?
22. What is the vendoring/deactivation story when an app must customize a
    sealed Package-owned Definition?

## Recommended next design evidence

Before an approval packet, exercise three materially different adapters against
one proposed deep primitive:

1. Better Auth with native server handler, native React client, provider tables,
   config/secrets, and a database adapter;
2. custom signed cookie or API-key authentication with no provider schema and
   explicit multi-credential conflict cases;
3. a non-Auth external provider Service used by Route and Action, proving that
   the primitive is composition rather than an Auth-specific shortcut.

For durable work, use one short retryable Job, one long cancellable batch Job,
and one checkpointed Job containing a Mutation, an Action with ambiguous
outcome, durable sleep, and restart recovery. Design documentation should show
the short version first and explain every advanced control only where it earns
its place.

The approval outcome should be a small set of ownership guarantees and complete
vertical examples—not a list of prettier helper names.
