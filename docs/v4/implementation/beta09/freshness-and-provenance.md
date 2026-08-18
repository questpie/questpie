# BETA-09: freshness, and why it becomes provenance

The research handoff proposes "four-source freshness" as one of its Overview
tiles (`OPEN-DECISIONS.md` Q5) and leaves the thresholds to a later decision
(its Q7). This record settles both by checking what each source can actually
report at this base.

The answer is that the tile cannot be built honestly, and the thing that
replaces it is better.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

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
