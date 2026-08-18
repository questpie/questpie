# Three accepted durable properties that no test drives

BETA-08 was accepted with twelve review observations. Auditing them against the
tree closed one, refuted one, found one part stale, and **confirmed three** —
all of the same shape: a property declared in a criterion, implemented in code,
and asserted by nothing.

This record converts those three into falsifications, because the lesson the
same audit produced is that reading settles candidates and only breaking
settles enforcement. Each entry says what to break, what must then fail, and
what the test proves that a reading cannot.

It writes no code and opens no slice. The gaps belong to whoever next touches
the durable surface.

Base: `feat/v4` at `c0b133b5`.

## 1. The effect fence

**Claimed.** Criterion 4: "every heartbeat, terminal transition, and effect
write compares the current attempt and the lease token."

**Built.** `packages/runtime/src/durable/postgres-effects.ts:86` —
`SELECT 1 AS held FROM questpie_internal.durable_runs WHERE application_name = $1
AND run_id = $2 AND current_attempt_id = $3 AND lease_token_digest = $4`.

**Driven by nothing.** All five `"fenced"` assertions in
`tests/integration/postgres/beta08-durable-kernel.test.ts` are kernel surfaces —
`succeed`, `fail`, `cancel`, `heartbeat` at `:160`–`:179`, and the
`succeed`-versus-`cancel` race at `:344`. `DurableLeaseLost` appears in no test.

**The falsification.** Take a claim, let the lease expire, let another worker
claim it, then invoke an effect on the _stale_ claim. Assert the ledger refuses
it. Break it by deleting `AND current_attempt_id = $3 AND lease_token_digest =
$4` from `:88`; the test must then show the stale holder reserving or settling
an effect the fresh holder owns.

**What only the test can prove.** That two attempts cannot both drive one
effect identity. The reading proves the predicate is present, not that it is
reached — and the ledger's own `fenced` status is returned from three separate
call sites.

## 2. The maintenance brand refusal

**Claimed.** That maintenance commands take a trusted `Principal` rather than a
caller-supplied identity pair.

**Built.** `postgres-maintenance.ts:130` — `actorOf` throws
`"durable maintenance requires a trusted Principal"` unless
`principalKernel.is(actor)`.

**Driven by nothing.** The only test matching that string is
`tests/integration/beta03-execution-services.test.ts:450`, which passes a cast
value into a _runtime execution_ and trips the Execution root's own brand check.
Same message, different file, different code path.

**The falsification.** Call a maintenance command with a plain object shaped
like a `Principal`. Assert it throws. Break it by removing the
`principalKernel.is` guard; the command must then accept the impostor and write
its `kind`/`id` into the audit.

**What only the test can prove.** That the brand is load-bearing rather than
decorative. Note the qualifier in
`docs/v4/implementation/beta09/maintenance-decisions.md`: with no wire route,
the only caller is in-process and mints its own `Principal`, so this test proves
the guard works and not that anything adversarial is stopped.

## 3. The `cancellationRequested` event

**Claimed.** Criterion 16: "every declared event kind is appended." The kind is
declared at `packages/compiler/src/reaction/durable-kernel.ts:83`.

**Built.** `postgres-maintenance.ts:263` appends
`claimed ? "cancellationRequested" : "cancelled"`, so the kind is reached only
when the run is currently claimed.

**Driven by nothing.** Event kinds are asserted from `events()` at
`beta08-durable-kernel.test.ts:204`, `:308`, and `:812`, and this kind appears
in none of them. The two `cancellationRequested` hits at `:340` and `:745`
assert the **field** on `inspect()`, not the **kind** in the history.

**The falsification.** Cancel a run while it is claimed, then read `events()`
and assert `cancellationRequested` is among the kinds. Break it by flipping the
ternary at `:267` to append `"cancelled"` unconditionally; the assertion must
then fail.

**What only the test can prove.** That the claimed and unclaimed cancellation
paths append _different_ kinds. The field on `inspect()` is true in both cases,
so asserting it distinguishes nothing.

## Why these three and not the other nine

The audit's outcomes are recorded in `HANDOFF.md` beside the #295 verification
entries. One observation was explained and closed, one was refuted outright,
and one carried-forward list turned out to be part stale. Those needed reading.
These three needed breaking, and that is the whole distinction the lesson
records.

## All three are constructible today

A falsification nobody can build is worse than none, so each was checked against
the existing harness and test patterns rather than left as a description.

`Beta08Harness`
(`tests/integration/postgres/helpers/beta08-durable.ts:140`) already exposes
`kernel`, `ledger`, `maintenance`, and `kernelWith`. Nothing new is needed.

| Spec                       | Extends                                                                          | What is already there                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, effect fence            | kernel test 1 plus the cross-attempt effect test                                 | `claimAfterLeaseExpiry` (`:78`) produces the stale/fresh claim pair, and `createDurableRunHandle` is already used with two different claims at `:603` and `:628`. Build a handle from the **crashed** claim rather than the fresh one and invoke an effect. |
| 2, brand refusal           | any maintenance test                                                             | `prepared.maintenance` is the published surface. Pass a plain object shaped like a `Principal` instead of `prepared.principal`.                                                                                                                             |
| 3, `cancellationRequested` | kernel test 1's claimed run, plus the `events()` reads at `:204`, `:308`, `:812` | Cancel while the run is **claimed**, then assert the kind is among those returned.                                                                                                                                                                          |

So each is a variation on a test that exists, not a new harness. Spec 1 is the
one with real content — it needs the stale claim to reach the ledger rather than
the kernel, which is precisely the path nothing currently drives.

One caveat worth stating before someone starts. Spec 2 proves the guard fires;
it cannot prove anything adversarial is stopped, for the reason recorded in
`docs/v4/implementation/beta09/maintenance-decisions.md` — with no wire route the
only caller is in-process and mints its own `Principal`. Write the assertion, and
write down which half it proves.
