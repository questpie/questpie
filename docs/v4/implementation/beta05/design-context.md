# BETA-05 implementation context

Issue [#292](https://github.com/questpie/questpie/issues/292) implements one
bounded Runtime/client vertical for the accepted collaboration Message page.
It does not implement the later realtime, durable, Studio, Route, Auth, host,
or split-role slices.

## Tracer

The fixture owns one semantic `query:messages.page` Resource whose handler runs
the accepted `channelMessagePage` structural plan through `ctx.data.run`.
`app.execution`, `app.fetch`, and the immutable generated client scope call
that same Resource through one Context, Policy, relational, result, and event
engine. Principal is explicit for direct execution and is supplied by a
private ingress binding for Fetch; it never appears in the request body.

The first hostile changes either the generated client contract digest or a
Runtime Build binding. Both must fail before Context resolution, bootstrap,
the handler, or PostgreSQL reservation.

## Owned artifacts and protocol

BETA-05 emits current-application instances of the accepted versioned shapes:

- an immutable Runtime Build inventory and statically paired Query executable
  slots;
- `questpie.operation-wire` version 1 at `/_questpie/operation` with media type
  `application/vnd.questpie.operation+json;version=1`;
- executable generated App and client modules;
- a combined-role Runtime lifecycle/readiness-and-drain trace; and
- the safe BETA-05 subset of Execution Envelope events.

The operation request has exactly `application`, `callId`,
`clientContractDigest`, `context`, `input`, `operation`, `protocol`,
`timeoutMilliseconds`, and `wireDigest`. Result, declared-error, framework
failure, and pre-operation rejection frames remain closed. The framework
failure codes are `APPLICATION_MISMATCH`, `CLIENT_OUTDATED`,
`DEADLINE_EXCEEDED`, `INTERNAL`, `NOT_FOUND`, `PROTOCOL_UNSUPPORTED`,
`RESOURCE_LIMIT`, and `RUNTIME_UNAVAILABLE`.

Accepted P6 literal digests bind later Change Ledger and durable artifacts that
do not exist yet in the dependency-ordered beta.1 implementation. BETA-05
therefore preserves the accepted artifact schemas with current compiler-owned
digests and exact `null` absences for those not-yet-owned compatibility
dimensions. It never fabricates a ledger, resume, Reaction, or durable claim.

The Runtime Build binds the current Application, Manifest, App Contract,
Package Inventory, Schema, migration head, Policy/Query/PostgreSQL plan,
operation wire, executable inventory, compiler/Bun/runtime ABI, and internal
protocol. Runtime load checks an exact slot bijection before evaluating a
handler or becoming ready. No callback registry or runtime source discovery is
public.

## Lifecycle and limits

Startup owns the currently implementable ordered subset of the accepted P6
phases and records explicit absence for deferred reconciliation owners.
Readiness is false until build, application/schema/migration, wire, executable,
and PostgreSQL checks succeed. A not-ready or draining Runtime refuses roots.

Drain makes readiness false first, refuses new roots, waits owned work until a
30,000 ms default deadline, aborts remaining Executions, waits cleanup,
disposes application Services in reverse order, emits its terminal event, and
stops. `close` is idempotent. The Runtime enforces 64 active roots per canonical
Principal identity across direct and Fetch callers.

Deadline abort uses the existing Execution signal. A client disconnect aborts
the root and exposes no new framework code. Query response loss proves one
attempt and no automatic client retry; Mutation receipt recovery remains owned
by BETA-06.

## Event boundary

BETA-05 emits append-only in-memory events through one injected sink. It claims
no durable Studio event store. The implemented closed event subset is Runtime
`ready`, `drainStarted`, `drainTimedOut`, and `stopped`, plus Operation
`accepted`, `result`, and `failed`. Every event uses the accepted Execution
Envelope version 1, monotonic owner sequence, sorted safe links, and excludes
credentials, database URLs, raw payloads, relational evidence, serialized
Context, Service state, secrets, and stack traces.

## Non-goals

No raw Route, WebSocket, host/provider adapter, split Runtime role, automatic
Mutation retry, durable event persistence, Studio, Change Ledger, Reaction, or
generic operation/plugin registry enters this slice. `testkit` remains private
and gains nothing until a second real caller needs a shared helper.
