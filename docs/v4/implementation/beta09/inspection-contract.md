# BETA-09: the inspection surface and how nondisclosure is proven

Decides what Policy-protected inspection BETA-09 exposes, what each read
returns, and how the prescribed red test is answered by something stronger than
a hand-written assertion.

The red test: _Studio can disclose a hidden Message or internal payload not
available through the equivalent generated Operation._

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Two lanes, and only one of them is closed

**Application data** flows through ordinary generated Operations and ordinary
Collection Policy. If Studio has no second path to rows, disclosure equivalence
is definitional — there is nothing to diverge from.

**Operational facts** — runs, events, effects, the maintenance audit — are not
Collection rows. No Collection Policy covers them. They are read through four
methods that today evaluate no Authority whatsoever:

| Read    | Signature                                                        | Where                                                     |
| ------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| run     | `inspect(runId): Promise<DurableRunView \| null>`                | `packages/runtime/src/durable/postgres-kernel.ts:244`     |
| history | `events(runId): Promise<readonly DurableRunEventView[]>`         | `postgres-kernel.ts:245`                                  |
| effects | `read(runId): Promise<readonly DurableEffectView[]>`             | `packages/runtime/src/durable/postgres-effects.ts:53`     |
| audit   | `audit(runId): Promise<readonly DurableMaintenanceAuditEntry[]>` | `packages/runtime/src/durable/postgres-maintenance.ts:81` |

**So the red test bites on the operational lane, not the application lane.**
Driving it against application data proves a tautology. The honest version
asks whether a caller can learn from a run, an event, an effect, or an audit
entry something the equivalent generated Operation would have denied them.

## What the compiler already proves, and the finding underneath it

The application lane is not merely closed by argument. The compiler emits a
per-query, machine-readable nondisclosure contract,
`relational-nondisclosure.json` (`packages/compiler/src/artifacts.ts:453`,
projected by `packages/compiler/src/relational/nondisclosure.ts:82`). Its shape
is a closed set of disclosure commitments per query
(`nondisclosure.ts:3`–`:28`):

- `keyedLookup.disclosure: "outcomeOnly"` with outcomes `authorized: "found"`
  and `unavailable: "notFound"` — a keyed lookup discloses only whether the
  caller may have it, never why not.
- `countOracle: "absent"` — no count can be used as an existence oracle.
- `page.rows: "authorizedBaseOnly"` and the same for the `first + 1` sentinel,
  so the pagination sentinel cannot leak the existence of a denied next row.
- `relation.missing: null` and `relation.policyInvisible: null` — a missing
  relation and a Policy-invisible one are the same value, so they cannot be
  told apart.
- `selectedFieldDenied: "omitProperty"` — a denied Field is absent, not null.

This is the right shape and it is already built. **The finding is that nothing
consumes it.** `relational-nondisclosure.json` appears in `packages/compiler`
and nowhere in `packages/runtime`. The runtime verifies eight artifacts by
semantic digest — `runtime-executables.json`, `operation-contracts.json`,
`wire-contract.json`, `reaction-projection.json`, `durable-kernel.json`,
`realtime-wire-contract.json`, `change-ledger.json`, and
`live-query-resume.json` (`packages/runtime/src/application/artifact-files.ts:53`–`:133`)
— and the nondisclosure projection is not among them. It is a proof no one
checks at startup and no code reads at run time.

## Decisions

### D1 — the operational lane gets the same kind of artifact

BETA-09 compiles an operational nondisclosure projection with the same
commitment shape as the relational one, covering the four reads and the run
worklist. Concretely it must commit, per read:

- **absence and denial are one value.** `inspect` already returns
  `DurableRunView | null` (`postgres-kernel.ts:244`), so the shape exists; the
  commitment is that an unauthorized caller receives the same `null` a missing
  run produces.
- **no count oracle**, matching `countOracle: "absent"`. The worklist returns
  first-N-with-`hasMore` and never a total. This is already required by
  `studio-purpose.md` on cost grounds; here it is required again on disclosure
  grounds, which is a stronger reason.
- **the list discloses no run the caller could not `inspect` individually.**
  A worklist is an enumeration, and enumeration is the classic way a
  per-identity guard is defeated in aggregate.
- **event payload commitments.** `durable_run_events` carries a closed
  `error_code` enum and no free text
  (`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:145`,
  `:150`), so this commitment is cheap to make and already true — but it must be
  _stated_, because the maintenance reason this slice adds
  (`maintenance-decisions.md`) is the first operator-authored free text to enter
  the durable record, and it will be readable through `audit`.

Why an artifact rather than tests alone: BETA-08's review found repeatedly that
a passing test can assert something other than what it claims. A compiled
commitment that the runtime verifies by digest cannot drift from the code
silently, and a reviewer can read it without reading the tests.

**Judgment call, stated as one.** Nothing in accepted authority requires an
operational nondisclosure artifact; the accepted contract requires the
_property_, not this mechanism. I am choosing it because the mechanism already
exists for the neighbouring lane and because BETA-08's four rounds showed
hand-written proof is the weak link. What would overturn it: if the operational
reads turn out to have so few disclosure degrees of freedom that the artifact is
a constant, then it is ceremony and a driven hostile case is enough.

### D2 — `relational-nondisclosure.json` gains runtime verification

It joins the eight artifacts verified by semantic digest at startup. A
nondisclosure proof that nothing checks is not a proof. This is a small,
independent correction and it does not depend on D1.

### D3 — the inspection surface is exactly the four reads plus one worklist

No new read shapes. Every one is Policy-protected by an **evaluated inspection
Authority**, distinct from maintenance Authority per `maintenance-decisions.md`
Q3. The worklist is the single addition `studio-purpose.md` decided, keyed on
`(application_name, state)` against the existing `durable_runs_claim_idx`.

Adding read shapes beyond these is how an inspection surface becomes the
internal-table CRUD the issue names as a non-goal.

### D4 — the red test is driven on the operational lane

The hostile case constructs a caller who is denied the equivalent generated
Operation for a Message, then attempts each of the five operational reads for a
run that touched that Message, and asserts that none of them discloses the
Message, its payload, or its existence. Falsify it first against the
unauthorized code — where today every read returns everything to anyone holding
the object — and record the exact assertion that fails.

That falsification is trivially available right now, which is the point: at
this base the red test _passes in the wrong direction_, because there is no
Authority to deny with.

## What the operational reads may safely return

Grounded in what the columns actually hold:

- **Run**: state, attempt count, dead-letter flag, failure code, version,
  Resource, and Tenant. Identities and codes, no payload.
- **History**: sequence, timestamp, Resource, dispatch, run, attempt,
  lease-token digest, causation, correlation, kind, and the closed error code.
  The accepted contract already forbids raw payload, credential, secret, and
  stack trace here, and the schema enforces the closed code.
- **Effects**: effect name, status, and receipt. `receipt IS NULL` is _forced_
  for `ambiguous` by `durable_effect_settled_shape`
  (`internal-protocol-v4-sql.ts:188`), which is what makes "is retrying safe"
  answerable rather than a guess.
- **Audit**: command, outcome, rejection code, actor, state before and after,
  requested-at — plus the bounded reason this slice adds. The reason is
  operator-authored free text and is therefore the one field in the whole
  operational lane that can carry something a nondisclosure commitment must
  actively bound rather than merely observe.

## Correction carried from this work

`design-context.md` says the application lane is "closed by construction." That
remains true, but it undersold the evidence: the compiler already emits a
per-query nondisclosure contract for it. The weakness is not the lane, it is
that the contract is unverified — recorded as D2 above rather than restated
there.
