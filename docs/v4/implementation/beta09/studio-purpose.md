# BETA-09: what Studio is for

Decides the purpose question `maintenance-decisions.md` defers to this file.
Settled by adversarial review: two agents argued opposing framings, each
required to ground claims in `file:line` and to name where its own position was
weakest. Both reports were verified against the tree before anything here was
written; two of their findings correct `design-context.md`, and those
corrections land in the same commit.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The decision

**Studio's job is _explain, then act_.**

- **The address space is identity-first.** The entrance is an identity resolver
  plus flat authorized catalogs of the compiled contract.
- **Every destination is decision-first, not facts-first.** Arriving at an
  identity surfaces the decision it enables and the authorized command that
  acts on it — never a tile wall.
- **One bounded worklist of runs that need a human** exists as a panel reachable
  from the entrance. It is not the front door.

The owner's steer — that the research handoff is not user-friendly enough and
lacks a real purpose — is honoured by the second and third points. The
handoff's six-to-eight facts-only Overview tiles (`OPEN-DECISIONS.md` Q5) do
not survive. Its canonical-identity depth does, and becomes the destination.

## Why the entrance cannot be a symptom

This is the finding that decides it, and it is not a matter of taste.

**The operational lane has exactly one durable symptom source: `durable_runs`.**
Everything else an incident-first entrance would enter from does not durably
exist at this base:

| Candidate symptom             | Durable trace                                                                                                                                                                                      | Verified at                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A failed Query execution      | **none.** There is no query receipt, log, or execution table                                                                                                                                       | —                                                                                     |
| A failed Mutation             | **none.** `CHECK (outcome IN ('executing','committed'))` admits no failure, and the receipt is inserted inside the Mutation's own transaction, so a pre-commit failure rolls back its own evidence | `packages/compiler/src/schema/postgres/internal-protocol-v2.ts:38`                    |
| An Execution error            | **none stored.** `durability: "telemetry"`, an optional in-process sink, with `traceId`, `causationId`, and `tenantRef` typed as hardcoded `null` and a per-process sequence counter               | `packages/runtime/src/application/events.ts:1`–`:34`                                  |
| A Live Query reset            | **~30 seconds.** `reset_reason` lives on `realtime_binding_generations`, which is hard-deleted rather than tombstoned, under a CHECK-pinned 30-second scope TTL                                    | `internal-protocol-v3-realtime.ts:169`, `:43`; `postgres-realtime-generations.ts:129` |
| A change nobody can explain   | **no attribution.** `change_ledger` carries no correlation, causation, call, principal, or tenant column                                                                                           | `internal-protocol-v3.ts:29`                                                          |
| A failed or dead-lettered run | **yes**                                                                                                                                                                                            | `durable_runs`                                                                        |

A symptom-first front door would therefore be a filtered view of one table.
That is a panel, and it is built below. It is not an entrance.

Meanwhile the compiled lane is complete and self-enumerating: `manifest.json`,
`policy-projection.json`, `query-projection.json`, `relational-explain.json`,
`relational-nondisclosure.json`, `committed-migrations.json`,
`reaction-projection.json` and the rest are files the Runtime already holds and
already digest-verified at startup
(`packages/runtime/src/application/artifact-files.ts:22`). An identity-first
entrance needs no new read to be complete; a symptom-first one needs several
that do not exist.

## The counter-finding, which is why the worklist exists

The opposing argument produced one fact that the identity-first position cannot
answer on its own: **`runId` is not obtainable through any shipped API.**

- All four durable reads take `runId` alone: `inspect`, `events`, effects
  `read`, and `audit`.
- `admit(batch)` is the only multi-row **read** of `durable_runs`
  (`packages/runtime/src/durable/postgres-kernel.ts:455`). `reapCancelled`
  (`:407`) also spans multiple rows, but it is a write and its predicate
  excludes terminal states too, so neither surfaces a failed run. `admit`'s
  predicate
  structurally excludes every state an operator cares about — it returns only
  runs eligible for claiming, never `failed`, `succeeded`, `cancelled`, or
  dead-lettered. It is the opposite of a symptom feed.
- `durableRunIdentity(dispatchId)` is deterministic
  (`packages/runtime/src/durable/acceptance.ts:18`) but is not exported from
  the package root (`packages/runtime/src/index.ts`).

So a purely identity-first Studio would ship a Reactions section whose detail
pages nothing can navigate to. That is the same "field no source populates"
failure BETA-08's first round was blocked for, one level up.

**The bridge is one bounded read, and it needs no schema.**
`durable_runs_claim_idx` is `(application_name, state, available_at, run_id)`
(`internal-protocol-v4-sql.ts:98`), whose leftmost prefix `(application_name,
state)` already serves `WHERE application_name = $1 AND state = 'failed' ORDER
BY available_at, run_id` as an index scan. Both opposing teams identified this
index independently. One read method over an index that already exists is the
cheapest correction that makes the durable kernel reachable at all.

Constraints on it, each forced:

- **First N with `hasMore`, never a count.** A total is a scan.
- **Not tenant-keyed.** `tenant_id` is in no index; see the correction in
  `design-context.md`. Tenant is displayed and authorized on, not driven from.
- **Inspection Authority evaluated at the entrance, not the leaf.** A list
  leaks the existence of runs, so the Authority decision `design-context.md`
  assigns to this slice becomes the first thing evaluated rather than the last.

## Jobs, traced

### Answerable: "this run is stuck — is retrying safe?"

The flagship, and it terminates in an action.

`inspect(runId)` reports `state`, `failureCode`, `deadLetter`, and `version`.
`EFFECT_AMBIGUOUS` is a permanent failure code, so the run is terminal and
dead-lettered with no retry pending. Effects `read(runId)` returns the
ambiguous effect with `receipt: null` — and null receipt is _forced_ for
`ambiguous` by `durable_effect_settled_shape`
(`internal-protocol-v4-sql.ts:188`), so the unknown provider outcome is a
schema guarantee rather than an inference. `audit(runId)` shows whether someone
already tried. The action is two fenced steps: `acknowledgeAmbiguity`, then
`retryRun`, both bound to `version`.

This is the job that justifies the whole slice, and it is exactly the job
`maintenance-decisions.md` warns Studio must not get wrong by offering
`retryRun` as the remedy for ambiguity.

### Answerable, and it proves explanation is primary: "why is this run stuck?"

A run whose executable was retired sits at `state = 'ready'` with a history
that says only `accepted`. The refusal writes **nothing** — the claim returns
`EXECUTABLE_RETIRED` from inside a transaction that has performed only a
`SELECT ... FOR UPDATE SKIP LOCKED` (`postgres-kernel.ts:513`), and the worker
counts it in memory.

So the durable log cannot explain it. The only witness is the compiled
contract: `durable_runs.executable_digest` against the loaded Reaction's
`contractDigest`, resolved through the executable artifact's origin. **Durable
facts without the compiled contract are uninterpretable**, which is the
strongest possible argument for the entrance chosen here.

This also stands as a finding in its own right: a retired-executable run is
invisible in the durable history, and any screen claiming to explain a stuck
run must join to the contract to do it.

### Answerable: "the Mutation committed — what happened to its Reaction?"

Pure function, no lookup: `callId` → canonical bytes → `dispatchId` →
`durableRunIdentity(dispatchId)` → `runId` → `effectIdentity(application,
runId, effectName)`. Every hop is a deterministic digest
(`packages/runtime/src/durable/acceptance.ts:18`,
`packages/runtime/src/durable/rows.ts:170`), and every landing is a primary
key. The identities are handed to the user by the system — `callId` rides the
wire response — rather than memorised.

Two disclosures are missing to make it usable: there is no public read of
`mutation_call_receipts` outside the idempotency-conflict branch, and
`durableRunIdentity` is not exported. Both are disclosures of already-durable,
already-indexed facts, not new mechanisms.

### Not answerable — recorded as findings, not deferred

- **"Which subscriptions did this deploy reset?"** No source. Reset history
  survives ~30 seconds. This kills the handoff's Q5 reset tile.
- **"Show me recent Executions / trace this correlation id."** No source. The
  Execution Envelope is unstored telemetry with hardcoded-null trace, causation
  and tenant references — `correlationId` itself is populated, so it is the
  missing store and not a null correlation
  fields. Gate 8 already requires that missing telemetry stay explicit, so
  Studio must say so rather than render an empty lane.
- **"Who changed this row and why?"** No source. The Change Ledger carries no
  caller attribution.
- **"Who cancelled what today?"** No source at acceptable cost.
  `durable_maintenance_commands_run_idx` is `(application_name, run_id,
requested_at)` (`internal-protocol-v4-sql.ts:246`) — `run_id` is second, so a
  time-ordered global feed is a sequential scan. The audit is answerable per
  run, which is how the accepted contract frames it.

## What this costs

One read method on the durable surface, over an existing index. Two
disclosures of existing facts. No schema for any of it — the internal protocol
v5 this slice owns is for the maintenance reason
(`maintenance-decisions.md`), not for the worklist.

Against that: four named lanes the screens must **not** draw, because nothing
populates them. Naming them here is the point. BETA-08's first round was
blocked for pinning what nothing enforces; the Studio equivalent is a view
model field no source fills, and the four above are exactly where that would
have happened.
