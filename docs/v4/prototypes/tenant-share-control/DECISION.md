# Multitenant noisy-neighbour control: axis, placement, and non-goals

Design and wayfinder record. This document decides where noisy-neighbour
control belongs in the accepted contract and in the work queue. It opens no
implementation slice, changes no ADR, no public projection, no gate, and no
tracker state. Those projections wait for the proof branch's acceptance
protocol, per the design branch.

Base: `feat/v4` at BETA-08 acceptance merge
`8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## What is actually true today

Every number and mechanism below was read out of the tree at this base, not
inferred from documentation.

| Claim                                                       | Where                                                                            | Verified state                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The only share control anywhere is per-Principal, in memory | `packages/runtime/src/application/index.ts:202`, `:205`, `:257`                  | `activeByPrincipal` is a per-process `Map`; `maximumActiveRootsPerPrincipal ?? 64`; refusal is `OperationFailure("RESOURCE_LIMIT", true)`, retryable    |
| Tenant is resolved _after_ that cap is checked              | `packages/runtime/src/execution/index.ts:252`, `:284`                            | the cap runs in `executeRoot` before `core.execution`; `program.context.resolve` produces `resolved.tenant` inside the root Execution                   |
| Runs store a Tenant                                         | `packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:20`           | `tenant_id text NOT NULL` on `durable_runs`                                                                                                             |
| Nothing schedules on it                                     | `packages/runtime/src/durable/postgres-kernel.ts:357`, `:378`                    | `tenant_id` is selected for projection only; admission is `ORDER BY available_at, run_id` with no tenant term                                           |
| The durable kernel pins no noisy-neighbour budget           | `packages/compiler/src/reaction/durable-kernel.ts:68`                            | comment and `budgets` block; `activeAttemptsPerPrincipal`, `pendingRunsPerResource`, `deadLettersPerResource` appear nowhere in `packages/` or `tests/` |
| The runtime sets **no** server-side statement timeout       | `packages/compiler/src/postgres-session.ts:39`                                   | `configurePostgresTimeouts` is called only from `schema/postgres/apply.ts:251` and `seed/postgres/apply.ts:231`, both compiler DDL/seed sessions        |
| Runtime time bounds are client-side only                    | `packages/runtime/src/mutation/postgres.ts:159`, `:66`                           | `AbortSignal.timeout(5_000)` plus `query.cancel()`                                                                                                      |
| The framework never owns the pool                           | every runtime PostgreSQL module                                                  | `SQL` is a type-only import from `bun`; the host constructs and sizes the pool                                                                          |
| Per-call bounds are per call, not shares                    | `mutation/postgres-program-types.ts:132`, `compiler/src/live-query/index.ts:138` | Mutation `rows: 100, durationMilliseconds: 5_000`; `fanoutPerBatch: 1024`                                                                               |
| The Query page cap is the author's, not the framework's     | `packages/compiler/src/relational/postgres/index.ts:377`, `:438`                 | the compiler requires `first` to declare a codec `maximum`; it fixes no number                                                                          |

Two corrections to the framing this record was asked from.

- **`Query first <= 100` is not a framework ceiling.** The compiler enforces
  that a maximum is _declared_; the number is the application author's. An
  author-declared bound is not a share and is not even a framework-owned
  ceiling, so it should not be counted as existing protection.
- **The HA ADR is ADR-0017, not ADR-0019.** ADR-0019 is Semantic Kernels and
  the Public Surface. The atlas _ticket_ numbered #19 is the HA/optional
  acceleration ticket, and it produced ADR-0017. Question 3 is answered against
  ADR-0017 below.

## 1. The accepted isolation axis

**Tenant. It is already accepted, and the budget table contradicts it.**

`CONTEXT.md:396` defines Tenant as "the immutable application-selected
isolation identity for one Execution." `CONTEXT.md:390` defines Principal as
"the authenticated or anonymous identity facts used by Policy." The glossary
already assigns isolation to Tenant and authorization to Principal. The budget
table in `docs/v4/transactional-dispatch-and-reaction.md:123` then bounds
"active attempts per Principal."

So this is not a new decision. It is a defect: an accepted table measures on
the authorization axis while the accepted glossary names a different axis as
the isolation one. Deciding "Tenant" here is a correction, not an expansion.

Principal does not disappear. It bounds a different thing, and the two are
nested rather than parallel:

- **Tenant bounds share** — how much of a contended resource one tenant may
  hold against _other tenants_.
- **Principal bounds blast radius** — how much of its own tenant's share one
  actor may hold against _other actors in that tenant_.

The nesting is the whole point. A per-Principal cap that is not subordinate to
a Tenant cap is not an isolation control at all: 500 users × 16 attempts is
8,000 in flight with every per-Principal cap honoured, and one service
Principal aggregating many tenants is a single counter protecting nothing. A
Principal bound is only meaningful expressed against its tenant's share.

### The asymmetry that decides the mechanism

The durable axis and the request axis are not the same problem, because the
tenant key is trustworthy in one and forgeable in the other.

- **Durable work: the Tenant is trustworthy at rest.** `durable_runs.tenant_id`
  is written inside the Mutation transaction from an Execution whose Context
  has already resolved. A scheduler reading that column is reading a resolved
  fact.
- **Request ingress: the Tenant is not known when it would be needed.** The
  cap at `application/index.ts:257` runs _before_ `core.execution`, and Tenant
  only exists after `program.context.resolve` at `execution/index.ts:252` —
  which may itself hit the database through `program.bootstrap.get`. Keying
  pre-admission on the _claimed_ tenant in the decoded Context input is
  forgeable: a hostile caller spreads load across fabricated tenant keys and
  defeats the cap. Keying it on the _resolved_ Tenant costs the pool slot and
  round trip that the cap exists to protect.

This is the load-bearing finding of this record. **Fair scheduling on Tenant is
cheap and correct on the durable axis and is not straightforwardly available at
request ingress.** Any proposal that treats the two axes as one mechanism is
wrong on this ground alone.

## 2. Per-axis enforcement and refusal

| Axis                          | Enforced where                                | What the caller sees                                | Status                                                     |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Durable admission share       | the claim predicate, `postgres-kernel.ts:357` | nothing — no caller is present                      | **decide now**: a scheduling change, not a refusal         |
| Durable in-flight concurrency | the claim transaction                         | nothing — the run stays `ready`                     | **decide now**: deferral, never refusal                    |
| Durable backlog at acceptance | the Mutation transaction                      | `RESOURCE_LIMIT`, and the business write rolls back | **decide now**, and it is the one real product trade       |
| PostgreSQL pool slots         | nowhere; the host owns the pool               | —                                                   | **non-goal for beta.1**, named seam                        |
| Statement time                | nowhere server-side                           | client-side abort only, advisory                    | **fix independently** — see below                          |
| Live Query fanout share       | `fanoutPerBatch` is a batch size              | —                                                   | same shape as admission; defer to the same slice           |
| Retention and storage         | nowhere                                       | —                                                   | a sweeper, not a request path; already disclosed as absent |
| Provider quota via effects    | nowhere                                       | —                                                   | **non-goal**, outside the framework                        |

### Backlog at acceptance: refuse in the transaction

This is the question the framing correctly identifies as the sharp one, and it
is the one that most deserves confirmation rather than assumption.

**Recommendation: refuse at acceptance, inside the Mutation transaction, with
`RESOURCE_LIMIT`, so the business write rolls back with the dispatch.**

- ADR-0013's core invariant is that business rows, Change Ledger facts, audit,
  dispatch state, and the Mutation receipt "commit or roll back together." A
  dispatch that is accepted and _shed later_ returns a receipt for work that
  will not happen. That breaks the receipt, not merely the run.
- Shedding later means the run row, its history, and its dead-letter cost
  already exist — which is precisely the storage growth a backlog cap exists to
  prevent. Admitting to shed pays the cost twice.
- A caller can observe and retry a `RESOURCE_LIMIT` at the Mutation. There is
  no surface anywhere on which a caller can observe a shed run.

**The cost, stated plainly and not hidden:** this couples a tenant's _write
availability_ to its own background pressure. A tenant that floods its own
queue starts failing its own writes. That is a real product consequence, it is
the correct blast radius (the tenant that caused it absorbs it), and it is a
decision the product owner should make consciously rather than inherit from a
mechanism. A middle option exists — refuse only above a hard ceiling and
_degrade_ below it by pushing `available_at` out — but it is a second mechanism
with its own tests, and it should not be bought unless the simple form is
rejected first.

### Statement time is a separate, larger, cheaper finding

The runtime sets no `statement_timeout`. Every runtime time bound is
`AbortSignal.timeout(5_000)` plus `query.cancel()`, and a PostgreSQL cancel
request is advisory and racy. A single pathological query therefore holds a
backend and a pool slot for as long as PostgreSQL wants, regardless of what the
Mutation budget says.

This is not a multitenancy feature. It is an already-accepted bound —
ADR-0013's "attempt timeout ... finite," the Mutation's 5,000 ms — that nothing
server-side makes true. It is the highest-value, lowest-cost item in this
entire record, it is independent of every axis decision here, and it should not
wait on them. `configurePostgresTimeouts` already exists at
`packages/compiler/src/postgres-session.ts:39`, but "the runtime simply never
calls it", which an earlier revision said, understates what adopting it takes.
It sets both GUCs with `set_config(..., false)` (`:44`–`:45`) — **session**
scope, not transaction-local — so on a pooled connection it leaks the timeout to
the next borrower. The runtime needs the transaction-local form the durable
kernel already uses (`packages/runtime/src/durable/rows.ts:23`). The helper is a
precedent for the shape, not something the runtime can call as it stands.

Recorded here as a **newly discovered blocking edge**, not as part of the share
decision.

## 3. ADR amendments

- **ADR-0013 — yes, narrow.** Its decision already accepts that "concurrency
  ... [is] finite"; it does not say on which axis. The amendment fixes the axis
  to Tenant and makes any per-Principal number subordinate to it. This changes
  an unstated detail inside an accepted invariant rather than adding one. The
  public budget table at `docs/v4/transactional-dispatch-and-reaction.md:121`
  must be corrected in the same motion, because it is the artifact that
  currently states the wrong axis.
- **ADR-0016 — no.** It already assigns Queue as "the operational scheduler and
  lease surface" and defers scheduler races to the HA ticket. Fair admission is
  a property of the scheduler it already owns. It needs an amendment only if
  the decision adds _authored_ surface — a group partition key on the
  Definition would be exactly that, which is one more reason to keep group
  partitioning out of this decision.
- **ADR-0017 — yes, it must carry per-tenant share as an HA property.**
  Fairness under ten instances _is_ a multi-instance property, and ADR-0017's
  no-leader, no-process-registry invariant is what constrains the mechanism:
  share cannot be a per-process token bucket or a Redis counter, because
  neither is durable authority. It has to be a property of the claim predicate
  itself. Without this in ADR-0017, a per-instance scheduler that looks fair on
  one box and is not fair across the fleet would pass every accepted test.

## 4. Queue placement

Facts: the native beta.1 queue is #288–#299. BETA-09 (#296, minimal Studio) is
the frontier as of the BETA-08 projection. BETA-10 (#297) already owns the
ten-instance load scenario, concurrent workers and schedulers, and the
contention harness. BETA-11 (#298) carries the redTest "the compiler or Runtime
assumes `workspaceId=tenantId`."

**The durable axes must not be split.** Admission share, in-flight concurrency,
and backlog refusal all rewrite the same claim predicate and are proven by the
same contention scenario. Splitting them across slices pays for that harness
and those hostile tests twice, and the second slice inherits a predicate the
first one shaped.

**Recommended placement:**

- The _contract correction_ — the axis, the budget-table fix, the ADR-0013 and
  ADR-0017 amendments — is docs-only and is what this conversation produces. It
  fits the interstitial-gate pattern this repository already uses twice (#301
  API ergonomics, #317 acceptance determinism), both of which sat outside the
  native N=5 queue.
- The _mechanism_ belongs in **BETA-10 (#297)**, which already owns the
  ten-instance harness that fair admission's hostile tests require. Building a
  new slice for it means building a second contention harness.
- **No new implementation slice is warranted**, and this record opens none.

**Does anything here block BETA-09? No — but it constrains it.** BETA-09 is
Policy-protected inspection and is unaffected by the mechanism. There is one
cheap-now, expensive-later edge worth recording before it starts:

> **Blocking edge for BETA-09:** its durable inspection views should key on
> Tenant, not Principal. ADR-0017 already accepts "scheduler contention" as an
> Execution Envelope item, and Studio is where per-tenant backlog becomes
> observable. Shipping an operator surface keyed on Principal would harden the
> wrong axis into the place operators look, and moving it later means changing
> a published Studio projection rather than an unshipped one.

One compatibility note for BETA-11: `durable_runs.tenant_id` is a plain
`text NOT NULL` written from the resolved Execution, so a share mechanism
reading it does not assume a workspace column and does not trip that redTest.

## 5. Ordering and fairness stay separate

They key on the same column and are opposite in effect, so the separation is
worth stating rather than assuming.

A group partition key buys per-group serialization and FIFO. Fair admission
plus a per-tenant in-flight cap buys share. **One group per tenant "buys"
fairness by serializing that tenant to one concurrent run** — it protects the
small tenant by crippling the large one, which is the opposite of what a share
control is for.

**The cap's half of that sentence has since weakened, and the conclusion
survives without it.** `MECHANISM.md` measured the in-flight axis and handed
BETA-10 an open question rather than a requirement: whether a per-tenant cap
binds at all below ten instances, given `packages/runtime/src/durable/worker.ts`
claims and runs one attempt at a time (`:286`, `:338`), so per-tenant in-flight
is bounded by worker count rather than by `claimBatch`. The index the cap was
argued to need also turned out optional — the shipped
`durable_runs_lease_idx` answers the count at 0.083 ms.

That does not rescue group partitioning. The contrast above needs only that
**fair admission alone** buys share without serializing anyone, which it does:
`ORDER BY turn` puts every tenant's first eligible run ahead of any tenant's
second. So read this paragraph as fair admission carrying the argument and the
cap as a possible addition BETA-10 decides, not as two mechanisms that are
jointly necessary.

Decide fairness now: it is a defect in an accepted table. Hold group
partitioning as a separate later decision. The compatible seam is that the
claim predicate should partition on a _key column_ rather than hardcoding
`tenant_id`, so a later group key reuses the same mechanism — but that is a
mechanism note for the implementing slice, not a decision taken here.

## Named non-goals

So this does not become a general quota engine:

- No authored quota Resource, no per-Operation rate limits, no user-facing
  quota configuration surface.
- No priority classes, weighted fair queuing, or preemption of running work.
- No billing, metering, or usage accounting.
- No per-tenant connection pools and no per-tenant databases.
- No cross-instance token bucket, no leader, and no Redis or broker as the
  authority for share. ADR-0017 names two of these directly — the leader and
  broker-or-cache-as-durable-truth
  (`docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md:89`–`:90`);
  a cross-instance token bucket is the second of those under another name once
  it holds share authority. A share mechanism that needed one would be reopening
  the ADR. Note the ADR _permits_ a broker to carry notifications (`:47`) — what
  it forbids is a broker as authority.
- No group partitioning or per-tenant FIFO in this decision.
- No provider-quota modelling behind the effect ledger.

## The three remaining choices, decided

An earlier revision left these open for the product owner. They are decided
here rather than deferred, and each records what would overturn it. One of them
is settled by evidence that did not exist when the question was first written.

### 1. Backlog is refused at acceptance, inside the Mutation transaction

The business write rolls back with the dispatch, and the caller sees
`RESOURCE_LIMIT`.

The original argument stands: ADR-0013's invariant is that business rows,
Change Ledger facts, audit, dispatch state, and the Mutation receipt "commit or
roll back together," so a dispatch that is accepted and shed later returns a
receipt for work that will not happen. That breaks the receipt, not merely the
run.

**What settles it is a fact found afterwards, during BETA-09 design work: there
is no retention sweeper anywhere.** No `DELETE` exists against any `durable_*`
table in the tree (`docs/v4/implementation/beta09/freshness-and-provenance.md`).
BETA-08 dropped the retention block because nothing enforced it, and nothing
enforces it now. So an admitted-then-shed run's row, its history, and its
dead-letter cost are not merely paid early — they are paid **permanently**. The
degrade-then-shed variant pays unbounded storage to avoid a bounded refusal.

The cost is real and stays stated: a tenant that floods its own queue starts
failing its own writes. That is the correct blast radius, since the tenant that
caused it absorbs it.

**What would overturn it:** a retention sweeper landing, which would make shed
runs reclaimable and reopen the trade on its original terms.

### 2. BETA-10 owns the mechanism, and its red test gains a clause

Not a new interstitial gate.

BETA-10 already owns the ten-instance fixture, concurrent schedulers and
workers, arbitrary routing, and — per its own budget list — "strict
ten-instance budgets owned on tagged stable runner"
(`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json`). Fairness is
proven by measuring distribution across tenants under exactly that
fleet-under-contention setup. The apparatus is already there.

**The apparatus is there and the assignment is not, which this heading promises
and the queue has not delivered.** Checked BETA-10's entry directly: its title
is "Preserve correctness across ten instances and a rolling build", its five
artifacts are the ten-instance load scenario, soak/chaos report, rolling
compatibility matrix, fanout/worker/reconnect report and optional-infrastructure
absence report, and its red test reads in full "Correctness depends on sticky
routing, a leader, process registry, cache, broker or one instance retaining
connection state." **The words tenant, fair, admission, backlog and share do not
occur anywhere in that entry.** The budget quoted above does — "strict
ten-instance budgets owned on tagged stable runner" — so the fixture rationale
holds exactly as written.

So the clause this heading says BETA-10's red test "gains" has not been added.
Until it is, a planner reading BETA-10 finds a multi-instance correctness slice
with no fairness obligation, and these records name an owner that has not
accepted the work. That is the same shape as the route work having no owning
slice, and it is sharper here because a record asserts the ownership.

Editing `QUEUE.json` is outside what a design record does, so this states the
outstanding change rather than making it: BETA-10's red test needs the fairness
clause, and its artifacts need whatever evidence line the distribution
measurement produces.

A separate gate would stand up a second ten-instance harness to answer a
question the first one is already configured to ask. That is the duplication
the original record warned about, arriving by a different route.

The honest cost: BETA-10's red test is currently "correctness depends on sticky
routing, a leader, process registry, cache, broker or one instance retaining
connection state," which is a correctness question. Fairness is an allocation
question. The red test gains a second clause rather than being replaced, and
the slice's framing widens from correctness to correctness-and-allocation.

**What would overturn it:** BETA-10's evidence turning out to be at capacity —
though BETA-08's contention scenario measured 330.045 ms against a 2000 ms
budget, so there is headroom — or the claim-predicate rewrite conflicting with
BETA-10's existing "incompatible claim refusal" hostile case.

### 3. The statement-timeout defect is pulled forward as its own interstitial gate

Independently of everything above, and not folded into a tracer slice.

Re-verified at this base: `configurePostgresTimeouts` exists
(`packages/compiler/src/postgres-session.ts:39`) and is called only from
`packages/compiler/src/schema/postgres/apply.ts:251` and
`packages/compiler/src/seed/postgres/apply.ts:231`, both compiler DDL and seed
sessions. `statement_timeout` appears nowhere in `packages/runtime/src`. Every
runtime time bound is a client-side `AbortSignal` plus an advisory
`query.cancel()`.

So ADR-0013's "attempt timeout ... finite" and the Mutation's 5,000 ms budget
are both accepted bounds that nothing server-side makes true. This is a defect
against accepted authority, not a new feature, and it is independent of the
isolation axis.

**Why its own gate rather than folded in.** Setting a server-side
`statement_timeout` changes behaviour for any legitimately slow query, and that
change deserves its own measured evidence rather than arriving inside a slice
about something else. The repository already has the pattern: #301 and #317
were interstitial gates that did not count toward the native N=5 queue.

**What would overturn it:** evidence that the runtime pool already inherits a
server-side timeout from deployment configuration in every supported target, in
which case the framework is right not to set one and the accepted bounds should
say so instead.

## What remains open

Nothing in this record. The mechanism, its placement, and the independent
defect are all decided. What is not decided here is anything BETA-09 owns —
that slice's records are separate and complete.
