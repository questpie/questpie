---
title: Run and deploy QUESTPIE
description: Build one immutable application, apply reviewed migrations, and operate the standalone Runtime.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - immutable Runtime bundle produced by questpie build
  - explicit migration apply before Runtime startup
  - standalone all, api, and worker Runtime roles
  - generated createApp with fetch, execution, and idempotent close
  - immutable Context-scoped generated clients
  - coarse liveness and readiness endpoints
  - ordered drain for Operations, realtime sessions, and durable attempts
  - separate schema, wire, realtime, and durable deployment compatibility
  - local and managed PostgreSQL conformance without a provider SPI
proof-blocked-contracts:
  - exact bundle directory, file inventory, checksums, and Runtime ABI artifact
  - exact Fetch path, frame, error union, limits, and client compatibility window
  - exact health paths, response bodies, lifecycle states, role names, and exit codes
  - graceful timeout, remote drain, split-role wake, lease, and shutdown behavior
  - commit-safe realtime frontier, resume retention, and deployment reset behavior
  - pending durable-run executable retention and Workflow evolution
  - local PostgreSQL and managed Supabase provider conformance
  - build, cold-start, memory, generated-size, and TypeScript budgets
  - focused Runtime and deployment Opus-medium acceptance review
---

> ADR-0026 supersedes Workflow evolution references with Job checkpoint
> history and executable compatibility.

# Run and deploy QUESTPIE

The normal QUESTPIE deployment has three steps: build one matched application
bundle, apply its reviewed migration chain, and start the standalone Runtime.
You do not write a server entrypoint, register a worker, or select a host or
database adapter in application code.

```bash
bunx questpie build --out dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie migration apply --bundle dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie start --bundle dist/questpie --port 4000
```

The default process owns the API, compiled Routes, Live Query sessions and
reconciliation, durable dispatch, schedules, and Reaction and Job attempts.
One immutable bundle and one PostgreSQL application remain the meaning of all
those surfaces.

## Build one matched application

`questpie build` performs the structural compile, deterministic second compile,
runtime graph typecheck, executable bundling, generated declaration checks, and
artifact verification before it publishes `dist/questpie`. A failed build does
not replace the last complete output.

The candidate bundle contains the accepted artifacts and the additional
runtime projections needed to load them together:

```text
dist/questpie/
  manifest.json
  schema-projection.json
  origin-map.json
  build-input.json
  app.ts
  client.ts
  runtime-build.json
  wire-contract.json
  checksums.json
  server/
  internal/
```

These files do not collapse into one vague bundle version:

| Artifact                 | What it proves                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| `manifest.json`          | exact Resources, Owners, accepted Augmentations, and semantic contracts  |
| `schema-projection.json` | desired PostgreSQL objects used by migration planning and Drift          |
| `origin-map.json`        | current source locations for generated behavior and diagnostics          |
| `build-input.json`       | the configuration, Package, source, Bun, TypeScript, and lockfile inputs |
| `app.ts`                 | the concrete generated server App Contract                               |
| `client.ts`              | the browser-safe network-exposed App Contract                            |
| `runtime-build.json`     | candidate Runtime ABI, executable slots, and their semantic bindings     |
| `wire-contract.json`     | candidate versioned operation and realtime wire projection               |
| `checksums.json`         | candidate complete file-integrity inventory                              |

An Origin-only source move may change `origin-map.json` without changing a
Query wire contract or the Schema Projection. Conversely, a Policy or handler
change may leave PostgreSQL schema unchanged while invalidating an observed
Live Query plan. Deployment checks compare the fact that owns each guarantee;
one coarse bundle checksum is not used as every compatibility answer.

Runtime startup loads the generated bundle. It does not evaluate source,
discover installed Packages, merge Modules, or bind a handler by a string from
application code.

## Apply reviewed migrations explicitly

A build does not mutate PostgreSQL, and `questpie start` never creates or
applies schema work. Review and commit migrations through the one accepted
lifecycle before deployment:

```bash
bunx questpie migration plan --name add-message-delivery

export PLAN_DIGEST='<digest printed by migration plan>'
export PLAN_FILE=".questpie/plans/$PLAN_DIGEST.json"

bunx questpie migration create --plan "$PLAN_FILE"
git add questpie/migrations
```

The deployment applies only the Committed Migration chain inside the bundle:

```bash
DATABASE_URL="$DATABASE_URL" \
	bunx questpie migration apply --bundle dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie schema drift --bundle dist/questpie
```

Apply verifies Application Identity, the linear history, every migration
checksum, the live base Schema Fingerprint, and the target fingerprint. Every
v1 migration and its immutable Migration Receipt commit in one PostgreSQL
transaction. If the success response is lost, retrying the same command returns
`alreadyApplied`; it does not execute the SQL twice.

A pending migration, checksum mismatch, unknown applied migration, or Drift is
not a readiness condition that `start` repairs. Deployment stops with the
accepted schema diagnostic and its recovery command.

## Start the standalone Runtime

The normal application has no `src/server.ts`, `worker.ts`,
`defineRuntime({...})`, `bunHost()`, or `postgresProvider()`:

```bash
# API, realtime reconciliation, schedules, and durable workers.
bunx questpie start --bundle dist/questpie --port 4000
```

The default role is the first conformance target. A deployment may later split
the same bundle into two process roles:

```bash
# Fetch, Routes, generated protocol, and Live Query sessions.
bunx questpie start --bundle dist/questpie --role api --port 4000

# Dispatch reconciliation, schedules, and Reaction/Job attempts.
bunx questpie start --bundle dist/questpie --role worker
```

`api` and `worker` are lifecycle choices, not application Resources or provider
plugins. No handler branches on the active process role. Split roles must not
be advertised until their cross-process wakes, reconciliation, leases,
readiness, and shutdown behavior pass the same crash tests as the default
process.

Startup is observable and fail-closed:

```text
load bundle
  -> verify files, artifact versions, and cross-digests
  -> connect to PostgreSQL and verify its concrete profile
  -> verify internal protocol, migration head, and Schema Fingerprint
  -> start the owned listener, reconciler, scheduler, and worker loops
  -> reconcile durable Change Ledger and dispatch state
  -> ready
```

No request is accepted before `ready`. A corrupt bundle, incompatible Runtime
ABI, wrong Application Identity, schema mismatch, missing PostgreSQL feature,
or incompatible collation blocks startup instead of producing a partially
running application.

## Use the immutable generated client

The generated browser client owns the versioned transport. The application
provides its base URL and credentials, then creates an immutable Context scope:

```ts title="web/messages.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "https://api.example.com",
	credentials: "include",
});

const company = client.withContext({ companyId });

const page = await company.queries["messages.page"](
	{ channelId, first: 20, after: null },
	{ signal: AbortSignal.timeout(5_000), timeoutMs: 5_000 },
);
```

`withContext` returns a new view. It never mutates `client`, cookies, global
headers, or another request's scope. Two server-rendered requests or two panes
can safely use different Context values concurrently:

```ts
const northwind = client.withContext({ companyId: northwindId });
const contoso = client.withContext({ companyId: contosoId });

const [northwindPage, contosoPage] = await Promise.all([
	northwind.queries["messages.page"](northwindInput),
	contoso.queries["messages.page"](contosoInput),
]);
```

The author does not map `companyId` to a header, body property, socket frame, or
resume token. The generated protocol carries the exact compiled Context input.
Credential Auth separately resolves cookies or tokens into Principal. Context
Resolution validates the untrusted `{ companyId }` and derives Tenant; Policy
still rechecks mutable membership in the owning snapshot or transaction.

Every other root entry uses that same transport-neutral Context contract:

| Root entry                         | Source of Context input                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| generated client call              | the immutable `client.withContext(...)` value encoded by the generated protocol                               |
| low-level framework Fetch          | the same generated wire envelope; a hand-written caller follows that versioned contract                       |
| direct server or test execution    | the explicit `context` passed to `app.execution(...)`                                                         |
| raw third-party Route              | no invented Context; the Route validates its protocol and explicitly enters application execution when needed |
| Live Query reconnect               | the original typed Context input plus an opaque continuation; Context Resolution runs again                   |
| Reaction, Job, or Workflow attempt | the durable run-as recipe reconstructs typed Context input for a fresh Execution                              |
| Studio application-data call       | its immutable generated-client scope under the operator's explicit Principal                                  |

Nested Operations inherit the resolved Context from their root Execution. They
cannot replace it with another client-supplied value.

The call's `signal` controls local cancellation. `timeoutMs` can request a
shorter server deadline but cannot extend Operation or deployment limits. The
effective deadline is the smallest applicable limit.

## Use the generated App for tests and special embedding

The generated `createApp()` loader exposes the whole intentional low-level
surface: `fetch`, `execution`, and idempotent `close`.

```ts title="scripts/read-messages.ts"
import { principal } from "questpie";
import { createApp } from "#questpie/app";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

try {
	const page = await app.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
			signal: AbortSignal.timeout(5_000),
		},
		({ queries }) =>
			queries.messages.page({
				channelId,
				first: 20,
				after: null,
			}),
	);

	console.log(page.nodes);
} finally {
	await app.close();
}
```

`createApp()` loads generated output and opens application-owned Runtime
resources. It does not compile source. `app.execution` creates one root
Execution, runs Context Resolution, supplies the exact generated server
operation map, and disposes execution-scoped Services after the callback. Its
ordinary input has no System Authority option.

The same generated object accepts standard Fetch values:

```ts
const response = await app.fetch(request);
```

`app.fetch` owns the generated QUESTPIE protocol and compiled Routes. It returns
a standard `Response`; it is not a Hono, Elysia, Next.js, Express, or
Cloudflare adapter. A deliberate embedder may forward a Request to this seam,
but it owns its outer server, stops ingress first, and then calls
`await app.close()`. QUESTPIE does not promise lifecycle parity across a host
adapter matrix.

## Know where the types come from

| Code                                     | Exact contextual type source                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `createClient` operation members         | network-exposed Resources in the generated App Contract                            |
| `client.withContext(...)`                | the one compiled Context input contract                                            |
| Query input, result, and declared errors | the concrete compiled Operation codec and wire digest                              |
| call `signal` and `timeoutMs`            | generated common invocation options narrowed by Operation limits                   |
| `.watch` result and delivery             | the same Query output plus the generated realtime delivery union                   |
| `createApp()`                            | the generated Runtime loader for this exact application bundle                     |
| `app.execution` input and callback       | compiled Context input and concrete generated server App Contract                  |
| `app.fetch`                              | standard `Request` and `Response`; generated protocol and Route matcher internally |

An unknown Context key, server-only client Operation, invalid Operation input,
or unsupported lifecycle option fails in TypeScript. The generated declarations
contain no public ORM type, application-wide recursive generic, ambient
registry, `any`, or fallback operation-name `string`.

## Health, readiness, drain, and shutdown

The Runtime exposes one coarse liveness concept and one coarse readiness
concept. The exact paths remain proof-blocked candidates:

```text
GET /_questpie/health/live
GET /_questpie/health/ready
```

- Liveness means the process can run and report lifecycle state. It remains
  true during drain until exit and does not query every dependency.
- Readiness means the selected role can accept its work. It is false during
  startup, incompatible database state, dependency degradation, excessive
  unreconciled lag, and drain.
- Public responses contain only coarse status and a stable reason class. They
  never reveal a database URL, Principal, Tenant, payload, source path, stack,
  Package inventory, or internal object name.
- Detailed evidence belongs to authenticated `questpie status`,
  `questpie explain`, and Studio.

`SIGTERM`, `SIGINT`, or the narrow authenticated drain command begins the same
idempotent lifecycle:

1. Mark readiness false and reject new root Operations, Routes, watches,
   schedules, and worker claims with a retryable draining reason.
2. Stop acquiring reconciliation work while keeping already-owned worker
   leases and heartbeats alive during the grace period.
3. Let in-flight Queries, Mutations, Actions, Routes, streams, and attempts
   finish within their existing deadline and the smaller shutdown deadline.
4. Close Live Query sessions with an opaque retryable continuation or reset
   reason; PostgreSQL's Change Ledger remains recovery authority.
5. Abort remaining signals. A pre-commit Mutation rolls back. A committed
   Mutation or accepted external effect is never described as undone.
6. Fence timed-out worker completion. Another worker may reclaim the same
   logical run only after the old lease can no longer commit a transition.
7. Dispose execution-scoped Services, application Services, listeners, pools,
   exporters, and the outer server in owned order.
8. Emit the terminal lifecycle event and exit distinctly for graceful success
   or forced timeout.

`app.close()` is idempotent and owns the same inner disposal order. An embedder
owns only the preceding step of stopping its external ingress.

## Deploy, restart, and reset safely

The first honest schema-changing deployment is conservative:

```text
build and verify immutable bundle
  -> stop admitting old work and drain incompatible instances
  -> apply the bundle's committed migration chain
  -> verify target Schema Fingerprint
  -> start the new bundle
  -> reconcile Change Ledger and durable dispatch
  -> become ready
  -> send traffic
```

This may include downtime. Zero-downtime schema evolution requires a proven
old/new read-and-write compatibility artifact; SQL that looks additive is not
enough.

Different changes have different deployment consequences:

| Changed fact                        | Required behavior                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| source Origin only                  | refresh diagnostics; semantic compatibility may remain unchanged                        |
| Query handler or Policy             | invalidate the old observation plan and recompute or reset under the new digests        |
| compatible retained wire contract   | allow the proven old generated client window                                            |
| incompatible Operation input/output | return typed `clientOutdated`; never best-effort decode                                 |
| Schema Projection or migration head | apply explicitly and pass Drift before readiness                                        |
| Context or credential resolver      | create every new Execution under the new version; repartition or reset watches          |
| Reaction or Job with pending runs   | retain a compatible executable or block deployment                                      |
| Workflow with live history          | follow a future pin, patch, or proven evolution rule, otherwise block                   |
| internal Runtime protocol           | run a registered transactional upgrade; never mutate the accepted v1 bootstrap in place |

On ordinary network reconnect, a watch sends an opaque continuation token. A
compatible Runtime either resumes after fresh authorization and ledger
reconciliation or sends one complete fresh `reset` result. A reset cannot make
an old client decode a breaking output contract; that is a typed version
failure.

The first durable deployment rule is similarly strict: removing or
incompatibly changing a Definition referenced by a non-terminal run blocks the
deployment. Accepted work cannot disappear because its current source export
did.

A same-bundle process restart uses the same rule on a smaller boundary: mark
the old instance unready, drain it, start and verify the same immutable bytes,
reconcile the ledger and dispatch state, and only then become ready. Realtime
clients either resume under a proven compatible continuation or receive a
complete reset; durable workers reclaim only through lease expiry and fencing.

## Run against portable PostgreSQL

Local and managed PostgreSQL run the same bundle and migration artifacts:

```bash
# Local PostgreSQL 16+
DATABASE_URL='postgres://postgres:postgres@localhost:5432/collaboration' \
	bunx questpie doctor

# A managed direct or session-capable endpoint.
DATABASE_URL="$MANAGED_DATABASE_URL" \
	bunx questpie doctor
```

The declared PostgreSQL profile fixes the minimum major version, database
collation and ctype, required extensions, and application schema. Planning,
apply, Drift, and Runtime startup verify the facts they need. Migrations and
Seeds require a session that can hold the application lock. Realtime requires
a dedicated session for `LISTEN`; a transaction pooler that cannot preserve it
does not silently receive the same profile.

The first conformance targets are local PostgreSQL and one managed Supabase
PostgreSQL project. Neon, RDS, and other compatible services may pass the same
suite later. Application code never imports a `SupabaseAdapter`,
`NeonProvider`, capture provider, Queue provider, or generic database-engine
SPI.

## Predict deployment failures

| Failure                                      | Required result                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| missing, extra, or changed bundle file       | verification fails before database connection or handler load                             |
| unsupported artifact or Runtime ABI          | startup fails with a structured compatibility diagnostic                                  |
| wrong Application Identity                   | migration and startup fail; the Runtime never adopts another application's schema         |
| pending or unknown migration                 | deployment blocks; `start` never auto-applies or ignores it                               |
| migration checksum mismatch or Drift         | deployment blocks with the accepted recovery command                                      |
| malformed or oversized operation frame       | reject before Context Resolution or handler execution                                     |
| absent, unexposed, or incompatible Operation | nondisclosing not-found or typed `clientOutdated`; never enumerate protected Resources    |
| Runtime starting or draining                 | typed retryable availability result; a client never blindly retries an ambiguous Mutation |
| cancellation before Mutation commit          | roll back and return no success                                                           |
| response loss after Mutation commit          | preserve the committed call identity; never claim rollback                                |
| invalid handler output                       | send no invalid bytes; emit one sanitized correlated failure                              |
| database outage after startup                | readiness false and bounded call failures while liveness can remain true                  |
| drain timeout during external Action         | record cancellation or ambiguous outcome; never fabricate reversal                        |
| stale worker after lease loss                | fence its completion; another attempt owns the logical run                                |

## Keep the Runtime boundary small

QUESTPIE intentionally owns the entire default process lifecycle behind
`questpie start`. It does not ask each application to reconstruct that lifecycle
from a server Definition, host plugin, worker registration, connection
provider, realtime adapter, or Queue adapter.

The low-level Fetch seam exists for tests, special embedding, and incremental
adoption. It is not an invitation to claim equal semantics across every web
framework. Concrete PostgreSQL conformance keeps portability honest without
turning application semantics into the least common denominator of a public
provider SPI.

The next chapter uses the same build artifacts, Runtime state, generated
operations, and append-only events to explain what the application did.
