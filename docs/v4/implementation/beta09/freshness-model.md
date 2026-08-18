# BETA-09: what "fresh" can honestly mean

Decides the freshness model Studio displays, grounded only in what BETA-06,
BETA-07, and BETA-08 actually expose. Settles the design handoff's Q7 (who
defines when a source becomes stale, and do thresholds differ by source) and Q8
(how far back Studio can inspect).

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The finding: only one source can be stale

The research handoff models freshness as four-to-five peer sources, each with
its own staleness threshold and a shared "as of" vocabulary. Grounding that
against the tree does not survive contact.

**Exactly one source in the whole system reports a measurable lag.** The rest
either cannot drift, or have no global freshness concept at all. Presenting
them as peers with per-source thresholds would invent a comparison the data
does not support — the same class of error as a tile counting something nothing
enforces.

What each source can actually say:

| Source                  | Can it be stale?       | What it can honestly report                                       |
| ----------------------- | ---------------------- | ----------------------------------------------------------------- |
| Reconciliation frontier | **Yes, measurably**    | newest captured fact against each consumer's acknowledged horizon |
| Compiled build          | **No, not in-process** | verified-at-start, plus the residue below                         |
| Durable kernel          | **No global concept**  | per-run version only                                              |
| Maintenance audit       | **No global concept**  | per-run, ordered by `requested_at`                                |
| Execution Envelope      | **Reports nothing**    | must be declared absent                                           |
| Live Query resets       | **Current-only**       | ~30 seconds of history                                            |

## Source 1 — the reconciliation frontier, the only real lag

`reconciliation_consumers` stores `(application_name, consumer_id, xid_horizon,
acknowledged_at)` (`packages/compiler/src/schema/postgres/internal-protocol-v3.ts:49`).
The Change Ledger carries `fact_id bigint GENERATED ALWAYS AS IDENTITY`,
`transaction_id xid8`, and `captured_at` (`internal-protocol-v3.ts:29`–`:39`).

So the newest captured fact and each consumer's acknowledged position are both
durable, both readable, and comparable. That is a genuine lag: _this consumer
has acknowledged through transaction H, as of time T, while the ledger has
captured facts beyond it._

It is also the one threshold Studio does **not** invent. The ledger is pruned
below `min(xid_horizon)` across all consumers
(`packages/runtime/src/live-query/postgres-retention.ts:443`–`:449`), so a
lagging consumer is not merely behind — it is what holds retention open for
everyone. The operationally meaningful threshold is already implied by the
mechanism, and Studio should surface the consumer that is furthest behind
because that consumer is the one with a consequence attached.

**Decision.** This is the only source rendered with a lag. It shows the
trailing consumer, its horizon, its `acknowledged_at`, and the newest captured
fact. No percentage, no trend, no global health score.

## Source 2 — the compiled build, which cannot drift in-process

`verifyPostgresRuntimeReadiness` throws on any mismatch of committed migration
head, application binding, the migration receipt chain, or the live schema
fingerprint (`packages/compiler/src/runtime/postgres-readiness.ts:124`–`:196`).
A Runtime with drift does not start.

So on a running Runtime, "the build matches" is a precondition of the process
being alive, not a live measurement. Rendering it as a freshness signal that
could go stale would be theatre.

**Decision.** It is displayed as an identity with a verified-at timestamp —
_this build, verified at process start_ — never as a live check, and never with
a staleness threshold.

**The honest residue, recorded rather than hidden.** The schema fingerprint is
computed live, so drift introduced _after_ startup is real and unchecked.
Re-running that verification at inspection time would be a genuine signal. It
requires a re-verification path that nothing exposes today. Naming it here
prevents the more likely failure, which is a build tile that implies a live
check it never performs.

## Source 3 — the durable kernel has no global freshness

`durable_runs.event_sequence` is **per run** and CHECK-bounded to 0–1024
(`internal-protocol-v4-sql.ts:40`, `:59`). There is no application-wide
sequence, no global horizon, and no monotonic marker across runs. `admit()` is
the only multi-row read and returns only claimable work.

**Decision.** There is no "durable freshness" tile, because there is no source
for one. Freshness in this lane is per identity: a run reports its `version`,
which is exactly the value a maintenance command fences on. The worklist
reports its own query time and nothing more.

This is a deliberate refusal. A tile showing "durable lag" would have to invent
a number by aggregating `available_at` or counting states, and both are scans
that mean something other than lag.

## Source 4 — the maintenance audit is per run by construction

`durable_maintenance_commands_run_idx` is `(application_name, run_id,
requested_at)` (`internal-protocol-v4-sql.ts:246`) — `run_id` precedes the
timestamp, so a global time-ordered feed is a sequential scan. This matches the
conclusion already recorded in `studio-purpose.md`.

**Decision.** Audit freshness is per run: the most recent command on this run,
with its `requested_at`. No global "recent maintenance activity" surface.

## Declared absences

Gate 8 requires that "missing telemetry and partial Runtime availability remain
explicit." These are declared, not omitted:

- **The Execution Envelope reports nothing.** It is stamped
  `durability: "telemetry"` with an optional in-process sink, and `traceId`,
  `causationId`, and `tenantRef` are typed as hardcoded `null`
  (`packages/runtime/src/application/events.ts:1`–`:34`). Its sequence is a
  per-process counter. There is no store and no reader. Studio states this
  rather than rendering an empty lane that looks like a quiet system.
- **Live Query reset history is current-only.** Generations are hard-deleted
  (`packages/runtime/src/live-query/postgres-realtime-generations.ts:129`)
  under a CHECK-pinned 30-second scope TTL
  (`internal-protocol-v3-realtime.ts:16`, `:43`). The current reset reason for a
  currently live subscription is available; nothing older is.

## Q8 — how far back Studio can inspect

The answer differs per source, and Studio displays the actual bound each source
supplies rather than promising a retention length in copy.

- **Run history:** unbounded in time, bounded at 1024 events per run. No
  retention sweeper exists — there is no `DELETE` against any `durable_*` table
  anywhere in the tree. BETA-08 dropped the retention block precisely because
  nothing enforced it, and nothing enforces it now. Studio must not imply a
  window here; there is none, and that is itself worth showing.
- **Change Ledger:** back to `min(xid_horizon)` across consumers, which moves
  as consumers acknowledge.
- **Realtime:** approximately 30 seconds.
- **Maintenance audit:** as long as the run row, by foreign key.

**Decision on default framing.** Cursor pages with no totals, matching
`countOracle: "absent"` in the application lane. Each surface states the bound
its own source supplies. No copy anywhere promises a retention duration.

## Q7 answered

_Who defines when a source becomes stale, and do thresholds differ by source?_

Neither Studio nor the operator defines it, because only one source has a
staleness concept at all. The reconciliation frontier's threshold is implied by
the retention it holds open; the build cannot be stale in-process; the durable
and audit lanes have per-identity as-of values rather than freshness; and two
sources are declared absent.

**So the model is not four peer sources with four thresholds. It is one lag,
one verified-at identity, two per-identity as-of values, and two declared
absences.** That is less symmetrical than the handoff's design and it is what
the data supports.

## Judgment calls

**Refusing a durable freshness tile** is a judgment call. It costs an operator
the at-a-glance sense of whether durable work is flowing. Taken because every
available aggregate means something other than lag, and a number that looks
like lag but is not is worse than no number. What would overturn it: a global
monotonic marker on the durable kernel — which BETA-09 does not own, and which
would be a kernel change rather than an inspection one.

**Surfacing the trailing consumer rather than an aggregate lag** is a judgment
call. It exposes consumer identities to anyone with inspection Authority.
Taken because the trailing consumer is the one with a consequence attached, and
an averaged lag hides exactly the consumer that matters. What would overturn
it: consumer ids turning out to carry tenant or customer information, in which
case the surface reports the horizon without naming who holds it.
