# BETA-09: the inspection surface and how nondisclosure is proven

Decides what Policy-protected inspection Operations BETA-09 exposes, what each
returns, and how nondisclosure equivalence is proven against the prescribed red
test.

This record merges two concurrent work ticks that reached the same file from
different directions. One established that the compiler already emits a
nondisclosure contract for the application lane and that nothing consumes it;
the other found a live disclosure path in the shipped operational reads. Both
findings were re-verified against the tree before merging. Neither is
discarded.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Two lanes, and only one of them is closed

The prescribed red test is:

> Studio can disclose a hidden Message or internal payload not available
> through the equivalent generated Operation.

It bites on the operational lane, not the application one.

**Application data** flows through ordinary generated Operations and Collection
Policy, as ADR-0014 requires. With no second path to rows, disclosure
equivalence is definitional, and driving the red test there proves a tautology.

**Operational facts** — runs, events, effects, the maintenance audit — are not
Collection rows. No Collection Policy covers them. All four reads evaluate no
Authority whatsoever today. That is where the test has to bite, and it already
draws blood.

## The red test already passes on the shipped surface

**`inspect(runId)` returns `resultBytes`** — the Reaction's encoded result, up
to 262,144 bytes. The projection selects it explicitly
(`packages/runtime/src/durable/postgres-kernel.ts:692`) and returns it
unmodified (`:717`). It is written by `succeed()` (`:654`) onto
`durable_runs.result_bytes` (`internal-protocol-v4-sql.ts:41`) and bounded only
by size (`:63`).

Nothing filters it. A Reaction declares an output codec, but a codec is a shape
contract, not an authorization filter. If a handler returns a Message body, a
recipient address, or any other application value, `inspect()` discloses it to
every caller who reaches the durable surface — bypassing the Collection output
Field Policy that governs the same data through its ordinary Query.

**`effects(runId)` returns `receipt` raw** — provider-supplied external text,
bounded at 256 characters (`internal-protocol-v4-sql.ts:184`), returned
unmodified by `effectView`
(`packages/runtime/src/durable/postgres-effects.ts:61`).

**The asymmetry is the tell.** `inspect()` deliberately does _not_ select
`payload_bytes` — the Reaction _input_, on the same row, bounded the same way
(`internal-protocol-v4-sql.ts:25`, `:60`). Someone was careful about the input
and not about the result. That reads as an oversight rather than a decision,
which is why it is decided here.

## What the compiler already proves, and the finding underneath it

The application lane is not merely closed by argument. The compiler emits a
per-query, machine-readable nondisclosure contract,
`relational-nondisclosure.json` (`packages/compiler/src/artifacts.ts:453`,
projected by `packages/compiler/src/relational/nondisclosure.ts`). Its shape is
a closed set of disclosure commitments per query (`nondisclosure.ts:3`–`:28`):

- `keyedLookup.disclosure: "outcomeOnly"`, outcomes `authorized: "found"` and
  `unavailable: "notFound"` — a keyed lookup discloses only whether the caller
  may have it, never why not.
- `countOracle: "absent"` — no count usable as an existence oracle.
- `page.rows: "authorizedBaseOnly"`, and the same for the `first + 1` sentinel,
  so pagination cannot leak the existence of a denied next row.
- `relation.missing: null` and `relation.policyInvisible: null` — a missing
  relation and a Policy-invisible one are the same value.
- `selectedFieldDenied: "omitProperty"` — a denied Field is absent, not null.

**The finding is that nothing consumes the artifact.**
`relational-nondisclosure.json` appears nowhere in `packages/runtime`. The
runtime verifies eight artifacts by semantic digest at startup —
`runtime-executables.json`, `operation-contracts.json`, `wire-contract.json`,
`reaction-projection.json`, `durable-kernel.json`,
`realtime-wire-contract.json`, `change-ledger.json`, and
`live-query-resume.json`
(`packages/runtime/src/application/artifact-files.ts:53`–`:133`) — and the
nondisclosure projection is not among them.

One refinement, because the blunt version overstates it: the runtime is not
blind to nondisclosure semantics. `packages/runtime/src/relational/postgres.ts:121`–`:130`
structurally enforces the keyed-lookup commitment at execution time, rejecting
anything that is not exactly one row, exactly one column, and a value of
`found` or `notFound`. So one of the five commitments is independently enforced
at the point of use. The other four have no equivalent assertion.

That strengthens the case for verifying the artifact rather than weakening it:
the pattern of enforcing a disclosure commitment where it is used already
exists in the tree, so extending it is not a new idea.

## Decisions

### D1 — the operational lane gets the same kind of artifact

BETA-09 produces `operational-nondisclosure.json`, digested into the Runtime
Build like every other artifact and pinned by a compile-level test. It states,
per inspection Operation, the same class of facts the relational projection
states per query:

- the exact closed list of fields the projection returns;
- that `resultBytes` and `receipt` are absent — named explicitly rather than
  merely missing, so a later widening is a visible diff in a digested artifact;
- absence and denial as one value, so a caller without inspection Authority
  cannot distinguish a denied run from a nonexistent one;
- no count on any listing surface, matching `countOracle: "absent"`;
- no list disclosing a run the caller could not inspect individually.

Making absence an _asserted_ property rather than an implementation detail is
the point. BETA-08's first round was blocked for pinning what nothing enforces;
this is the inverse discipline — enforcing what the contract already claims,
where a regression surfaces as a digest change.

**This is a judgment call and is recorded as one.** Accepted authority requires
the disclosure _property_, not this _mechanism_. The artifact is chosen because
the mechanism already exists next door, and because BETA-08's four rounds
showed hand-written proof is the weak link. What would overturn it: if the
operational reads turn out to have so few disclosure degrees of freedom that
the artifact is a constant, in which case a test asserting the projection's
field list directly is the simpler equivalent.

### D2 — `relational-nondisclosure.json` gains runtime verification

It joins the eight artifacts verified by semantic digest at startup. A
nondisclosure proof that nothing checks is not a proof. Small, independent, and
does not depend on D1.

### D3 is falsified: "Policy-protected inspection Operations" is not authorable

D3 as written below says every read is "Policy-protected by an **evaluated
inspection Authority**". Implementing it found that neither Operation kind can
carry such a thing.

**A Query has no admission Policy at all.** `QueryFactory` accepts `name`,
`network`, `input`, `output`, and `handler`
(`packages/compiler/src/generate.ts:375`–`:386`), and the compiler validates a
`policy` member only when `kind === "mutation"`
(`packages/compiler/src/model.ts:241`). A Query's protection is entirely the
Collection Policy on the data it reads through `ctx.data`.

**A Mutation's admission Policy can only say `authenticated`**, which
`authority-mechanism.md` established for the maintenance axis.

So the root cause is one thing, and it explains both: **QUESTPIE's authorization
model is Collection-bound, and operational facts are not Collection rows.** A
run has no Collection, so no Policy reaches it, and an inspection Query
returning run state would be protected by nothing at all — reachable by any
caller the wire admits.

That is worse than the maintenance gap, because maintenance at least sits behind
a server-internal object. A `defineQuery` with `network: true` is on the wire.

**Consequence for this slice.** "Policy-protected inspection Operations" is one
of BETA-09's four required artifacts and it cannot be built as named. Combined
with the maintenance Authority finding, **two of the four are unauthorable at
this base for the same structural reason.**

What BETA-09 can honestly ship on this axis is what it has shipped: the
inspection _projection_, strictly narrower than the kernel read, so that
whatever reaches a reader carries no result body and no provider receipt; and
the independent projection producer over compiled artifacts, which are public
contract rather than operational fact and therefore raise no disclosure question
at all.

The operational reads stay server-internal, reachable through the application
object and never through the wire, on exactly the terms `authority-mechanism.md`
settled for maintenance. Disclosure equivalence then holds by construction —
not because a Policy enforces it, but because no wire Operation exposes the lane.
That is a weaker guarantee than D3 claimed and it is the true one.

### D3 — the inspection surface is exactly the four reads plus one worklist

`inspect`, `events`, `effects`, `audit`, plus the bounded run worklist
`studio-purpose.md` decided, keyed on `(application_name, state)` against the
existing `durable_runs_claim_idx`. Every one is Policy-protected by an
**evaluated inspection Authority**, distinct from maintenance Authority per
`maintenance-decisions.md` Q3.

Adding read shapes beyond these is how an inspection surface becomes the
internal-table CRUD the issue names as a non-goal.

### D4 — what the operational reads may safely return

The kernel methods stay as they are; the worker needs `resultBytes` to exist.
Nothing Studio can reach returns them.

| Kernel read      | Inspection projection returns                                                                                                                           | Removed                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `inspect(runId)` | run, dispatch, Resource, state, attempt count, current attempt, cancellation-requested, dead-letter, failure code, availability, terminal time, version | **`resultBytes`** → presence, byte length, digest                                                                         |
| `events(runId)`  | sequence, timestamp, Resource, dispatch, run, attempt, lease-token digest, causation, correlation, kind, safe error code                                | nothing; already safe by construction, `error_code` CHECK-constrained to a closed set (`internal-protocol-v4-sql.ts:150`) |
| `effects(runId)` | effect name, effect identity, status, receipt presence                                                                                                  | **`receipt`** → presence                                                                                                  |
| `audit(runId)`   | command, outcome, rejection code, actor, state before and after, requested-at, and the bounded reason once internal protocol v5 lands                   | nothing further                                                                                                           |

**Presence rather than redaction.** A truncated or masked payload is still a
payload path, and it invites a later change that widens it. Presence plus
length plus digest answers every operational question the result is needed for
— did it succeed, how large, is it the result this receipt refers to — without
moving the bytes.

**Where the result becomes visible:** through an ordinary Policy-protected
Query the application chose to write. An application that wants a Reaction
result in Studio exposes it as data, under the Policy that governs that data.
The framework does not decide that the durable kernel is a disclosure channel.

**The receipt removal is a judgment call.** It costs an operator settling an
ambiguity the ability to see what the provider actually said. Taken because a
receipt is unclassified external text the application never authored and never
had a chance to classify. What would overturn it: a receipt contract
constraining the text to a declared safe shape, making disclosure the
application's decision rather than the framework's.

## Driving and falsifying the red test

**Setup.** A Reaction whose result contains a Message field that the calling
Principal's Collection Policy denies on the equivalent Query. Two callers: one
holding inspection Authority, one not.

**The assertion.** The caller holding inspection Authority reads the run and
cannot obtain the denied field by any route the inspection surface offers. The
same caller reads the Message through its ordinary generated Query and receives
the field omitted, per `selectedFieldDenied: "omitProperty"`. The two agree.

**Falsification, which is the part that proves it.** Restore `resultBytes` to
the inspection projection and re-run. The test must fail with a named assertion
showing the denied field's value recovered from the run result. Record that
exact assertion, per the discipline carried from BETA-08: three consecutive
BETA-07 rounds shipped tests proving something other than what they claimed,
and falsifying every repair against the unrepaired code is the guard.

**The second hostile case**, from the issue's own list: a foreign Principal
receives the same outcome for a run that exists and one that does not.
Inspection Authority is evaluated at the entrance — the bounded worklist — not
only at the leaf, because a list leaks existence.

## Corrections carried from this work

`design-context.md` says the application lane is "closed by construction." That
remains true but undersold the evidence: the compiler already emits a per-query
nondisclosure contract for it. The weakness is not the lane, it is that the
contract is unverified — recorded as D2 rather than restated there.

## What this does not settle

The maintenance Authority evaluation itself — who may cancel, retry, or
acknowledge — is separate from who may read, per `maintenance-decisions.md` Q3.
This record fixes the read side and the disclosure proof. The command side
inherits the same two-Authority split and the same denial-specificity rule.
