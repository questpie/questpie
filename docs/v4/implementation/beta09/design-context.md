# BETA-09 implementation context

Entry point for BETA-09 (#296), "Inspect the connected tracer through minimal
Studio." Authority is ADR-0003, ADR-0014, and ADR-0021, with Gate 8 and Gate 8A
in `docs/v4/implementation-gates.md`.

This record fixes the boundary and the identities. It opens no slice branch,
changes no ADR, no public projection, no gate, and no tracker state.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at BETA-08 acceptance merge
`8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Bounded outcome

One collaboration tracer becomes inspectable through a same-origin Studio that
reads application data only through ordinary generated Operations and Policy,
joins the compiled contract to the operational facts that BETA-06, BETA-07, and
BETA-08 actually produce, and operates the durable kernel through a maintenance
surface that finally evaluates Authority rather than trusting a brand.

## What this slice does not add

From the issue's non-goals, unchanged: no second backend, no raw SQL, no
internal-table CRUD, no remote or fleet Studio, no Operator App framework. To
those this record adds three that follow from the base:

- No new durable mechanism. BETA-08 owns the kernel; BETA-09 reads it and
  authorizes commands against it. It does own one minimal internal protocol
  extension — the maintenance reason — because the accepted contract requires a
  bounded reason per command and an append-only audit, and at this base there
  is nowhere to put one. See `maintenance-decisions.md` in this directory.
- No tenant-share or noisy-neighbour mechanism. That decision is recorded
  separately in `docs/v4/prototypes/tenant-share-control/DECISION.md` and its
  implementation is not this slice.
- No budget, retention, or quota display that no enforcing path supports. See
  the evidence axis below.

## The boundary against BETA-08

ADR-0014 accepts that "the accepted maintenance commands are narrow, explicitly
authorized, idempotent, expected-version fenced, and audited," and the public
projection at `docs/v4/runtime-client-envelope-and-studio.md:68` states it
completely: maintenance is limited to `acknowledgeAmbiguity`, `cancelRun`,
`drainRuntime`, and `retryRun`, and "each command requires maintenance
Authority, exact identity, bounded reason, idempotency, expected-version
fencing, a typed winner, and append-only audit." Four commands, seven
properties.

What BETA-08 actually shipped, read out of the tree:

| Accepted                                                  | Shipped at this base                                                                                                              | Where                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| four commands                                             | **three** — `acknowledgeAmbiguity`, `cancelRun`, `retryRun`                                                                       | `packages/compiler/src/reaction/durable-kernel.ts:120`                                                                                                         |
| `drainRuntime`                                            | **absent by that name.** `beginDrain()` is a lifecycle method; in the compiled application it is reachable only through `close()` | `packages/runtime/src/durable/worker.ts:270`, driven at `packages/runtime/src/application/index.ts:592` and `packages/compiler/src/runtime/application.ts:489` |
| exact identity, bounded reason, idempotency, typed winner | shipped                                                                                                                           | `packages/runtime/src/durable/postgres-maintenance.ts`                                                                                                         |
| expected-version fencing                                  | shipped — `inspect()` reports the run's append-only history length, stale commands refuse with `VERSION_MISMATCH`                 | `postgres-maintenance.ts` `staleVersion`                                                                                                                       |
| append-only audit                                         | shipped — `durable_maintenance_commands` carries the same guard as run history                                                    | internal protocol v4                                                                                                                                           |
| **maintenance Authority**                                 | **not evaluated.** `actorOf` accepts a `Principal` and checks only `principalKernel.is(actor)` — a brand check                    | `packages/runtime/src/durable/postgres-maintenance.ts:130`                                                                                                     |

BETA-08 disclosed this rather than hiding it: its narrower claim 8 names the
absent Authority evaluation and assigns it to the minimal Studio slice, and the
BETA-09 issue independently carries "maintenance Authority denial" as a hostile
case. The two agree, so the boundary is unambiguous.

**BETA-09 therefore owns three gaps against the accepted maintenance
contract**, and nothing else in the kernel. The third was found while grounding
the decisions in `maintenance-decisions.md`. BETA-08's round 3 had examined that
property and accepted it on evidence that does not hold, so this is a correction
to an accepted review rather than a new discovery:

1. Maintenance Authority for the three shipped commands. A brand proves the
   value came from the application's own module; it proves nothing about
   whether this actor may cancel this run. Authority must be _evaluated_, and
   the denial must be a first-class typed outcome the hostile case can drive.
2. A decision on `drainRuntime` — the fourth accepted command. It exists today
   only as process lifecycle with no identity, reason, idempotency, fencing,
   winner, or audit. Either it becomes a real command carrying all seven
   properties, or the projection is corrected to say drain is Runtime lifecycle
   and not a Studio-reachable maintenance command. Both are defensible; leaving
   the contract and the code disagreeing is not. Decided in
   `maintenance-decisions.md`.
3. The bounded reason, on every command, recorded in the audit. `reason` exists
   only on `cancelRun` (`packages/runtime/src/durable/postgres-maintenance.ts:61`)
   and lands in `durable_cancellations`, not in the audit. `retryRun` and
   `acknowledgeAmbiguity` take no reason at all, and
   `durable_maintenance_commands` has no reason column
   (`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:213`).
   The audit therefore records who did what to which run and what happened, but
   never why, for any command.

## What changed underneath the Studio research

There is an unmerged design handoff at worktree
`/home/drepkovsky/code/questpie-v4-minimal-studio-handoff`, branch
`research/minimal-studio-handoff-20260815`, dated 2026-08-15: sixteen files and
about 2,204 lines of Markdown under `docs/v4/research/minimal-studio-handoff/`. It is
labelled "research, not accepted UI or implementation authority," it separates
fixed authority from reversible defaults, and it carries seventeen open owner
decisions in its own `OPEN-DECISIONS.md`.

**Preserve that worktree and that branch untouched.** This slice cites it; it
does not rewrite, relocate, or supersede it.

The important thing about its age is not that it is old. It was written against
_accepted ADRs_, which have not moved, and it already models per-source
versions and a `versionConflict` outcome — which is precisely the shape
BETA-08's expected-version fencing produced months later. On the contract axis
it holds up.

It is stale on a different axis: **evidence**. It designed against what the
ADRs promise. BETA-06, BETA-07, and BETA-08 then established what the
implementation actually provides, and in nine places BETA-08's accepted record
is deliberately narrower than the contract. Studio must render what exists, or
it ships fields nothing populates.

The concrete deltas the implementing slice must reconcile:

- **BETA-06** made the Mutation receipt and stable Call Identity real, so
  post-response recovery is an inspectable identity rather than an assumption.
- **BETA-07** made the Change Ledger, no-affinity SSE, and Resume Tokens real.
  It did **not** make reset history observable, and an earlier revision of this
  record wrongly said it did. `reset_reason` is a closed three-value vocabulary
  (`packages/compiler/src/schema/postgres/internal-protocol-v3-realtime.ts:169`,
  `:191`) living on `realtime_binding_generations`, which is not an event log:
  generations are hard-deleted rather than tombstoned
  (`packages/runtime/src/live-query/postgres-realtime-generations.ts:129`), and
  a superseded generation is deleted at once, and idle scope attachments carry a
  CHECK-pinned 30-second renewal TTL
  (`internal-protocol-v3-realtime.ts:16`, `:43`). Studio can show the current
  reset reason for a currently live subscription and nothing older. A "Live
  Query resets" tile would have no history behind it at all. An earlier
  revision described this as a thirty-second window, which conflated two
  mechanisms: the TTL runs from the last renewal, so a live subscription never
  expires, while a superseded generation is gone immediately.
- **BETA-08** made run, attempt, lease, effect, cancellation, and the
  maintenance audit real — **and dropped budgets that nothing enforces**.
  `activeAttemptsPerPrincipal`, `pendingRunsPerResource`,
  `deadLettersPerResource`, and the entire retention block appear nowhere in
  `packages/` or `tests/` at this base. A Studio tile showing "dead letters
  against a budget," or any retention promise, would be displaying a number no
  path enforces. That is the exact failure BETA-08's first review round
  blocked, one layer up.

Of the handoff's recommended Overview tiles, "Reaction ambiguity" is genuinely
available and "Live Query resets" is not, for the reason recorded in the
BETA-07 bullet above. An earlier revision of this record listed both as
available; that was wrong. Its freshness and retention treatments, its Q7 and
Q8, are settled in `freshness-and-provenance.md`, which replaces the whole
per-source freshness idea with per-answer provenance.

## Identities

Every identity Studio can key on now exists and is durable. The exact-ID jump
the handoff proposes (its Q6) is therefore implementable rather than
aspirational:

- **Compiled**: Application Identity, Runtime Build, executable digest,
  Resource, Origin, Operation.
- **Execution**: Execution, correlation, causation, Mutation Call Identity.
- **Live Query**: subscription, generation, Resume Token.
- **Durable**: dispatch, run, attempt, lease-token digest, effect,
  cancellation, and the maintenance audit entry — the eight BETA-08 identities
  plus its audit receipt.
- **Version**: the run's append-only history length, which is what a
  maintenance command fences on.

## Authority is the heart of this slice

Two authorizations that must not be conflated, because ADR-0014 separates them
and the handoff's Q3 independently asks the same question:

- **Application data** goes through ordinary generated Operations and ordinary
  Collection Policy. If Studio has no second path to data, disclosure
  equivalence is definitional rather than something to test into existence.
- **Operational facts** — events, runs, attempts, effects, the audit — are not
  Collection rows, so Collection Policy does not cover them. This is where the
  red test actually bites, and where inspection Authority has to be its own
  evaluated decision rather than a side effect of being able to reach the
  Studio bundle.

The prescribed red test is: _Studio can disclose a hidden Message or internal
payload not available through the equivalent generated Operation._ Make it fail
for the real reason before building. The honest version drives the operational
lane, not the application lane, because the application lane is closed by
construction and the operational lane is not.

Inspection Authority and maintenance Authority are also distinct: being able
to see a run is not being able to cancel it. The handoff's Q3 recommends
exactly this split and recommends that a read-only user sees actions disabled
with a generic denial rather than hidden by client logic. That recommendation
is compatible with everything accepted and costs nothing to honour.

## Key the durable views on Tenant, not Principal

Carried from `docs/v4/prototypes/tenant-share-control/DECISION.md` (commit
`332cdcd2`) as a blocking edge for this slice.

`CONTEXT.md` defines Tenant as the isolation identity and Principal as the
authorization identity. `durable_runs.tenant_id` is `text NOT NULL`
(`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:20`) and is
already selected by the kernel
(`packages/runtime/src/durable/postgres-kernel.ts:123`). ADR-0017 already
accepts "scheduler contention" as an Execution Envelope item, and Studio is
where per-tenant backlog becomes observable.

An earlier revision of this record said keying on Tenant "costs nothing here."
That is wrong on the read path and both adversarial teams caught it
independently. `tenant_id` appears in **no index**: the three on `durable_runs`
are `(application_name, state, available_at, run_id)`,
`(application_name, state, lease_expires_at)`, and
`(application_name, resource_identity, state)`
(`internal-protocol-v4-sql.ts:98`–`:103`).

An earlier revision called a tenant-first listing a sequential scan. **Measured,
it is not.** On PostgreSQL 17.10 with 207,000 runs across 300 tenants,
`WHERE application_name='app' AND state='failed' AND tenant_id='t-7'` plans as
an Index Scan with a filter — 0.31 ms, removing 1,993 rows to return 7. The cost
scales with the _matching state set_, not with the table.

So the correction is smaller than first stated and still points the same way:
Tenant is the correct axis to display and to scope authorization by, and a
tenant-scoped list is affordable today by filtering inside an indexed state
predicate. A dedicated index becomes worthwhile when the failed set grows, not
because the query is unusable now. Any tenant-scoped list must select through an
indexed predicate first; the slice does not need a measured exception to ship
one.

Shipping an operator surface keyed on Principal would harden the wrong axis
into the place operators look, and correcting it afterwards means changing a
published Studio projection rather than an unshipped one. Cheap now, expensive
later.

## The surface this is built on

Owner direction, recorded 2026-08-18: build on the shadcn and Base UI
primitives already in the QUESTPIE design system.

Verified state at this base:

- `apps/studio` is a stub. Its entire source is one line —
  `export type InternalStudioPackage = Readonly<Record<never, never>>;` at
  `apps/studio/src/index.ts`. The issue's `--typecheck @questpie/studio`
  verification targets it.
- The design system lives in `apps/docs`: shadcn with `style: "base-mira"` and
  `iconLibrary: "phosphor"` (`apps/docs/components.json`), on
  `@base-ui/react ^1.0.0` and `shadcn ^3.6.3` (`apps/docs/package.json:14`,
  `:53`).
- Fourteen primitives exist under `apps/docs/src/components/ui/`:
  `alert-dialog`, `badge`, `button`, `card`, `combobox`, `dropdown-menu`,
  `field`, `input-group`, `input`, `label`, `select`, `separator`, `tabs`,
  `textarea`.

A gap worth planning for rather than discovering mid-slice: a dense inspection
surface with cursor pagination and evidence lanes wants a table or data grid, a
non-alert dialog, popover, tooltip, toast, and probably a virtualized list.
None of those exist in the fourteen. They should arrive as **additions to the
shared design system through the shadcn registry**, not as Studio-local
components, or the design system forks on first use.

## Purpose before screens

Owner direction, recorded 2026-08-18: Studio should be more user-friendly and
carry a more real purpose than the handoff shows.

This is a substantive steer, not a polish note, and it reopens the handoff's
own first question. The handoff's Q1 recommends "application developer first,
on-call second: open on a facts Overview, then organize all depth by canonical
identity," and its Q5 recommends six to eight facts-only Overview tiles. That
is an identity-first, facts-first product: it is excellent at answering _what
is the state of this exact thing I already know the ID of_, and it does not
answer _what should I do now_.

The steer says that is not enough. The implementing slice must answer, before
drawing screens: **what does someone come to Studio to accomplish?** A real job
— "this Reaction is stuck and I need to decide whether retrying is safe,"
"this deploy changed behaviour and I need to see what," "a customer says their
message never arrived" — organizes navigation around outcomes, and the
canonical-identity depth the handoff specifies becomes the destination rather
than the front door.

This record deliberately does not invent that answer. It records that the
handoff's Q1 and Q5 are **reopened by owner direction**, that the answer
changes navigation rather than styling, and that the identity-first depth
already specified is reusable underneath whatever job-first entry replaces the
facts Overview. The exact-ID jump survives either way.

Note that the durable facts BETA-08 made real are what make a job-first Studio
possible at all: an ambiguous effect with a stable identity across attempts, a
version to fence a retry on, and an audit trail of who did what are the
materials of "decide whether retrying is safe." A facts Overview could have
been built on BETA-05. This one could not.

## Budgets

From the issue, unchanged: the changed loop stays under 5 s; Studio build-size
and query-latency baselines are recorded; no secret or raw-payload snapshots.

BETA-08's review observed that "the changed loop stays under 5 s" has had no
recorded measurement for two slices running. This slice should either measure
it or stop carrying it.

Budgets must be derived from measurement the way BETA-08's were —
`ceil(observed × multiplier / quantum) × quantum` — and the derivation asserted
in-test, not asserted in prose.

## Evidence discipline carried from BETA-08

BETA-08 needed four review rounds. The rules that closed it apply here
unchanged:

- **Falsify every repair against the unrepaired code** and record the exact
  assertion that fails. Round 1 blocked partly because a test proved something
  other than what it claimed.
- **Never pin what nothing enforces.** Round 1's largest finding was budgets
  written into a digested compatibility contract with no enforcing path. For
  Studio the equivalent is a view model field no source populates.
- **Disclose every claim narrower than the accepted contract**, name the slice
  that owns the remainder, and keep the count in the record honest — round 4
  observed that the recitation said five where the record carried nine.
- `tests/**` has no root tsconfig and is not covered by `check-types`, so pin
  an explicit tsc gate over the test files this slice changes.
- Any runtime source change rewrites the Bun bundle hash, so
  `tests/goldens/beta01/generated-digests.json` and the filename list in
  `tests/type/beta01-generated-contract.test.ts` need regenerating.
- Review records go into `quality/format-baseline.txt`, are preserved
  byte-identically, and are never reformatted. Never run `oxfmt` across
  `docs/`.
- The selected-PR performance lane is gated on a `performance` label on the
  pull request (`.github/workflows/ci.yml:87`) and silently _skips_ without it.
  A label added after the trigger does not fire it; the pull request must be
  reopened or re-pushed.

## Three of the four required artifacts cannot be built at this base

Verified while implementing, in the order the issue lists them. This is the
slice's most consequential finding and it reframes what BETA-09 can deliver.

| Required artifact                      | State                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| independent Studio projection producer | **built** — `apps/studio/src/projection.ts`, driven against the real compiled artifacts |
| same-origin Studio bundle              | **built** — `app.fetch` serves `/_questpie/studio`                                      |
| Policy-protected inspection Operations | **no Policy can reach operational facts**                                               |
| safe event/explain views               | **explain lane built**; the event lane stays server-internal                            |

**Corrected: the mount was built, and calling it unbuildable was wrong.** The
reasoning below described an absence and treated it as a prohibition.
`docs/v4/beta1-build-spec.md:29` names `apps/studio/` a "minimal same-origin
operational projection", so accepted authority _wants_ it served, and ADR-0014
says `createApp()` exposes `fetch` without saying how many paths it answers.
Building the mount implements the contract rather than widening it — a framework
under construction is the thing we change.

`app.fetch` now gives the realtime carrier first refusal, then the Studio mount,
then the Operation wire. The mount claims exactly `/_questpie/studio`, serves
`GET` and `HEAD` only, and returns `null` for every other path so the wire below
is untouched. It carries no Operation, no durable read, and no application data,
so it raises no disclosure question of its own: what Studio may see is decided
by what it can call, not by how its bytes arrive.

The distinction that survives is the useful one. `defineStudio` and minting
System Authority are _prohibitions_ in accepted authority and stay refused. A
missing mount was only an absence.

What was originally written follows, kept because it records what was checked.

**The bundle had nowhere to be served from.** `app.fetch` gives the realtime
carrier first refusal on its single contract path, then serves exactly
`/_questpie/operation` — POST only, with the exact Operation media type — and
returns `NOT_FOUND` for every other pathname
(`packages/runtime/src/application/index.ts:431`–`:441`, `operationPath` at
`packages/runtime/src/operation/wire.ts:7`). There is no static asset path, no
HTML path, and no second mount. The escape hatch that would provide one,
`defineRoute`, is a reserved `EmptyDefinitionFactory` that accepts no
definition. So a same-origin Studio bundle cannot be mounted by any authored
means at this base.

**Inspection Operations are the one genuine prohibition, not an absence.** The
lens that corrected the bundle mount was applied here and reaches the opposite
answer. ADR-0010:41 states that "`definePolicy(collection, body)` binds one
closed typed Policy program to one Collection" — Policy is Collection-bound by
contract, not by accident — and Gate 8 forbids the move that would make runs a
Collection, naming "internal-table CRUD" among what Studio must not have. So
closing this needs an ADR-0010 amendment, which is a different act from adding a
path to `fetch` that accepted authority had already asked for.

**Inspection Operations have no Policy**, for the reason
`inspection-contract.md` now records: a Query has no admission Policy at all and
a Mutation's can only say `authenticated`, while operational facts are not
Collection rows so no Collection Policy reaches them.

**The explain and event lanes are projectable but not viewable.**
`collection-operation-explain.json`, `execution-composition-explain.json`, and
`relational-explain.json` are compiled artifacts, so the producer can project
them exactly as it projects the catalog. Durable events are readable
server-side. What cannot happen is a human opening a page, because that needs
the bundle mount that does not exist.

### What this means for the slice

BETA-09 can produce everything Studio would render and can deliver no Studio.
The projection producer is real and tested; the surface that would show it to an
operator is not reachable.

One root cause runs under all three, and it is worth naming plainly rather than
as three separate gaps: **the accepted contract describes Studio as an
application of the framework, and the framework has no seam for an application
that is not Operations over Collections.** Policy binds to Collections, the wire
serves one Operation path, and the three factories that would widen either —
`defineRoute`, `defineAction`, `defineJob` — are reserved names.

This is disclosed rather than worked around. Mounting a bundle by widening
`app.fetch`, or authorizing inspection by widening Policy, are both Operation-
contract changes, and `authority-mechanism.md` already refused to invent the
smaller of the two inside a Studio slice.

## Where the remaining decisions are taken

`maintenance-decisions.md` in this directory settles the four decisions this
slice cannot avoid — the handoff's Q3 (read versus maintenance Authority), Q10
(reason contract), Q12 (retry safety disclosure), and Q14 (fence conflict
disclosure) — plus `drainRuntime` and Studio's job-first purpose. Each is
decided against what BETA-08 shipped rather than deferred, and each records the
code that forces or fails to force it.

The handoff carries seventeen open decisions, Q1 through Q17. This slice
settles or reopens Q1, Q3, Q5, Q6, Q7, Q8, Q10, Q12, Q13, and Q14, so at most
seven remain, and those are visual and navigational rather than contract-
binding. An earlier revision said thirteen remained, which double-counted the
ones this record had already settled twelve lines above.

The three tenant-share items in
`docs/v4/prototypes/tenant-share-control/DECISION.md` remain open and are not
this slice's to take; only the Tenant-keying edge above binds it.
