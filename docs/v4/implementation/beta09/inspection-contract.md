# BETA-09 inspection contract and the red test

Decides what Policy-protected inspection Operations BETA-09 exposes, what each
returns, and how nondisclosure equivalence is proven against the prescribed red
test. Companion to `design-context.md`, `maintenance-decisions.md`, and
`studio-purpose.md`.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The prescribed red test already passes on the shipped surface

> Studio can disclose a hidden Message or internal payload not available
> through the equivalent generated Operation.

It passes today, through a path nobody has had to look for.

**`inspect(runId)` returns `resultBytes`** — the Reaction's encoded result, up
to 262,144 bytes. The projection selects it explicitly
(`packages/runtime/src/durable/postgres-kernel.ts:692`) and hands it back
unmodified (`:717`). It is written by `succeed()` (`:654`), stored on
`durable_runs.result_bytes` (`internal-protocol-v4-sql.ts:41`), and bounded
only by size (`:63`).

Nothing filters it. A Reaction declares an output codec, but a codec is a shape
contract, not an authorization filter. If a handler returns a Message body, a
recipient address, or any other application value, `inspect()` discloses that
value to every caller who can reach the durable surface — bypassing the
Collection output Field Policy that governs the same data through its ordinary
Query.

**`effects(runId)` returns `receipt` raw** — provider-supplied external text,
bounded at 256 characters (`internal-protocol-v4-sql.ts:184`) and returned
unmodified by `effectView` (`packages/runtime/src/durable/postgres-effects.ts:61`).
A provider receipt is not application data, but it is external data the
application never authored and never had a chance to classify.

**The asymmetry is the tell.** `inspect()` deliberately does _not_ select
`payload_bytes` — the Reaction _input_, stored on the same row and bounded the
same way (`internal-protocol-v4-sql.ts:25`, `:60`). Someone was careful about
the input and not about the result. That looks unintentional rather than
decided, which is exactly why it should be decided here.

## Two lanes need two proofs

**Application data** flows through ordinary generated Operations and Collection
Policy. ADR-0014 fixes this: "Studio reads application data through ordinary
generated Operations and Policy." If Studio opens no second path to data, the
equivalence the red test asks about is definitional rather than something to
test into existence.

That lane already carries a compiler-produced nondisclosure proof.
`relational-nondisclosure.json` (`packages/compiler/src/artifacts.ts:453`,
produced by `packages/compiler/src/relational/nondisclosure.ts`) pins a precise
vocabulary per Query:

- keyed lookups disclose `outcomeOnly`, mapping authorized to `found` and
  unavailable to `notFound`;
- `countOracle: "absent"`;
- pages return `authorizedBaseOnly` rows, including the first-plus-one
  sentinel;
- a missing relation and a policy-invisible relation both project `null`, so
  they are indistinguishable;
- a denied selected Field is `omitProperty` — omitted, not nulled.

**Operational facts** — runs, events, effects, the maintenance audit — are not
Collection rows. Collection Policy does not reach them. They have their own
evaluated inspection Authority, and at this base they have **no nondisclosure
proof of any kind**.

That asymmetry is the whole finding: the lane with a compiler-verified
disclosure contract is the safe one, and the lane with none is the one shipping
raw payloads.

## Decision: what the inspection projection returns

BETA-09 exposes the operational lane through inspection Operations whose
projection is strictly narrower than the kernel's internal read. The kernel
methods stay as they are — the worker needs `resultBytes` to exist — but
nothing Studio can reach returns them.

| Kernel read      | Inspection projection returns                                                                                                                           | Removed                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect(runId)` | run, dispatch, Resource, state, attempt count, current attempt, cancellation-requested, dead-letter, failure code, availability, terminal time, version | **`resultBytes`** — replaced by presence, byte length, and a digest                                                                             |
| `events(runId)`  | sequence, timestamp, Resource, dispatch, run, attempt, lease-token digest, causation, correlation, kind, safe error code                                | nothing; the event union is already safe by construction and CHECK-constrained to a closed `error_code` set (`internal-protocol-v4-sql.ts:150`) |
| `effects(runId)` | effect name, effect identity, status, receipt presence                                                                                                  | **`receipt`** — replaced by presence                                                                                                            |
| `audit(runId)`   | command, outcome, rejection code, actor, state before and after, requested-at, and the bounded reason once internal protocol v5 lands                   | nothing further                                                                                                                                 |

**Why presence rather than redaction.** A truncated or masked payload is still
a payload path, and it invites a later change that widens it. Presence plus
length plus digest answers every operational question the result is actually
needed for — did it succeed, how large was it, is it the same result the
receipt refers to — without ever moving the bytes.

**Where the result becomes visible.** Through an ordinary Policy-protected
Query the application chose to write, which is what ADR-0014 already requires.
An application that wants a Reaction result in Studio exposes it as data,
under the Policy that governs that data. The framework does not decide that
the durable kernel is a disclosure channel.

**The judgment call, stated as one.** Removing `receipt` from the operational
projection costs a real diagnostic: an operator settling an ambiguity would
like to see what the provider said. The trade is taken because a receipt is
unclassified external text — the application never authored it and never had a
chance to say whether it carries a recipient, a token, or a customer
identifier. What would overturn it: a receipt contract that constrains the text
to a declared safe shape, at which point disclosure becomes a decision the
application makes rather than one the framework makes for it.

## The artifact: `operational-nondisclosure.json`

BETA-09 produces the operational lane's equivalent of
`relational-nondisclosure.json`, digested into the Runtime Build like every
other artifact, and pinned by a compile-level test.

It states, per inspection Operation, the same class of facts the relational
projection states per Query:

- which fields the projection returns, as an exact closed list;
- that `resultBytes` and `receipt` are absent, named explicitly rather than
  merely missing, so a later widening is a visible diff in a digested artifact;
- the unauthorized outcome vocabulary, matching the relational lane's
  `outcomeOnly` shape: a caller without inspection Authority cannot distinguish
  a denied run from a nonexistent one;
- that no listing surface exposes a count, matching `countOracle: "absent"`.

Making absence an _asserted_ property rather than an implementation detail is
the point. BETA-08's first round was blocked for pinning what nothing enforces;
this is the inverse discipline — enforcing what the contract already claims,
and pinning the enforcement where a regression shows up as a digest change.

## Driving and falsifying the red test

The red test must fail for the real reason before anything is built.

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
exact assertion in the evidence, per the discipline carried from BETA-08 —
three consecutive BETA-07 rounds shipped tests proving something other than
what they claimed, and the guard against that is falsifying every repair
against the unrepaired code.

**The second hostile case**, from the issue's own list: a foreign Principal.
A caller without inspection Authority receives the same outcome for a run that
exists and a run that does not. This is where inspection Authority is
evaluated, and per `studio-purpose.md` it is evaluated at the entrance — the
bounded worklist — not only at the leaf, because a list leaks existence.

## What this does not settle

The maintenance Authority evaluation itself — who may cancel, retry, or
acknowledge — is a separate decision from who may read, per
`maintenance-decisions.md` Q3. This record fixes the read side and the
disclosure proof. The command side inherits the same two-Authority split and
the same denial-specificity rule.
