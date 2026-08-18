# BETA-09 maintenance and surface decisions

Companion to `design-context.md`. It settles the decisions BETA-09 cannot avoid
against what BETA-08 actually shipped, rather than deferring them. Every
decision records the code that forces it, or records honestly that nothing
forces it and says why this answer was chosen anyway.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state; those projections move only after the
acceptance protocol returns `PASS`.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The finding that reframes three of these

The accepted contract at `docs/v4/runtime-client-envelope-and-studio.md:68` and
Gate 8 both require that each maintenance command carry "maintenance Authority,
exact identity, bounded reason, idempotency, expected-version fencing, a typed
winner, and append-only audit."

**The bounded reason is not there, and none of BETA-08's four review rounds
surfaced it.** Read out of the tree:

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
  `durable_maintenance_commands` with the same CHECK, so every command — applied
  or rejected — records why it was attempted.
- **Enforce the bound before the statement, not only in the DDL.** Today
  `cancelRun`'s only enforcement is the database CHECK, so an over-long reason
  surfaces as a raw PostgreSQL error rather than a typed maintenance rejection.
  That is a seam defect: the command surface is typed everywhere else. Add a
  `REASON_INVALID` member to `DurableMaintenanceRejection`
  (`postgres-maintenance.ts:20`). Extending the kernel's own existing rejection
  union is not inventing authority; it is making an accepted property — "bounded
  reason" — a typed contract instead of a database accident.

## Q3 — read versus maintenance Authority

**Decision: two distinct Authorities, separately evaluated. Neither implies the
other.**

Forced by the word "explicitly" in ADR-0014's "the accepted maintenance commands
are narrow, explicitly authorized, idempotent, expected-version fenced, and
audited," repeated at Gate 8. Explicit authorization cannot be derived from the
ability to read, or it would not be explicit. The code today derives it from
nothing at all — `actorOf` checks only `principalKernel.is(actor)`, a brand
(`postgres-maintenance.ts:130`) — so BETA-09 has a clear field.

The handoff's Q3 recommends separate server-supplied capability facts, with a
read-only user seeing actions disabled and a generic denial rather than
client-side hiding. That is adopted, with one refinement the disclosure logic
forces:

**What the Authority is evaluated against is decided separately.** This record
said Authority must be evaluated without saying against what, because it was
written without checking that `Authority` is a one-member union at this base.
`authority-mechanism.md` closes that gap and decides ordinary Policy.

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
states plainly that "QUESTPIE does not claim exactly-once effects," and response
loss becomes an explicit `ambiguous` terminal outcome.

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
idempotent." The same ADR's Studio sentence, and Gate 8, then list
`drainRuntime` among the maintenance commands that require exact identity,
expected-version fencing, and a typed winner.

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
worker (`packages/runtime/src/durable/worker.ts:270`) and the realtime carrier,
both driven from `close()` (`packages/runtime/src/application/index.ts:592`,
`packages/compiler/src/runtime/application.ts:489`). That is a deployment-layer
concern — a SIGTERM handler calling `close()` — and the accepted lifecycle
paragraph already describes exactly that.

So the code is right and the command list overreached. BETA-09 records the
projection correction; the public document moves after `PASS`, per the design
branch.

## The design-system gap, named precisely

Owner direction is to build on the shadcn and Base UI primitives already in the
QUESTPIE design system. Verified state: `apps/studio/src/index.ts` is a one-line
stub; the system lives in `apps/docs` at shadcn style `base-mira` with phosphor
icons (`apps/docs/components.json`) on `@base-ui/react ^1.0.0`
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
