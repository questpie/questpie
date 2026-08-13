# Transactional Dispatch and Reaction contract

- Status: Accepted
- Projection: verified after independent factual, prose, and example audits
- Date: 2026-08-13
- Scope: Mutation-owned durable acceptance, Reaction execution, attempts,
  leases, fencing, run-as, retry, timeout, cancellation, external-effect
  ambiguity, retention, and executable compatibility
- Authority: ADR-0013 and proof head
  `3f8618613bde1bdd7e13863970eb1c140e201c6f`

## Boundary

This contract accepts P5 only. It is not production Runtime implementation. It
does not accept Job dispatch/scheduling, Workflow, a Queue composition API,
provider-specific Action semantics, the complete Execution Envelope, Fetch
frames, generated transport clients, or Studio protocol.

The foundational proof at `d03358b7` and P1–P3 heads `713485a6`, `5fbd9058`,
and `a09bf55f` remain fixed. P5 starts from P3. It does not merge P4; it pins
P4 head `05fc96f3` and Change Ledger digest
`140fd7ffb43699f9b8b2e986446058acfa679d2d18a33214d559c4bcd0c849e7` as a
fixed sibling transaction/capture contract.

## Authoring contract

`defineReaction` comes from `#questpie/app`. One local exported Definition owns
one Resource Identity and one inline handler. The Definition declares:

- one exact input codec;
- inferred or explicitly pinned validated result bytes;
- one closed declared error map using P3's exact
  `operation.error({ code, status, payload? })` grammar;
- explicit caller run-as with denial behavior;
- one bounded retry program;
- literal effect names used by its handler.

The generated Reaction Context contains immutable Principal, Tenant, Context
values, signal, and deadline; read-only Policy-aware data; generated nested
Mutations; and generated Actions. It has no raw Collection write, dispatch bag,
database handle, request, registry, ambient App generic, or System Authority.

The accepted `messageSubmitted` handler rereads committed Message state, calls
`delivery.sendMessage` with `run.effect("deliver-message")`, then records
application state through `messages.recordDelivery`. The Archive proof uses a
composite `(archiveCode, catalogueNumber)` Record and Research Permit evidence.

## Atomic acceptance

P3's generated `ctx.dispatch.messageSubmitted(input)` remains `Promise<void>`.
Inside the Mutation transaction, its accepted intent creates stable dispatch
and run identities. The Message, Message Event, P4 Change Ledger fact,
transactional audit, dispatch/run state, and Mutation result receipt share one
PostgreSQL transaction. Rollback leaves none.

The scoped idempotency identity contains application, environment, durable
Resource, and a key derived from the originating Mutation call plus static
dispatch slot. The author passes no second dispatch key. The same canonical
payload returns the existing byte-identical receipt and logical run. A
different payload for the same scope fails with `IDEMPOTENCY_CONFLICT`.

`LISTEN`/`NOTIFY` is a wake hint. A crash after commit and before wake leaves a
ready PostgreSQL run that reconciliation discovers. That same commit already
contains the Change Ledger fact used by P4 Live Query reconciliation.

## Identity and execution

| Identity              | Lifetime                                                       |
| --------------------- | -------------------------------------------------------------- |
| dispatch identity     | one immutable acceptance fact                                  |
| run identity          | one logical Reaction across retry and lease recovery           |
| attempt identity      | one physical handler attempt                                   |
| lease token           | opaque ownership fence for one claim                           |
| effect identity       | Resource, run, and literal effect name; stable across attempts |
| cancellation identity | one durable cancellation request                               |
| causation identity    | Operation or dispatch that caused the run                      |
| correlation identity  | wider observation grouping; never authority                    |

A worker claims at most 64 ready rows in one admission batch. Each individual
claim uses `FOR UPDATE SKIP LOCKED`, writes an attempt plus a 30-second lease,
and commits before the handler. A long handler heartbeats every 10 seconds. Its
attempt deadline is five minutes.

Every heartbeat and terminal transition compares both current attempt and
lease token. After lease expiry, another worker creates a new attempt and token.
The stale worker cannot heartbeat, publish success, schedule retry, or win a
cancellation race.

## Fresh caller authority

Acceptance persists only Context input, ordinary Authority class, Principal,
Tenant, and original-actor references. It does not persist credentials,
requests, resolved Context, a Service, database handle, or System fallback.

Every physical attempt builds one fresh root Execution. It resolves Context
once and evaluates current Policy evidence. Revoking the caller's Membership
before an attempt makes that attempt terminal with `RUN_AS_DENIED`. Worker
location and Queue ownership grant no authority.

## Retry, cancellation, and external effects

The declared Reaction retry program has eight attempts, 1-second exponential
backoff, a 15-minute cap, full jitter, and a 24-hour retry horizon. Validation
errors, declared Reaction errors, and run-as denial are permanent. Exhaustion
and permanent failures create a safe inspectable dead letter.

Cancellation before claim prevents the handler. Cancellation during a handler
sets durable intent, makes heartbeat observe cancellation, and competes with
success through one fenced compare-and-set transition. Cancellation cannot
recall an external request that a provider already accepted.

An Action call never runs inside the Mutation or claim transaction. Every
attempt uses the same stable effect identity for the same logical effect. A
provider idempotency receipt can recover a lost response. Reusing the effect
identity with different canonical input conflicts. Without idempotency or a
reliable lookup contract, response loss becomes `ambiguous`; QUESTPIE does not
claim exactly-once effects.

## Limits, retention, and executable compatibility

| Budget                        | Accepted default |
| ----------------------------- | ---------------: |
| active attempts per Principal |               16 |
| claim batch                   |               64 |
| pending runs per Resource     |          100,000 |
| dead letters per Resource     |           10,000 |
| events per run                |            1,024 |
| payload bytes                 |          262,144 |
| result bytes                  |          262,144 |
| retry horizon                 |    86,400,000 ms |
| attempt history               |          30 days |
| idempotency identity          |           7 days |
| terminal payload/result       |           7 days |

Limit failure is `RESOURCE_LIMIT`. Retention may erase payload, result,
idempotency body, and old attempt history. It preserves the minimal dispatch,
run, causation, correlation, terminal, and audit identities needed to explain
the work.

A run stores its Runtime Build identity and required executable digest. The
artifact keeps the matching executable bytes while any nonterminal run
references them. Readiness fails if those bytes are missing or incompatible.
Drain stops new claims, then lets current claims finish or leases expire.

## Events and database boundary

Each durable transition appends an event with sequence, timestamp, Resource,
dispatch, run, attempt, lease-token digest, causation, correlation, kind, and a
safe error code when applicable. Events contain no raw payload, credential,
secret, or stack trace. P6 will place these bodies inside the complete versioned
Execution Envelope and expose the minimal Studio read/maintenance protocol.

The PostgreSQL proof rejects direct application/worker writes to run, attempt,
event, and dispatch state. It reports 27 indexes, all B-tree, no expression or
partial index, and zero RLS-enabled tables. P5 adds no new Index authoring
authority and makes no RLS claim.

## Accepted proof

Proof head `3f8618613bde1bdd7e13863970eb1c140e201c6f` passed a replacement fresh
focused Opus-medium review against clean repaired input head
`cc59669736ecf31383ee9da268a40de07016760f`. The earlier acceptance head was
superseded after the public-example audit exposed an error-codec drift from
P3; repair commit `4eff26d9` imports and proves P3's exact operation grammar.

Canonical P5 digests:

| Artifact                | Digest                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Reaction                | `0b38149064362b5aebe258c18a689c74add8d759eccd76a1ccbadf8910cd5173` |
| Transactional Dispatch  | `864e3364ba8991cebae5ac83ecbc4f12d012bdf698e60e19ca4d7bdf7015de0d` |
| identities              | `2686b7dfa450bccdcc6b547c3a93d3dd55ed2f678303c8140780db8aae315225` |
| run-as                  | `5ac885959e885891eeccdf83b97df8721197107ae81081229d779d3053af5452` |
| retry                   | `c46baa4bd712d96aff8dad6a84675884ce4b9ea4a601f607efe3da570cc88253` |
| lease                   | `5875d4b1e593ba570861cd790c902b528d5caa735b6698e3967f0ff85f3bbbf6` |
| effect                  | `64b9efc3e9390bc6027c4a13be418811d2168cf25d8f0a173330b8ca5d29ae14` |
| compatibility/retention | `dc632931c2ce0b384ee7cda44785e9d310e0d9c896e32bc80e9c1ffcdc998f11` |
| limits                  | `46bf28ead69d6c3a219c47169fdbe2346eb12d967565437bf82ba7aaaa96ba61` |
| Execution Event         | `1383a6feefa7916a3f38b7a97a6cd9dc08e6113df895f6ca762ac00e59afda52` |

TypeScript 5.9.2 measured 2,114 types, 2,409 instantiations, 24,035 KiB,
0.40 seconds cold, 0.41 seconds warm, 0.331 ms completion p95, 0.288 ms hover
p95, and 6,151 declaration bytes. PostgreSQL 17.10 proved six atomic surfaces
under one XID, a representative 70.6 ms claim, concurrent workers, fencing,
retry, timeout, cancellation, current Policy, retention, four hostile-role
attacks, 27 B-tree indexes, and no RLS.

## Deferred seams

- Next thin durable vertical: Job direct/delayed/scheduled acceptance, status,
  result, cancellation, failover, service run-as, and retention.
- P6: production Runtime/Fetch, immutable bundle and wire compatibility,
  lifecycle/readiness/drain, complete Execution Envelope, generated clients,
  and minimal Studio.
- Later: Workflow history/signals/versioning/compensation, provider-specific
  Actions, native SQL, non-B-tree indexes, broad RLS, complete Auth, Files,
  Search, Routes, and Cloud/fleet control.

If durable SQL performance requires an expression, partial, operator-class,
raw-SQL, generic `using`, or non-B-tree access contract, work stops at that
named later seam.
