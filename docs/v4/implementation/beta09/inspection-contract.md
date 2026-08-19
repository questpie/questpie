# BETA-09: the inspection surface and how nondisclosure is proven

Decides what Policy-protected inspection Operations BETA-09 exposes, what each
returns, and how nondisclosure equivalence is proven against the prescribed red
test.

This record merges two concurrent work ticks that reached the same file from
different directions. One established that the compiler already emits a
nondisclosure contract for the application lane and that no code reads it;
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
Policy, as ADR-0014 requires. Disclosure equivalence is definitional there, and
driving the red test on that lane proves a tautology.

_Precision added after the fact, and it does not change the disposition._ An
earlier revision said "with no second path to rows". There is a second statement
that reaches rows: the keyed row lock a Mutation issues before its Policy read —
`SELECT TRUE AS "qp_locked" FROM <table> WHERE <key predicates> LIMIT 1
FOR UPDATE` (`packages/compiler/src/mutation/postgres.ts:138`), whose predicates
come from `operation.keyFields` alone (`:72`–`:75`), with Policy applied only in
the following read (lifecycle `["keyedRowLock", "freshPolicyRead", …]`, `:131`–`:136`).

It is not a disclosure path. It projects a constant rather than columns, and its
result is never branched on beyond a `length > 1` sanity check
(`packages/runtime/src/mutation/collection.ts:253`). What remains is a timing
channel: the lock is a bare `FOR UPDATE`, so it blocks on a row held by another
transaction and returns at once on an absent one, which a caller who cannot see
the row could time. That is a weaker claim than a second read path, it is out of
scope for this contract, and it is recorded so the sentence is not read as
stronger than the tree supports. The red test still belongs on the operational
lane.

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

**The finding is that no code reads the artifact.** It is not unverified: the
build inventory covers every generated file except `runtime-build.json` and
`internal/checksums.json` (`packages/compiler/src/runtime/index.ts:378`), and
startup sha256-verifies every inventory entry
(`packages/runtime/src/application/artifact-files.ts:16`–`:28`). For canonical
bytes that is stricter than a semantic digest. An earlier revision said nothing
consumed it, which was wrong. What is true is narrower: nothing _consults_ its
commitments.
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

BETA-09 pins these commitments into a digested contract and a compile-level
test. It states, per inspection Operation, the same class of facts the
relational projection states per query:

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

**Where they landed, checked against the branch rather than assumed.** An
earlier revision of this section said BETA-09 "produces
`operational-nondisclosure.json`". Nothing produces that file — it is named in
no compiler source on `feat/v4` or on `feat/v4-beta-09`, while every other
artifact this record set cites (`relational-nondisclosure.json` at
`packages/compiler/src/artifacts.ts:453`, `durable-kernel.json`,
`reaction-projection.json`, `wire-contract.json`) is emitted by one.

The branch put the commitments inside the contract that already exists:
`durableKernelContract.nondisclosure`, a seven-field block on
`feat/v4-beta-09`'s `packages/compiler/src/reaction/durable-kernel.ts` (type at
`:37`–`:45`, values at `:152`), asserted by
`tests/unit/beta09-operational-nondisclosure.test.ts`. `feat/v4`'s copy of that
file has no `nondisclosure` at all, so this is new work on the branch rather
than something the record misread.

**That is the better shape and the record now asks for the property instead.**
The durable kernel contract is already digested into the Runtime Build, so the
commitments inherit the digest that a separate file would have had to
manufacture — the branch's own test comment calls a standalone artifact "a
constant with a digest around it". Naming a filename in an acceptance criterion
over-specified the mechanism. What would overturn it: commitments that need to
be read by something other than the durable kernel, which would justify their
own artifact rather than a block inside that contract.

### D2 — `relational-nondisclosure.json` gains runtime verification

It joins the eight artifacts verified by semantic digest at startup. A
**Corrected:** it is already byte-verified through the inventory, so it does
not need a semantic digest, and an earlier revision of this decision rested on
the false premise that nothing checked it. What it lacks is a _reader_ — the
keyed-lookup commitment is independently enforced at
`packages/runtime/src/relational/postgres.ts:121`–`:130`, and the other four
have no equivalent. D2 is therefore narrowed to: give the remaining four
commitments an enforcement site, or drop the artifact's claim to be a proof.

**Independently corroborated, by a better method.** `feat/v4-beta-09` reached
the same conclusion at `c50b9dbc` without seeing this correction, and proved it
rather than re-reading it: the branch **tampered** with the artifact and
asserted the refusal, driving the real generated build so that one flipped
character inside the nondisclosure proof is rejected with a digest mismatch.

That is stronger evidence than the reading behind this section, and the record
should say so. It also names the original error's cause exactly — "reading for a
name instead of reading the code", since the artifact is verified by being in
`build.inventory` rather than by being mentioned in `artifact-files.ts`.

Worth carrying forward: two earlier attempts at that test failed on their own
synthetic inventories rather than on the claim, and driving the real artifact set
removed the fixture from the argument. That is the BETA-07 failure mode —
injecting a construct the production path never produces — caught before it
shipped rather than after three rounds.

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
| `events(runId)`  | sequence, kind, attempt, lease-token digest, safe error code — the five fields the kernel read already returns (`postgres-kernel.ts:112`, `:730`)       | nothing; already safe by construction, `error_code` CHECK-constrained to a closed set (`internal-protocol-v4-sql.ts:150`) |
| `effects(runId)` | effect name, effect identity, status, receipt presence                                                                                                  | **`receipt`** → presence                                                                                                  |
| `audit(runId)`   | command, outcome, rejection code, actor, state before and after, requested-at, and the bounded reason once internal protocol v5 lands                   | nothing further                                                                                                           |

**A correction to an earlier revision of this table.** It listed eleven fields
for `events(runId)` — sequence, timestamp, Resource, dispatch, run, attempt,
lease-token digest, causation, correlation, kind, error code. That is what
`durable_run_events` **stores** (`internal-protocol-v4-sql.ts:133`–`:145`), not
what `events()` **returns**. The shipped read selects five
(`packages/runtime/src/durable/postgres-kernel.ts:730`) into a five-field view
(`:112`–`:118`). Transplanting the accepted contract's description of the
stored row into a table about return values made the projection look _wider_
than the kernel read, which would have falsified this slice's own criterion
that the projection is strictly narrower. The store-versus-return distinction
is the thing to hold onto: `causation_id` and `correlation_id` are
application-supplied strings, and they stay unreturned.

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
