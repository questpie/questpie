# BETA.2 developer-experience passes

- Status: local execution wayfinder; not acceptance authority
- Authority: `SPEC.md`, ADR-0011, ADR-0015, ADR-0019, ADR-0022, ADR-0026,
  and `docs/v4/research/production-backend/DECISION-MAP.md`
- Scope: correctness prerequisites, authoring coherence, generated-client and
  editor ergonomics, executable documentation, and framework learning assets
- Non-goals: a runtime CRUD dispatcher, an editor plugin, an ambient registry,
  a second Policy model, Studio, synthetic many-to-many Relations,
  polymorphic Relations, or custom scalar extensibility

This file turns the recorded DX frontier into an autonomous order. It does not
accept a new spelling. Any item that changes Accepted public spelling needs a
focused proof and fresh acceptance review before production projection.

## Decision

DX is not one late polish batch. Split it into three classes:

1. correctness prerequisites that existing Accepted contracts already require;
2. one-source authoring improvements that need a focused proof before changing
   public spelling; and
3. editor and visual conveniences that must be tested in the runnable backend
   rather than used to shape its runtime.

Only the first class blocks Route, Action, and Job implementation. PostgreSQL
driver/topology consolidation remains a separate production-backend chain
(`docs/v4/research/production-backend/DECISION-MAP.md:29`-`:152`).

## Autonomous order

```text
DX-00 executable guide-block gate proposal (proposal only)
  -> DX-01 enforce Operation admission
       -> PB-02 connection topology proof
            -> PB-03 one deep pg module proof
                 -> PB-04 Change Ledger static statements + immediate LISTEN wake
                      -> PB-05 production Bun SQL removal
                           -> EB-02 Route/Auth
                           -> EB-03 Action
                           -> EB-04..08 unified Job, cron, checkpoints
                                -> EB-09 OpenAPI/MCP/skills
                                -> EB-10 runnable backend and docs
                                     -> DX-02 one-source Query authoring
                                     -> DX-03 structural Query parity
                                     -> DX-04 client/editor ergonomics
                                     -> DX-05 visual docs and framework skills
```

The `pg` chain may prepare proof while DX-01 is implemented, but production
changes stay sequential. Do not build Route, Action, or Job against a temporary
second database driver or a public connection shape that the topology proof may
replace.

PB-02 is resolved at the research layer by
`docs/v4/research/production-backend/postgres-connection-topology-primary-sources.md`:
one bounded ordinary `pg.Pool`, one dedicated session-affine listener per
realtime Runtime, and separate pinned migration ownership. The required
`connectionUrl`/`directConnectionUrl` spelling has no implicit production
fallback. This unblocks an internal PB-03 prototype; it does not authorize the
public projection. `directConnectionUrl` is an operator assertion of a direct or
session-affine endpoint that must be validated before deployment health; the
Runtime cannot infer it from ordinary credentials and two generic URLs, and it
must not fall back to `connectionUrl`.

PB-03 now has a selected internal prototype interface in
`docs/v4/research/production-backend/postgres-module-interface-design.md`.
The chosen seam is one private `pg` module with callback-scoped ordinary
transactions, Runtime-owned listener/generation lifecycle, and a separate
transient pinned migration runner. The design comparison and deletion test are
complete, and its private executable proof is closed across PostgreSQL 16/17/18
plus the focused transaction-PgBouncer lane. PB-04 remains the first downstream
integration, not unfinished PB-03 proof.

Executable PB-03 now retains ten core real-database scenarios against PostgreSQL
16, 17, and 18. `59fa031c` proves the static-statement transaction kernel;
`63924ba7` proves committed LISTEN, notification wake, forced disconnect,
reconnect, and reconcile-before-healthy; `732b78d8` proves pinned migration
identity, advisory-lock ownership, and cleanup; `360ff8e0` proves bounded
saturation and queued cancellation; `ca93e617` proves active SQL cancellation
through the required direct endpoint; and `160af3a8` proves unknown COMMIT
classification plus fatal-client eviction. These are retained positive and
hostile controls. `0993433d` adds forced bounded shutdown, `172720bf` proves safe
failure/facts serialization, and `527be565` proves a wake arriving during
startup reconciliation is queued before healthy admission. This is not closure:
`abfaa889` adds verify/listen/reconcile-before-swap generation rotation with
failed-candidate retention, and `c2f0ef2d` adds a focused PostgreSQL 17 plus
PgBouncer 1.24.1 transaction-mode lane with a direct-listener positive and a
pooled-listener negative. This was not closure; later adversarial repairs are
summarized below.

The first adversarial pass is retained in
`docs/v4/research/production-backend/postgres-module-adversarial-audit.md`.
`48429c3c` closes Runtime resurrection and concurrent listener ownership;
`3e2cfa24` closes active migration cancellation, deadline, and timeout
narrowing; `2428e8f7` bounds rotation and close; `e1bc6dde` prevents a reconnect
from crossing close and proves zero remaining listener sessions; and
`14205c25` retains failures produced during old-generation drain. PB-03 still
does not authorize PB-04. `7b355e98` also retains redacted decoder-mismatch
refusal. `b8da3909` closes normalized configuration, connection, and startup
reconciliation failures with credential- and callback-redaction hostile cases
(`tests/integration/postgres/beta12-postgres-module.test.ts:1223`-`:1306`).
`c024d953` closes malformed migration configuration and uncertain advisory-lock
cleanup with typed refusal, zero-session observation, and fresh-runner lock
recovery (`tests/integration/postgres/beta12-postgres-module.test.ts:369`-`:393`,
`:858`-`:904`). `f51be2b2` closes the generic lost-wake frontier: advisory-lock
ordering forces reconnect reconciliation to wait for the writer's commit, no
`NOTIFY` is emitted, and frontier seven is observed inside one second rather than
the configured ten-second periodic fallback
(`tests/integration/postgres/beta12-postgres-module.test.ts:1079`-`:1159`). This
does not claim actual Change Ledger/PB-04 integration.

`9a6f7b22` closes the last PB-03 record blockers without inventing proof. An
executed transaction-PgBouncer control returned one backend PID across six
committed migration transactions and let the migration runner return
`"accepted"`, while the retained pooled-listener negative still misses the later
wake (`tests/integration/postgres/beta12-postgres-module.test.ts:1640`-`:1667`).
That contrast makes direct/session affinity an operator-validated precondition,
not a generic runtime inference. The existing BETA-05 artifact inventory,
digest, executable-binding, and readiness refusal remains prerequisite
(`packages/runtime/src/application/index.ts:157`-`:181`). `9cc76e2a` then adds
PB-04's narrow Change Ledger static-statement and `PostgresDatabase` path
(`packages/runtime/src/live-query/postgres.ts:166`-`:328`) with retained atomic
rollback and fanout controls
(`tests/integration/postgres/beta07-postgres-durable-invalidation.test.ts:202`-`:334`,
`:339`-`:432`). It does not project Runtime Build statements, and the generated
application still constructs Bun `SQL`
(`packages/compiler/src/runtime/application.ts:196`, `:272`-`:299`). PB-05 owns
that production projection, its seam-level tamper negative, the rest of Bun
removal, and the production-wide deletion test.

`7358b1f3` extends that narrow PB-04 crossing through retained Live Query
results. A private statement module owns the authority lock, bounded retention,
exact retained-result read, and pruning transactions
(`packages/runtime/src/live-query/postgres-retention-database.ts:67`-`:330`).
The retained scenario drives the new `PostgresDatabase` path through unavailable,
acknowledge, resume, expiry, prune, and forged-result refusal
(`tests/integration/postgres/beta07-postgres-retention.test.ts:113`-`:214`). This
is still incremental migration: the coordinator-facing compatibility path keeps
its Bun transactions in `postgres-retention.ts:339`-`:390`, `:404`-`:420`, and
`:453` onward. Deleting that path belongs to the remaining PB-04 coordinator
wiring and PB-05 production-wide Bun removal, not to this tracer.

`83c6ada0` adds the parallel `PostgresDatabase` scope and generation authority
path. The factory selects disjoint `{ database }` or legacy `{ sql }` modes
(`packages/runtime/src/live-query/postgres-realtime-scope.ts:31`-`:46`); the
database mode transacts attach/open/scan/close/expiry through static statements
(`packages/runtime/src/live-query/postgres-realtime-scope-database.ts:46`-`:165`)
and owns generation fencing, successor publication, acknowledgement transfer,
and pruning in the same seam
(`packages/runtime/src/live-query/postgres-realtime-generations-database.ts:31`-`:113`).
The retained hostile path uses three independent database owners and proves
stale refusal, a generation-one acknowledgement, a generation-two successor,
acknowledgement transfer, and physical pruning
(`tests/integration/postgres/beta07-postgres-realtime-scope.test.ts:315`-`:527`).
This is still a store tracer, not coordinator closure: the production
coordinator continues to accept Bun `SQL` and construct its Bun-backed stores
(`packages/runtime/src/application/realtime/postgres-coordinator.ts:103`-`:120`).

## DX-00 — Propose executable fenced-code verification

The proposed gate extracts TypeScript fences from
`apps/docs/content/docs/v4`, materializes each example with its declared file
and Current App Contract context, and compiles it with the canonical TypeScript
bridge. A plain isolated snippet compiler is insufficient because generated
imports, sibling files, and intentional fragments need explicit metadata.

The proposal must prove one known positive guide block compiles and one
deliberately broken negative fixture fails before reporting a zero-failure
sweep. It classifies failures as:

- stale documentation;
- missing implementation of Accepted behavior; or
- unresolved product authority.

Do not wire this into contributor CI until its extraction rules, fragment
annotations, runtime-example boundary, focused latency, and false-positive
rate are measured and reviewed. The later gate compiles authored examples; it
does not substitute generated output or execute arbitrary prose.

## DX-01 — Enforce Operation admission before adding surfaces

This is correctness work, not optional API polish. ADR-0011 says every Query
and Mutation owns Policy/admission
(`docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md:19`-`:22`),
while the current Query plan carries an `admission` member
(`packages/runtime/src/relational/query.ts:92`-`:105`) and the execution path
reaches SQL without consuming it
(`packages/runtime/src/relational/query.ts:587`-`:640`). Mutation similarly
reserves a session, opens a transaction, and reaches its handler without an
independent Operation-admission decision
(`packages/runtime/src/mutation/postgres.ts:145`-`:181`, `:226`-`:260`).

Start red with an anonymous Principal whose Context resolves successfully.
Prove authenticated admission refuses before SQL, transaction reservation, or
handler execution across:

- direct Query and Mutation;
- Fetch/client Query and Mutation;
- nested Operation calls;
- Live Query recomputation; and
- durable attempts once Action/Job use the same kernel.

Include a public-admission positive control. Do not rely on the collaboration
Context rejecting anonymous callers, because that masks the independent gate.
Route and Action may then reuse this one admission kernel rather than each
inventing ingress authorization.

What would overturn the ordering: executable evidence that a different
already-enforced gate consumes the exact compiled admission before every listed
surface. A grep hit or an artifact field is not that evidence.

Progress at `373d326c`:

- `2c606003` adds one shared admission kernel and consumes the compiled
  structural Query admission before binding, cursor work, or PostgreSQL
  (`packages/runtime/src/operation/index.ts:61`-`:84`,
  `packages/runtime/src/relational/query.ts:606`-`:620`). The integration
  witness resolves an anonymous Context, observes zero reservations for
  `authenticated`, and positively opens PostgreSQL once for `public`
  (`tests/integration/beta04-policy-query.test.ts:220`-`:319`).
- `35338b23` carries the authored Mutation admission in the direct Operation
  contract without changing Operation Wire bytes, then consumes it before
  input encoding, pool reservation, transaction start, or handler execution
  (`packages/compiler/src/runtime/index.ts:65`-`:100`,
  `packages/runtime/src/mutation/postgres.ts:146`-`:152`). Its hostile witness
  observes zero reservations, statements, and handler calls
  (`tests/unit/beta06-runtime-mutation-transaction.test.ts:232`-`:272`).
- `373d326c` refreshes only the generated-build and package-release ratchets.
  `bun run quality:full` passes at that head.

DX-01 is not marked complete. The remaining proof is the application wrapper:
direct named Operations and Fetch/client calls pass through
`normalizeOperationError`, while accepted Operation Wire v2 has no ordinary
`UNAUTHENTICATED` or `FORBIDDEN` failure code. The current kernel fails closed
before application work, but Fetch can expose only a generic existing failure.
Do not change the wire digest or silently map this to `INTERNAL` as the final
contract. A retained-wire proof must choose the observable result first.

Named Query admission is also not inferred here. The current generated Query
factory has no operation-level Policy input; adding one remains the explicit
owner decision recorded above this execution plan, not an implementation
detail of this pass.

## DX-02 — Make the common Query path one-source

Run after the runnable backend establishes the real authoring loop. Compare and
accept one coherent spelling for:

- `operation.input(dataQuery)` deriving the exact Operation input codec;
- inferred output only when the compiler can materialize a closed runtime
  codec from the handler or unchanged structural plan result;
- an explicit output pin for transformations, recursion, or deliberate public
  contract stability;
- exact declared errors and Operation admission on both Query and Mutation;
  and
- generated Context facts matching the Accepted Query/Mutation capability
  boundary.

An output pin validates; it never casts. Unsupported inference must fail at the
authored Origin rather than widening to `any`, `unknown`, or generic JSON.

The spelling `admission` is the leading candidate for Operation-level
authorization because `policy` already names a Collection-bound Policy
Resource. It is not accepted by this wayfinder; compare it against retaining
`policy` in a focused type/runtime proof before projection.

## DX-03 — Close structural Query parity deliberately

Implement or supersede the already accepted but absent bounded list parameters
and one-hop Relation `exists`/`notExists` grammar. Keep disclosure reads
distinct from boolean Policy evidence.

Projected inverse `toMany` is a new focused decision. The KISS candidate is a
bounded child window with required `first`, total `orderBy`, no nested cursor,
one SQL plan, child Policy, Live Query dependencies, and an explicit
parent-times-child row/byte budget. A cursor connection is earned only by a
real application needing independent continuation for several parents.

Arbitrary recursive depth, synthetic many-to-many, and polymorphic Relations
remain absent.

## DX-04 — Client dot access and authored-Origin navigation

ADR-0022 already makes generated server capability maps nested-only, so server
handlers use forms such as `ctx.queries.messages.page`. Direct App and browser
client maps intentionally retain exact keys such as
`queries["messages.page"]`
(`docs/adr/0022-freeze-api-ergonomics-and-operation-projection.md:25`-`:31`).
Therefore client dot access is a public projection change, not a formatting
tweak.

Prototype both of these without changing canonical identity:

- retain the exact-key member as a stable fallback;
- add a collision-safe nested client projection only if exact types, null-
  prototype behavior, `then` safety, declaration size, TypeScript
  instantiations, and runtime bytes stay within budget.

Go-to-definition must use stock TypeScript and compiler-owned Origin metadata.
Try generated declaration imports/source links or declaration maps first. Do
not ship an editor plugin as authority. If stock TypeScript cannot navigate to
the authored Definition reliably, keep generated-member navigation and provide
an exact `questpie explain origin <identity>` fallback rather than pretending
Ctrl-click is solved.

What would overturn dual access: a measured declaration/editor or collision
cost that materially harms the generated contract. In that case retain exact
keys externally and nested-only server capabilities.

## DX-05 — Explain built-in CRUD and finish the learning loop

QUESTPIE already has built-in policy-aware CRUD authoring:
`defineCollectionOperations` expands selected `list/get/create/update/delete`
members into ordinary Query and Mutation Resources before Manifest emission.
It is compile-time shorthand, not a hidden runtime CRUD engine
(`docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md:33`-`:38`;
`packages/questpie/src/operation-set.ts:113`-`:140`).

The DX pass may improve its defaults, attachment vocabulary, generated docs,
and examples only after proving each expanded child uses the same Policy,
snapshot/transaction, receipt, error, observation, and client path as a named
Operation. It must not add a generic table endpoint, runtime dispatcher, or
Studio-only data backend.

After EB-10, finish one executable developer journey and repo-owned framework
skills covering model, migration, Seed, Query, Mutation, generated client,
Live Query, Reaction, Route, Action, Job, cron, diagnostics, and the exact
absence boundary. Visual polish follows executable truth.

## Overnight stop conditions

An autonomous tick stops before production mutation when:

- a proposed public spelling has no accepted focused proof;
- PostgreSQL topology has not fixed connection ownership for the code being
  changed;
- a test would need to weaken Policy, nondisclosure, transaction, durable, or
  Origin guarantees;
- another worktree owns overlapping dirty paths; or
- only an editor-specific mechanism can make the DX claim true.

It may continue without owner input when implementing an already Accepted
behavioral requirement, adding a falsifying regression, constructing a proof,
or recording a grounded deferral with the exact condition that would overturn
it.
