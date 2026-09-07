# Static Job schedules: decision map

This map records the remaining decisions needed to make a static minute sweep
execute through the existing Job and Mutation kernels. It is investigation
input, not Accepted authority or a shipping claim.

- Owner request: static schedules attached to Jobs. Dynamic schedules remain
  application-owned rows processed by a minute sweep; no framework schedule CRUD.
- Tracker: #365. Aggregate beta.2 acceptance #364 is blocked by this work.
- Candidate: [Proposed ADR-0043](../../../adr/0043-freeze-static-job-schedules-and-mutation-checkpoints.md).
- Baseline: the pre-schedule beta.2 candidate remains preserved in Git. Its
  manifest excludes Cron and must not be reviewed as evidence for this extension.

## Fixed authority

ADR-0016, ADR-0017, and ADR-0026 already require one Job Resource, one durable
run/attempt/lease kernel, compiler-owned schedules, a stable identity for each
scheduled instant, PostgreSQL uniqueness/fencing across ten Runtime instances,
and removal that preserves accepted runs. They forbid a scheduler leader,
implicit System authority, a second worker, and generic browser Job controls.

The owner confirmed that the framework need not understand dynamic business
schedules. A bounded application Mutation can read due rows, advance their due
times, and accept independent Jobs in one transaction. Its idempotency material
comes from the application schedule identity and logical due instant. There is
no parent/child, join, cascade-cancellation, or result-wait relationship.

## Canonical baseline before the candidate

These are source-read findings from the canonical pre-schedule baseline, not
claims about the isolated integrated candidate described below:

- `packages/compiler/src/job/index.ts` rejects non-null schedules; generated
  declarations in `job/declarations.ts` expose only `schedule?: null`.
- `packages/runtime/src/durable/acceptance.ts` already owns canonical input,
  Context, scoped identity, stable receipts, and bounded acceptance. Its caller
  provides a Principal and resolved tenant; a cron tick has neither implicitly.
- `packages/runtime/src/mutation/postgres-job-acceptance.ts` persists acceptance
  in the existing transaction owner. No parallel CRUD or Job kernel is needed.
- `packages/runtime/src/durable/job-context.ts` projects execution facts, run
  identity, and attempt only. The negative contracts in
  `fixtures/team-support-desk/src/ticket-sla-follow-up-job.ts` explicitly deny
  Queries, Mutations, Actions, and Job acceptance inside a Job handler.
- `packages/compiler/src/runtime/application-durable.ts` already reconstructs
  an ordinary Execution for each attempt. It does not supply a cron producer.

Therefore EB-05 alone cannot deliver the requested sweep. The existing EB-06
named-Mutation checkpoint is a blocking dependency, not optional future polish.

## Focused decisions and proof obligations

### 1. Static acceptance recipe

Compare only these two viable interfaces:

1. The schedule carries the accepting service Principal, exact Context input,
   and exact Job input. Existing `runAs: caller` retains its meaning: a scheduled
   run records this explicit producer as its caller. Direct and Mutation-owned
   acceptance keep their current callers.
2. Add a declared run-as variant to the Job itself. This also changes direct and
   Mutation-owned acceptance, and can require two Definitions when one handler
   must support both manual and scheduled invocation.

The leading candidate is 1 because it adds a producer without changing Job
execution authority. Principal is not a credential or a System grant. Normal
Context Resolution and current Policy still decide what that actor can do.
There is no runtime callback selecting privileged identity and no ambient worker
default. Existing Context and Job codecs own types and validation; no duplicate
schedule schemas are authored.

Proof must cover invalid Context/input, revoked service authority, tenant
mismatch, fresh attempt authorization, and failure before durable acceptance.
Exact member spelling and omission rules remain candidate work.

The shown `schedule: { cron, execution, input }` and
`ctx.run.step.mutation(name, reference, input)` direction received the owner's
go-ahead. ADR-0043 records that shape. Its isolated compiler and Runtime proof
does not make it Accepted or available on the canonical branch.

### 2. Calendar and missed ticks

Primary-source research is in [CRON-SEMANTICS.md](./CRON-SEMANTICS.md).
The smallest candidates are a numeric five-field cron with steps evaluated in
UTC only, or the same grammar with PostgreSQL-owned named-zone resolution.
Importing an entire third-party scheduler or its broader dialect is not needed.

ADR-0043 selects UTC-only for the first proof candidate. The minute sweep needs
no civil-time conversion, so named-zone resolution remains an additive later
decision rather than a hidden dependency of this release. It also selects
canonical complete-day-field validation rather than implicit DOM/DOW OR.
These are candidate choices to falsify, not claims of accepted cron behavior.

The named-zone candidate must pin DOM/DOW matching, DST gaps/folds, zone-name
validation, database time, and what a database tzdb update means for future
matches. Runtime-host locale/ICU cannot decide a tick. Start with one optional
schedule per Job; the research suggestion of multiple slots has no consumer yet.

The owner approved one catch-up run after downtime, not replay of every missed
minute. The candidate therefore coalesces missed instants to the latest due
instant and advances its durable frontier explicitly. This is a recorded product
direction, not yet a proven or Accepted scheduler contract. It does not cancel
or merge runs already accepted before the outage, nor change their retry policy.
The proof must cover concurrent catch-up, first activation, Context/acceptance
failures, backlog bounds, cancellation, and restart.

### 3. Activation, identity, and removal

PostgreSQL must own the active schedule generation and its recorded frontier.
An old Runtime must not reactivate old desired state by restarting. Runtime boot
cannot unconditionally upsert its artifacts as a newer deployment.

Choose the smallest explicit activation seam in the existing deployment flow;
do not invent a public schedule-management API. Prove concurrent activation,
stale activation refusal, rollback, removal during a tick transaction, and
old/new Runtime races. Define whether an already-due but unaccepted tick survives
removal. Accepted runs must remain executable under their retained compatibility
contract after schedule-only changes.

The current Job contract digest includes schedule metadata. Separate schedule
program/configuration identity from handler execution compatibility; otherwise
a schedule edit can unnecessarily strand already accepted runs. Decide logical
tick uniqueness separately from generation fencing. Including or excluding a
configuration digest alone is not a proof against duplicate transition ticks.

The candidate now uses one explicit deployment activation with a mandatory
expected monotonic revision. Content digests may repeat on rollback; revisions
must not. Automatic request identity derives from application, expected
revision, and target content, so authors need no extra activation key. Exact
receipt replay never changes the current head. Runtime boot stays read-only;
producer/removal ordering shares the activation lock. Unchanged program
frontiers survive, changed/new programs start after activation, and logical
tick uniqueness excludes the generation. Independent review exposed the
A-to-B-to-A stale-deployment case that a content-digest CAS would miss.

### 4. The smallest useful sweep

Use ADR-0026's Accepted named-Mutation checkpoint, to be implemented by EB-06.
A run calls one named Mutation which owns the bounded due-page transaction and Job acceptance.
Stable Mutation Call Identity and durable checkpoint history must survive the
crash between Mutation commit and checkpoint result persistence. Do not widen
ordinary Job handlers to callable Mutations merely because one sweep is
application-idempotent.

This dependency does not require Action checkpoints, signals, durable sleep,
child Jobs, compensation, or a general workflow vertical. The exact generated
command-reference spelling and current receipt/retention compatibility must be
proved rather than copied from the old compile-only prototype.

The source audit confirms Mutation receipts have no expiry/pruner today.
Checkpoint recovery should reuse that receipt, not copy a second result ledger.
ADR-0043 now distinguishes fresh Context/Operation admission from Collection
Policy. Exact receipt replay does not rerun the handler or Collection Policy;
Context/admission revocation may deny recovery without undoing a committed
write, but a Collection-only permission change does not hide the historical
result. The current executor source and ADR-0011 own this distinction; a live
characterization must retain both a same-call replay and a denied fresh-call
control. Do not silently introduce a raw receipt lookup or a new authorization
mechanism to claim a stronger guarantee.

A declared Mutation failure has no receipt. The narrowed candidate dooms
checkpoint progress and successful settlement for the attempt even if the Job
catches that error. The existing Job failure policy decides whether another
attempt occurs.
Declared errors remain permanent `REACTION_ERROR` failures, including caught
Mutation errors. Only retryable failures re-enter the reserved command; there
is no failure-result ledger or catch-and-continue workflow in this slice.
The proposed history cap and all remaining byte/work/time bounds still require
executable proof; the 100-Job acceptance cap is not a checkpoint limit.

The compiler/worker prerequisite is repaired and documented in
[EXECUTABLE-PINNING.md](./EXECUTABLE-PINNING.md). A real two-build PostgreSQL test
first reproduced a new handler executing an old run with an unchanged contract
digest. Workers now filter admission and recheck locked claims against their
verified Runtime Build. Retained builds execute their own Jobs and Reactions;
there is no historical-handler loader or schedule-text exclusion from source
hashes. This restores an Accepted guarantee, not a new lifecycle decision.

## Review reconciliation

Independent Codex authority and runtime audits agree on the missing producer,
calendar, activation, and checkpoint work. Fable 5.1 supplied exploratory advice
through a stateless no-tools invocation, not formal acceptance. Its useful
warnings were retained; these suggestions are not adopted:

- service Principal is already a framework kind, not a new one;
- another Context Definition is not an assumed escape from application Context;
- a generation increment on every Runtime boot permits old-build resurrection;
- a callable uncheckpointed Mutation violates the accepted effect boundary;
- coalescing is not automatically authorized merely because a sweep tolerates it.

A second ordinary Fable 5.1 consultation covered receipt replay and caught step
failures. It supported preserving the existing receipt contract and the
minimum reject-and-doom attempt rule. Its invented repository citations,
Operation-role checks, System Context wording, and raw-receipt recovery
suggestion were discarded after source review. Recovery must enter the existing
executor; consultation output is neither repository authority nor acceptance.

## Delivery order

The isolated integrated candidate now runs the real generated application.
These results do not accept ADR-0043 or count as a shipped capability. The
canonical branch and public authority remain unchanged.

| Obligation               | Executable candidate evidence                                                                                                                                                                                          | Remaining closure                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Activation/removal       | Verified catalog, explicit revision-fenced CLI, real Context and Job acceptance in the existing transaction, ten-contender tick proof, replay, ABA, both removal lock orders and rollback                              | Final integrated regression and formal acceptance                                                                         |
| UTC latest-only calendar | Tests now import the actual Runtime calendar; 11 unit tests / 41 assertions and PostgreSQL 17 oracle 6 tests / 23 assertions pass; duplicate calendar model deleted                                                    | Final candidate gate record                                                                                               |
| Mutation checkpoint      | Generated worker: 1 test / 60 assertions; integrated PostgreSQL recovery: 5 tests / 49 assertions, including exact 1 MiB result and rollback above it; actual attempt/reference/store units: 27 tests / 194 assertions | Final integrated regression and formal acceptance                                                                         |
| Generated authoring      | Typed static recipe, inert nested Mutation references, artifact cross-pins and Package-local query aliases; exact relocated artifacts pass                                                                             | Final release gate record                                                                                                 |
| Beginner consumer        | Team Support Desk PostgreSQL 17/Firefox sweep: 1 test / 32 assertions; existing transaction-bound Collection list bridge: 1 test / 15 assertions                                                                       | Final integrated regression; preserve the measured one-ticket batch rather than raising budgets                           |
| Packed deployment CLI    | Build/install, readiness refusal, activation/replay/stale revision, autonomous polling and drain; explicit connection-target repair passes real migration, Seed and fingerprint checks plus independent review         | Integrated CLI rerun after connection-target repair                                                                       |
| Release and acceptance   | ADR-0043 and ADR-0039 remain Proposed; no formal review invoked                                                                                                                                                        | Release gates, exact manifests, two dry-runs, formal PASS, authority projection, tracker tickets and public documentation |

The last activation model is also replaced by actual Runtime PostgreSQL
coverage: ten distinct first activations produce one winner and nine stale
refusals; exact replay, recipe reset, rollback and blocked-lock cancellation
pass in the 69-assertion suite. Its deleted source remains recoverable in Git.

Detailed evidence is owned by the candidate records under
`docs/v4/prototypes/static-job-schedules`, not by this map. The current full
release lane is not green. Independent review found a Durable-to-Mutation
barrel cycle; the contract-only repair is integrated and actual worker dependency
closure tests pass. Broader inverse-child row-accounting evidence for Mutation lists
is an inherited qualification, not something the scalar sweep proves.

The packed CLI tracer now checks the Bun SQL database identity before DDL and
aligns its child process environment with its UUID-owned database. Before that
guard, inherited `PGDATABASE` overrode the URL target and Genesis correctly
refused an existing schema with `QP-SCHEMA-026`. The shared administrative connection constructor now pins the decoded URL
database while preserving the original URL options. The real PostgreSQL target
regression uses a separate decoy database, checks identity before DDL, and
passes migration, Seed, replay and fingerprint checks.

GitHub read access and an ordinary stateless Fable 5.1 consultation now succeed.
No formal review has run: the remaining deterministic gates still block its
submission. The pre-schedule beta.2 manifest remains invalid for this scope,
and neither ADR gains authority from advisory consultation.

1. Close the focused decisions in #365 and write an additive Proposed ADR.
2. Build compiler/type and PostgreSQL falsification, including ten-instance
   races and the named-Mutation commit/result crash window.
3. Follow the repository proof protocol before authority projection. The beta.2
   Fable exception does not silently authorize that profile for another ticket.
4. Create blocker-linked tracer tickets for compiler/artifacts, activation and
   tick acceptance, the minimum checkpoint, reference consumers, and public docs.
5. Implement test-first, prove Team Support Desk and Collaboration, then revise
   the beta.2 release scope and bind a fresh aggregate acceptance candidate.

The initial audit made no implementation or authority changes. Current proof
work remains separate from product acceptance; no public schedule API,
dependency installation, authority projection, push, tag, publication, or
deployment is implied by the evidence above.
