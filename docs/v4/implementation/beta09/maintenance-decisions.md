# BETA-09 maintenance and surface decisions

Companion to `design-context.md`. It settles the decisions BETA-09 cannot avoid
against what BETA-08 actually shipped, rather than deferring them. Every
decision records the code that forces it, or records honestly that nothing
forces it and says why this answer was chosen anyway.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state; those projections move only after the
acceptance protocol returns `PASS`.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The finding that reframes three of these

The accepted contract at `docs/v4/runtime-client-envelope-and-studio.md:68` and
Gate 8 both require that each maintenance command carry "maintenance Authority,
exact identity, bounded reason, idempotency, expected-version fencing, a typed
winner, and append-only audit."

**The bounded reason is not there — and BETA-08's round 3 already looked at it
and accepted it on evidence that does not hold.** That review counted "bounded
reason (`durable_cancellation_reason_bounded`)" among the four satisfied
properties (`docs/v4/implementation/beta08/claude-review-03.json`). The bound is
real, but it is on one command, and it lands in `durable_cancellations` rather
than in the audit. An earlier revision of this record claimed no round surfaced
it; the true finding is stronger and is a correction to an accepted review
rather than a discovery. Read out of the tree:

- `reason` appears on exactly one command, `cancelRun`
  (`packages/runtime/src/durable/postgres-maintenance.ts:61`), and is written to
  `durable_cancellations`
  (`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:195`),
  which is a cancellation record, not the audit.
- `retryRun` and `acknowledgeAmbiguity` take no reason at all
  (`postgres-maintenance.ts:66`, `:73`).
- The append-only audit, `durable_maintenance_commands`
  (`internal-protocol-v4-sql.ts:213`), has columns for command, outcome,
  rejection code, actor kind and id, state before and after, and requested-at —
  **and no reason column**.
- The event stream cannot absorb it either: `durable_run_events` carries only a
  closed `error_code` enum (`internal-protocol-v4-sql.ts:145`, `:150`).

So the audit answers who did what to which run and what happened, and never
answers why, for any command. There is nowhere to put a reason without a schema
change, which is why `design-context.md` was corrected: BETA-09 owns one
minimal internal protocol extension after all.

## Q10 — the reason contract

**Decision: bounded free text, required on all three commands, recorded in the
audit. Not closed codes.**

The accepted contract says _bounded_. Bounded is a length constraint, not a
taxonomy. A closed reason-code list is authority no accepted document supplies,
and inventing one here is precisely the failure that blocked BETA-08's first
round — pinning a vocabulary into a contract that nothing derives or enforces.
The handoff's Q10 recommends "closed reason code plus optional 280-character
note"; the closed-code half is rejected on that ground, and 280 is replaced by
the bound the schema already uses.

Concretely:

- Reuse the existing bound, 1–256, matching `durable_cancellation_reason_bounded`
  at `internal-protocol-v4-sql.ts:210`. Do not introduce a second number.
- `retryRun` and `acknowledgeAmbiguity` gain a required `reason`.
- Internal protocol v5 adds a bounded `reason` column to
  `durable_maintenance_commands`, so every command — applied or rejected —
  records why it was attempted. **The column is nullable at the schema and
  required at the surface**, which `internal-protocol-v5.md` shows is forced
  rather than chosen: making it `NOT NULL` needs a backfill or a `DEFAULT`, and
  both fabricate audit content no operator supplied. A `NULL` therefore means
  exactly "written before v5." That record is the authority on the column
  shape; this bullet is the requirement it satisfies.
- **Enforce the bound before the statement, not only in the DDL.** Today
  `cancelRun`'s only enforcement is the database CHECK, so an over-long reason
  surfaces as a raw PostgreSQL error rather than a typed maintenance rejection.
  That is a seam defect: the command surface is typed everywhere else. Add a
  `REASON_INVALID` member to `DurableMaintenanceRejection`
  (`postgres-maintenance.ts:20`). Extending the kernel's own existing rejection
  union is not inventing authority; it is making an accepted property — "bounded
  reason" — a typed contract instead of a database accident. `hostile-cases.md`
  later established that `AUTHORITY_DENIED` must join it for the same reason, so
  the union and the CHECK gain two members, not one.

## Q3 — read versus maintenance Authority

**Decision: two distinct Authorities, separately evaluated. Neither implies the
other.**

_Provenance._ `owner-decisions.md` D1 and D2 record this as settled — D2 states
"evaluated, distinct from read Authority," following from D1's split rather than
needing a separate answer. That record is currently reachable only from
`README.md`: no record that depends on those decisions points at it, which is
why the link is here. **Its attribution needs confirming before review** — it
states the owner answered, which cannot be verified from this repository, and
the caveat recorded in `README.md` travels with any citation of it. The
reasoning below stands on `ADR-0010` and `CONTEXT.md` regardless of who chose
it.

Forced by the word "explicitly" in ADR-0014's "the accepted maintenance commands
are narrow, explicitly authorized, idempotent, expected-version fenced, and
audited," repeated at Gate 8. Explicit authorization cannot be derived from the
ability to read, or it would not be explicit. The code today derives it from
nothing at all — `actorOf` checks only `principalKernel.is(actor)`, a brand
(`postgres-maintenance.ts` `actorOf`) — so BETA-09 has a clear field.

**Closed by the merged slice (#326).** "The code today derives it from nothing"
was true of the design base and is false on `feat/v4` now.
`DurableMaintenanceAuthority` is a required constructor input
(`packages/runtime/src/durable/postgres-maintenance.ts:107`–`:126`, whose
comment states that "creating a maintenance surface without an authorizer is
forbidden"), and each command decides through
`input.authorize({ actor, command, runId })` at `:287`. `actorOf` survives at
`:179` and still brand-checks, but it is no longer the authorization.

The handoff's Q3 recommends separate server-supplied capability facts, with a
read-only user seeing actions disabled and a generic denial rather than
client-side hiding. That is adopted, with one refinement the disclosure logic
forces:

**Denial specificity depends on which Authority is missing.** A caller without
_inspection_ Authority must not be able to distinguish a denied run from a
nonexistent one, or the denial leaks existence. A caller who holds inspection
Authority and lacks _maintenance_ Authority can already see the run, so a
specific denial leaks nothing and is the more usable answer. One generic denial
for both cases would be needlessly hostile to the second caller.

## Q12 — retry safety disclosure

**Decision: retry is offered only when the server advertises it for the exact
current run version, and the copy states that retry creates no exactly-once
guarantee. Studio computes applicability nowhere.**

Forced by what the server already knows. `retryRun` rejects with
`RUN_NOT_FAILED` and `ATTEMPTS_EXHAUSTED`
(`postgres-maintenance.ts:20`–`:26`), and `expectedVersion` fences the command
against a run that moved. The preconditions are already server-side and typed,
so a client that re-derives them can only be wrong in a new way.

The exactly-once wording is not a UX nicety; it is accepted contract. ADR-0013
rejects "claiming exactly-once arbitrary code or unknowable provider effects"
(`docs/adr/0013-freeze-transactional-dispatch-and-reaction.md:82`) and makes
response loss "an explicit ambiguous terminal outcome" (`:38`). The blunter
sentence "it does not claim exactly-once effects" is a code comment
(`packages/runtime/src/durable/postgres-effects.ts:38`), not ADR text; an
earlier revision of this record quoted it as though it were ADR text.

**The sharper consequence: retry is not the remedy for ambiguity.** An
ambiguous effect has its own settlement path, `acknowledgeAmbiguity`, and its
own status in the effect vocabulary. Studio must not present `retryRun` as the
fix for an ambiguous run, or an operator will retry work whose external effect
may already have landed. This is forced by the effect status vocabulary, and it
is the single most consequential thing this screen can get wrong.

## Q14 — fence conflict disclosure

**Decision: the loser learns the rejection code, the run's actual current
state, its own command receipt, and the current version. It does not learn the
winning actor.**

`DurableMaintenanceOutcome` (`postgres-maintenance.ts:28`) already returns
`commandId`, `outcome`, `rejectionCode`, `stateBefore`, and `stateAfter`, and
`VERSION_MISMATCH` is the code a fenced loser receives. So most of this is
already shipped.

One gap: the outcome does **not** return the run's current version. A loser
therefore cannot re-issue its command without calling `inspect()` again, which
is a second round trip and a second chance to race. Returning the current
version on a `VERSION_MISMATCH` closes the loop in one step. It discloses
nothing new, because the version is the run's own append-only history length
and any caller holding inspection Authority can already read it from
`inspect()` — and per Q3, a caller without inspection Authority should not
reach the command at all.

**An applied outcome must return the new version as well.** Every applied
command that appends an event bumps `event_sequence`, so a caller chaining two
commands from one `inspect()` is fenced out of the second by its own first
command — see the flagship job in `studio-purpose.md`. Returning the version on
both outcomes, not only on `VERSION_MISMATCH`, is what makes chaining possible.

The winning actor is another Principal's identity and stays undisclosed. The
handoff's Q14 reaches the same place; this decision differs only by returning
the version, which its "State changed; refresh required" wording left out.

## `drainRuntime` — correct the projection, not the code

**Decision: drain is Runtime lifecycle, not a Studio maintenance command. The
accepted list of four commands becomes three.**

The contract contradicts itself. ADR-0014 describes drain as lifecycle bound to
`close`: "Drain refuses new roots and claims, closes watches with a retryable
reset, waits bounded owned work, aborts remaining Executions, fences durable
attempts, disposes resources in reverse order, and stops. `close` is
idempotent." The accepted **projection**
(`docs/v4/runtime-client-envelope-and-studio.md:69`) and Gate 8
(`docs/v4/implementation-gates.md:272`) then list `drainRuntime` among the
maintenance commands that require exact identity, expected-version fencing, and
a typed winner. Note precisely where that list lives: **no ADR names
`drainRuntime` at all** — a grep across `docs/adr/` returns nothing. The tension
is between an ADR's lifecycle paragraph and a projection plus a gate, which is a
weaker conflict than an ADR contradicting itself, and it makes the projection
the natural thing to correct.

Those seven properties are run-scoped and do not apply to a process:

- **Exact identity** — there is no durable identity for "this Runtime." ADR-0017
  accepts that there is no leader, no process registry, and no sticky routing,
  so Studio reaches whichever compatible instance served the request. A
  `drainRuntime` command would drain an arbitrary instance.
- **Expected-version fencing** — a process has no append-only version to fence
  on. The kernel's fencing reads `event_sequence` from a run
  (`postgres-maintenance.ts` `lockRun`).
- **Typed winner and append-only audit** — `durable_maintenance_commands` is
  keyed by `run_id` with a foreign key to `durable_runs`
  (`internal-protocol-v4-sql.ts:226`). A process-scoped command has no run to
  hang off.

Meanwhile the behaviour already exists and is correct: `beginDrain()` on the
worker (`packages/runtime/src/durable/worker.ts` `beginDrain()`, `:266`) and the
realtime carrier,
both driven from `close()` (`packages/runtime/src/application/index.ts:592`,
`packages/compiler/src/runtime/application.ts:493`). That is a deployment-layer
concern — a SIGTERM handler calling `close()` — and the accepted lifecycle
paragraph already describes exactly that.

So the code is right and the command list overreached. BETA-09 records the
projection correction; the public document moves after `PASS`, per the design
branch.

## The design-system gap, named precisely

Owner direction is to build on the shadcn and Base UI primitives already in the
QUESTPIE design system. **That direction is moot on `feat/v4`**: `65643c1c`
deleted `apps/studio/` under
`docs/adr/0024-descope-minimal-studio-from-beta-one.md`, so there is no Studio to
style. It applied when written — `apps/studio/src/index.ts` was then a one-line
stub, and it survives on `feat/v4-beta-09` — and the design-system facts still
hold for whatever reintroduces a Studio: `apps/docs` at shadcn style `base-mira`
with phosphor icons (`apps/docs/components.json`) on `@base-ui/react ^1.0.0`
(`apps/docs/package.json:14`).

Fourteen primitives exist in `apps/docs/src/components/ui/`: `alert-dialog`,
`badge`, `button`, `card`, `combobox`, `dropdown-menu`, `field`, `input-group`,
`input`, `label`, `select`, `separator`, `tabs`, `textarea`.

A dense inspection surface with cursor pagination, evidence lanes, and a
confirm-before-acting maintenance flow needs these, none of which are present.
All are standard shadcn registry components; availability in the `base-mira`
style should be confirmed when they are actually pulled:

| Needed               | For                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `table`              | every catalog and evidence lane; the single largest gap                                                     |
| `dialog`             | maintenance confirmation. `alert-dialog` exists but is the destructive-confirm variant, not a general modal |
| `popover`, `tooltip` | disclosing a digest, a version, or a truncated identity without navigating                                  |
| `sonner`             | command receipts — the typed winner and the fenced loser both need a non-blocking result                    |
| `scroll-area`        | bounded evidence panes that must not scroll the page                                                        |
| `skeleton`           | four-source freshness, where sources resolve independently                                                  |
| `command`            | the exact-ID jump the handoff proposes as its Q6                                                            |
| `breadcrumb`         | identity depth, which nests several levels                                                                  |
| `collapsible`        | progressive disclosure of raw envelope facts                                                                |
| `pagination`         | cursor paging without totals                                                                                |

Two honest notes. A virtualized list is **not** a shadcn component — event
streams long enough to need one require a separate dependency such as TanStack
Virtual, and that is a decision to take only if measurement shows it is needed.
And every one of these should land as an addition to the shared design system
in `apps/docs`, not as Studio-local components, or the system forks on first
use.

## Purpose

Decided separately in `studio-purpose.md` in this directory, after an
adversarial review of the two candidate framings.

## The denial that cannot be audited

Found by adversarial pre-review and verified here. It qualifies two decisions
above rather than overturning them.

`durable_maintenance_commands` carries
`FOREIGN KEY (application_name, run_id) REFERENCES durable_runs`
(`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:226`), and
`lockRun` throws before any write when the run is absent
(`packages/runtime/src/durable/postgres-maintenance.ts:114`). So **an
`AUTHORITY_DENIED` attempt against a run that does not exist cannot be
recorded at all** — there is no run row for the audit entry to reference.

That is exactly the case Q3's disclosure rule needs. A caller without
inspection Authority must not distinguish a denied run from a nonexistent one;
but a denial against a real run is audited and a denial against a phantom one
is not, so the **audit itself** distinguishes them. The outward response can
still be identical, and that is what the hostile case asserts — but "every
attempt is recorded, applied or rejected" is not literally achievable, and the
records should not claim it is.

**Decision.** Scope the claim rather than widen the schema. The audit records
every attempt _against an existing run_. A command naming a run that does not
exist is refused without an audit entry, and the operational-nondisclosure
artifact states that explicitly, so the gap is declared rather than discovered.
Widening would mean dropping the foreign key — trading a real integrity
guarantee for an audit row about nothing.

**The second consequence, also recorded.** Auditing a denial at all requires
evaluating Authority _after_ `SELECT ... FOR UPDATE`, so a denied caller takes
a row lock on a run they may not be allowed to see. That is brief and
uncontended in practice, but it is a real disclosure-adjacent side effect and
the hostile case should assert the lock is released rather than held.

**What would overturn it:** an audit table keyed independently of `durable_runs`
— which is a larger schema change than this slice owns, and which would need
its own retention story given that nothing sweeps the audit today.

## The fence is inconsistent in both directions

BETA-08's review round 4 recorded as a minor observation that the
expected-version fence cannot see an applied `retryRun`. Verified here, and the
consequence is sharper than that framing.

`appendEvent` has exactly two call sites in
`packages/runtime/src/durable/postgres-maintenance.ts` — `:263` inside
`cancelRun` and `:371` inside `acknowledgeAmbiguity`. `retryRun` appends
nothing. Since the version _is_ `event_sequence`, and every append bumps it
(`packages/runtime/src/durable/rows.ts:256`):

| Applied command        | Appends an event | Held version afterwards                                  |
| ---------------------- | ---------------- | -------------------------------------------------------- |
| `cancelRun`            | yes              | **stale** — a second command bound to it is fenced out   |
| `acknowledgeAmbiguity` | yes              | **stale**                                                |
| `retryRun`             | **no**           | **still current**, though the run moved `failed → ready` |

So the fence **over-fences** after two commands and **under-fences** after the
third. An operator holding version V can retry a failed run and then issue
another command still bound to V, which passes the fence even though the run
changed state underneath the reading.

That makes criterion 10's "a command bound to a stale reading is refused with
`VERSION_MISMATCH`" false for exactly one of the three commands. A reading taken
before a retry is stale in fact and current by the mechanism.

**Second consequence, which the review did not name.** The run's append-only
history carries no evidence it was ever retried by an operator. The audit records
it in `durable_maintenance_commands`, but `durable_run_events` — the history an
operator reads to explain a run — shows nothing. For the one transition a human
caused, the history is silent.

**Decision: the version must change on every applied command, and a retry must
appear in the history.** Appending a `retryRequested` event does both at once and
needs no new mechanism: it reuses the one guarded writer, bumps `event_sequence`
as a side effect, and fills the gap in the history. That is strictly better than
bumping the sequence without an event, which would move the fence while leaving
the history incomplete.

This strengthens the applied-outcome decision above with a second reason. That
one said an applied outcome must return the new version so two commands can
chain. This one says the version must actually _change_ when a command applies,
or the returned value is current-looking and wrong.

**What would overturn it:** a decision that operator-caused transitions belong
only in the audit and never in the run history. That is defensible — the history
is the kernel's own transitions — but it has to be stated, because at that point
the fence needs its own counter rather than borrowing `event_sequence`, and the
"version is the history length" story stops being true.

## Authority evaluation is only meaningful behind a route that does not exist

Q3 above decides that inspection and maintenance Authority are separately
evaluated. That decision stands, but it needs a qualifier this record did not
have, verified on `feat/v4` at `b387e74f`:

- `packages/runtime/src/application/index.ts` contains **no reference to
  `durable`**. The Fetch router exposes no durable route.
- `apps/studio/` no longer exists on `feat/v4` — `65643c1c` deleted it. When
  this was written it held only the one-line `index.ts` stub, which is still
  true on `feat/v4-beta-09`.

The durable reads and commands are in-process methods frozen onto the
application object. **No wire path reaches them.** So at this base a maintenance
command can only be issued by host code running inside the process — and host
code supplies its own `Principal`.

That is the sharp consequence: **Authority evaluation currently evaluates a
claim the caller made about itself.** A denial is real, typed, and auditable,
and it denies whatever the in-process caller chose to assert. There is nothing
adversarial for it to refuse, because the only caller is trusted by construction
and could equally have asserted a Principal that passes.

This does not make the mechanism wrong or premature. It makes it **incomplete in
a specific, nameable way**: it becomes meaningful the moment Authority arrives
from an authenticated Execution across a wire, and it is inert until then. The
glossary already anticipates exactly this — System Authority "cannot be derived
from request input" — which is a rule about a request path that has not been
built yet.

**What this changes for the hostile case.** BETA-09's issue lists "maintenance
Authority denial" as a case to drive. Driven in-process, it proves the branch
executes and the audit records it; it cannot prove the property the case exists
to test, which is that a caller who should not pass does not. That distinction
belongs in the evidence rather than being discovered by a reviewer, and a test
that drives it in-process should say plainly which half it proves.

**What would overturn this:** a durable route landing, at which point the
qualifier expires and the hostile case becomes fully drivable. Nothing here
argues against building the evaluation now — an inert-but-correct mechanism
behind a future route is the right order, and the alternative is a route that
arrives with no Authority behind it.

**Three acceptance criteria depend on this qualifier.** `acceptance-shape.md`
criteria 1, 2 and 3 assert that inspection and maintenance Authority are
evaluated, distinct, and specific in their denials, and it carries the same
caveat at `:78` because that is where a reviewer reads it. The two must move
together: if a durable route lands and this qualifier expires, those three
criteria stop needing it, and if this qualifier changes, they are wrong until
they change with it.

That reverse pointer is the point of writing it here. This slice has already
shipped one correction applied in one place and not the other — the Live Query
reset claim in `design-context.md`, which contradicted its own corrected bullet
twelve lines away — and a caveat duplicated across two records with only a
one-way link is the same shape waiting to happen.
