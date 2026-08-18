# BETA-09: freshness, and why it becomes provenance

The research handoff proposes "four-source freshness" as one of its Overview
tiles (`OPEN-DECISIONS.md` Q5) and leaves the thresholds to a later decision
(its Q7). This record settles both by checking what each source can actually
report at this base.

The answer is that the tile cannot be built honestly, and the thing that
replaces it is better.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## First, there are five sources, not four

The handoff's own data contract names five —
`artifact | runtime | receipt | envelope | audit`
(`DATA-CONTRACTS-AND-FIXTURES.md:12`) — while its Overview tile counts four.
The mismatch is inside the research bundle itself and is worth naming before
anything is built on either number.

## What each source can report

| Source   | Timestamp it holds                                                                  | Stored?                                                                                                         | Can it answer "how fresh?"                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| artifact | none — its identity _is_ the Runtime Build digest                                   | in the bundle, digest-verified at startup (`packages/runtime/src/application/artifact-files.ts:53`)             | **no, and it should not.** Pinned at startup; readiness fails on drift                                                                                                                                                             |
| runtime  | now                                                                                 | live process                                                                                                    | **trivially** — it is the observer, not an observed source                                                                                                                                                                         |
| receipt  | `committed_at` (`packages/compiler/src/schema/postgres/internal-protocol-v2.ts:33`) | yes, durable, never pruned                                                                                      | **no — unreachable.** No public read exists outside the idempotency-conflict branch                                                                                                                                                |
| envelope | `occurredAt`, stamped at emit (`packages/runtime/src/application/events.ts:69`)     | **no store of any kind.** `durability: "telemetry"` with an optional in-process sink whose throws are swallowed | **no.** There is nothing for a freshness figure to be relative to                                                                                                                                                                  |
| audit    | `requested_at`                                                                      | yes, append-only                                                                                                | **per run only.** `durable_maintenance_commands_run_idx` is `(application_name, run_id, requested_at)` (`internal-protocol-v4-sql.ts:246`), so `run_id` precedes the timestamp and a global time-ordered read is a sequential scan |

The durable run lane, which the handoff folds under `runtime`, does carry real
timestamps — `accepted_at` and `terminal_at` on runs
(`internal-protocol-v4-sql.ts:44`, `:45`) and `occurred_at` on events (`:137`).
Those are answerable **per identity**, on the same terms as the audit.

## The conflation that makes the tile impossible

"Freshness" is doing two jobs in the handoff, and they come apart here:

1. **Availability** — can I reach this source right now?
2. **Staleness** — how old is the newest fact it can show me?

For **artifact**, staleness is meaningless by design. The build is pinned at
startup and `verifyPostgresRuntimeReadiness` refuses to start on any mismatch,
so a running Runtime showing "artifact: fresh" is reporting a precondition of
its own existence. A staleness clock there is decoration.

For **envelope**, both are meaningless, because there is no store. You cannot
ask how stale an unstored stream is; you can only observe events as they occur
in-process, and only if a sink was supplied. Its `occurredAt` is stamped at emit
and immediately discarded.

For **receipt**, staleness is genuinely knowable — `committed_at` is durable and
never pruned — and the source is nonetheless unreachable, so the figure cannot
be produced.

For **audit** and the durable lane, staleness is knowable but only relative to
an identity you already hold. There is no cheap global "newest fact" without a
scan, and `studio-purpose.md` already forbids unbounded totals for the same
underlying reason.

So a four-or-five-clock freshness header would show one honest number
(`runtime`, which is just "now"), one tautology (`artifact`), two blanks
(`envelope`, `receipt`), and one figure that is only meaningful once you have
already navigated to a specific run. That is precisely the "field no source
populates" failure BETA-08's first round was blocked for.

## Decision: per-answer provenance, no global freshness header

**Every fact Studio renders carries the source that produced it, and — where
that source holds a timestamp for that fact — the timestamp.** There is no
Overview freshness tile and no global staleness clock.

Concretely:

- A run's state carries `source: durable` and the run's own `accepted_at` or
  `terminal_at`.
- A maintenance entry carries `source: audit` and its `requested_at`.
- A contract fact carries `source: artifact` and the Runtime Build identity —
  **not** a timestamp, because the identity is the stronger statement.
- A fact with no source is not rendered. This is the load-bearing half of the
  decision.

This keeps the handoff's genuinely good instinct — that Studio must never
present a joined view as if it were one authoritative record — while dropping
the mechanism that instinct was expressed through.

## Absence is rendered, not hidden

Gate 8 already requires that "missing telemetry and partial Runtime
availability remain explicit." The envelope is exactly that case, permanently
rather than transiently: it is not missing because something is down, it is
missing because nothing stores it.

So Studio states it. A lane that would have shown Execution history says that
Execution events are telemetry and are not retained, rather than rendering an
empty list that reads as "nothing happened." An empty list is a claim; "there
is no source" is the truth.

The same applies to Live Query reset history, which survives roughly thirty
seconds under a CHECK-pinned scope TTL and hard-deleted generations
(`design-context.md`), and to any receipt lane until a public read exists.

## The handoff's Q7 is answered by not needing it

Q7 asks who defines when a source becomes stale and whether thresholds differ
per source. With per-answer provenance there are no thresholds to define: a
timestamp is shown when it exists and means what it says, and a source that
cannot supply one says so instead. The question dissolves rather than being
settled.

## Judgment call, recorded as such

Dropping the freshness header is mine. Accepted authority requires that partial
availability stay explicit; it does not prescribe a header or forbid one.

I am choosing provenance because four of the five sources cannot honestly
populate a staleness figure at this base, and a header with one real number
teaches operators to trust a display that is mostly decoration.

What would overturn it: if the receipt lane gains a public read and the
Execution Envelope gains a store, three of the five sources become genuinely
clockable and a header starts carrying real information. Both are plausible
later slices. Neither is this one, and per-answer provenance remains correct
underneath a header if one is ever added — it is the more primitive of the two.

## The sixth source nobody enumerated, and the one real lag

Merged from a concurrent tick that reached this deliverable under a different
filename. It does not contradict the decision above; it sharpens it.

The handoff names five sources and the section above evaluates those five. The
Change Ledger's **reconciliation frontier** is not among them, and it is the
one place in the system where a genuine lag figure exists.

`reconciliation_consumers` stores `(application_name, consumer_id, xid_horizon,
acknowledged_at)`
(`packages/compiler/src/schema/postgres/internal-protocol-v3.ts:49`). The ledger
carries `fact_id bigint GENERATED ALWAYS AS IDENTITY`, `transaction_id xid8`,
and `captured_at` (`internal-protocol-v3.ts:29`–`:39`). Newest captured fact
against each consumer's acknowledged horizon is therefore a real, durable,
readable comparison: _this consumer has acknowledged through transaction H, as
of time T, while the ledger has captured beyond it._

It is also the one threshold Studio does not have to invent. The ledger is
pruned below `min(xid_horizon)` across all consumers
(`packages/runtime/src/live-query/postgres-retention.ts:443`–`:449`), so a
lagging consumer is not merely behind — it is what holds retention open for
everyone else. The consequence is already attached to the mechanism.

**This does not restore the freshness header.** One honest lag among six
sources is precisely the case the decision above rejects: a header carrying one
real number and five decorative ones. It is rendered as what it is — a fact
about the reconciliation frontier, carrying `source: ledger`, the trailing
consumer, its horizon, and its `acknowledged_at` — under the same per-answer
provenance rule as everything else.

**Judgment call:** surfacing the _trailing consumer_ rather than an averaged
lag exposes consumer identities to anyone holding inspection Authority. Taken
because the trailing consumer is the one with a consequence attached, and an
average hides exactly the consumer that matters. What would overturn it:
consumer ids turning out to carry tenant or customer information, in which case
the surface reports the horizon without naming who holds it.

## Q8 — how far back Studio can inspect

Also merged from that tick. The answer differs per source, and each surface
displays the bound its own source supplies rather than promising a retention
length in copy.

- **Run history and the maintenance audit:** unbounded in time. **No retention
  sweeper exists** — there is no `DELETE` against any `durable_*` table anywhere
  in `packages/`. The only such statements in the repository are negative
  controls in `tests/integration/postgres/beta08-internal-protocol.test.ts`,
  which assert the append-only guard refuses them. BETA-08 dropped the retention block precisely because
  nothing enforced it, and nothing enforces it now. The only bound is
  structural: `event_sequence` is CHECK-constrained to 0–1024 per run
  (`internal-protocol-v4-sql.ts:59`), so a run's history is capped in length,
  never in age.
- **Change Ledger:** back to `min(xid_horizon)`, which moves as consumers
  acknowledge.
- **Realtime:** no history. A superseded generation is deleted at once
  (`postgres-realtime-generations.ts:129`, whose predicate spares only the rows
  still holding `latest_slot` or `ack_slot`), and an idle scope is swept thirty
  seconds after its last renewal (`internal-protocol-v3-realtime.ts:43`). Only
  the current generation's reason is readable, and only while its binding
  lives.
- **Receipts:** never pruned, and currently unreachable.

Studio must not imply a retention window anywhere, because for the two lanes an
operator will look at most there is none. Cursor pages with no totals, matching
`countOracle: "absent"` in the application lane.
