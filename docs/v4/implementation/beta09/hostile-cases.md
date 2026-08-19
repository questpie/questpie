# BETA-09: the hostile-case inventory

For each of BETA-09's six named hostile cases: what it must assert, the exact
assertion that fails against unrepaired code, and — for two of them — the
finding that the case as written names a mechanism this base does not have.

BETA-08 needed four review rounds, and three consecutive BETA-07 rounds shipped
a test that proved something other than what it claimed. The rule that closed
both is that every repair is falsified against the unrepaired code and the
failing assertion is recorded with it. This record does that work up front.

This record decides. It opens no slice branch and writes no production code.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## 1. Foreign Principal

**Asserts:** a Principal that Collection Policy denies for a Message cannot
learn that Message, its body, or its existence through any operational read for
a run that touched it.

**Falsification against unrepaired code:** passes in the caller's favour on
every read. There is no inspection Authority to deny with, and `inspect(runId)`
returns `result_bytes` — the Reaction's encoded result, bounded only at 262144
bytes — with nothing filtering it. The assertion that the foreign Principal
receives no result body fails because it receives the whole body.

This is the same defect as the prescribed red test; the red test is its sharper
form because it fixes the comparison to _the equivalent generated Operation_
rather than to a general expectation. Drive both; they fail for one reason and
must be repaired by one change.

## 2. Redacted envelope

**Finding: structurally satisfied already, and the risk is not where the case
points.**

The Execution Envelope's event union is closed and carries no free field: two
families, `runtime` with four kinds and `operation` with three kinds plus an
operation name (`packages/runtime/src/application/events.ts:27`–`:34`).
`traceId`, `causationId`, and `tenantRef` are typed as literal `null`, and no
redaction pass exists anywhere in `packages/runtime` — both verified.

**But "no field a payload could occupy" was overstated, and correcting it gives
the case content.** The event _union_ is closed. The _envelope wrapping it_ is
not: it carries four caller-supplied free-form strings —
`correlationId: string` (`events.ts:12`), `actor.principalRef: string | null`
(`:15`), `links[].id: string` (`:21`), and the `operation` name in the operation
family (`:33`).

What fills them today are identities rather than payloads. `correlationId`
falls back to a per-process `runtime:<sequence>` value, `principalRef` comes
from the Principal, and `links[].id` from artifact and operation identities.
So the practical risk is low — but it is low _because of what writes those
fields_, not because the type forbids anything.

So the disposition changes. An assertion that the envelope carries no secret is
**narrow rather than vacuous**: it does not test the closed union, which cannot
carry one, but it does test that the four free-form fields are filled by
identities. Written that way it has content; written as "the envelope is closed"
it asserts something the type does not say.

An earlier revision of this section concluded the case was structurally
satisfied and proved nothing. That followed from the overstatement rather than
from the tree.

**What the case must actually assert:** that Studio renders no envelope lane as
if it were retained history. The envelope has no store at all, so a lane
showing "recent Executions" would be inventing a record.

**Falsification:** none available against the current tree, because no Studio
exists to draw the lane. This becomes a contract assertion over the inspection
projection — that it exposes no envelope-history read — and must be written so
it fails if such a read is later added. Recorded as the weakest of the six, and
deliberately not dressed up as stronger.

## 3. CLI/Studio canonical byte parity from independent producers

**Finding: there is no CLI at this base, so the case as written cannot be
driven.**

`questpie explain` is accepted authority — ADR-0014:58, ADR-0019:52, and
`docs/v4/implementation-gates.md:429` all reference it — and no implementation
exists. `packages/` contains `compiler`, `questpie`, `runtime`, and `testkit`;
no package declares a `bin`. There is no second producer to compare against.

**The reframing, and why it is faithful rather than convenient:** the point of
the case is that two _independent_ producers of the same canonical bytes must
agree, which guards against Studio inventing its own projection instead of
reading the compiled one. BETA-09's own required-artifact list names an
"independent Studio projection producer" as its first artifact. So the two
producers are the compiler's artifact and that producer — provided "independent"
means it derives from canonical bytes rather than sharing the compiler's
in-process objects.

**Asserts:** the Studio projection producer, given the same compiled input,
emits canonical bytes identical to the compiler's artifact.

**Falsification:** if the producer is built by reaching into the compiler's
in-process structures, a deliberate divergence introduced in one path is
invisible to the other and the parity assertion passes while proving nothing.
The test must therefore be constructed so that mutating the artifact bytes
alone makes it fail.

**Disclosure for the record:** BETA-09 does not build `questpie explain`, and
the accepted contract still names it. That gap outlives this slice and belongs
in its narrower-claims list.

## 4. Stale build

**Asserts:** a run pinned to a retired executable digest is explained — Studio
says why it is not progressing.

**Falsification against unrepaired code:** the run is indistinguishable from a
healthy one. A claim whose executable digest no longer matches returns
`EXECUTABLE_RETIRED` from inside a transaction that has performed only a
`SELECT ... FOR UPDATE SKIP LOCKED`, and **writes nothing**. The worker counts
the refusal in memory. So the run sits at `state = 'ready'` with an append-only
history containing only `accepted`, and the assertion that its history explains
the stall fails because the history is silent.

The repair is not necessarily a durable write — joining the run's
`executable_digest` to the loaded projection explains it without one, which is
the cheaper path and is what `studio-purpose.md` already relies on. The
assertion should therefore be on _the explanation Studio produces_, not on the
presence of an event, or it will force a schema change that the case does not
require.

**Reachability gap, found after this case was written and worth stating before
someone drives it.** The case says Studio explains the run. Studio cannot
currently reach it. The run sits at `state = 'ready'`; the inspection surface is
four `runId`-keyed reads plus one worklist (`inspection-contract.md` D3); and the
worklist as decided is keyed on `state = 'failed'` (`studio-purpose.md`), which
this run is not. `studio-purpose.md`'s own counter-finding is that **`runId` is
not obtainable through any shipped API** — that is why the worklist exists at
all. So nothing lists a stuck `ready` run and nothing yields its identity.

**This matters because the test will pass anyway.** A fixture knows the `runId`
it created, so an assertion driven as `inspect(thatRunId)` proves the projection
explains a run whose identity was handed to it — not that an operator can find
one. That is the shape this project keeps blocking rounds for: a test proving
something other than what it claims.

**Decision: scope the assertion, do not widen the surface here.** Drive case 4
as "given a run's identity, the projection explains why it is not progressing",
and say in the test what it does not prove. Widening the worklist to cover
non-progressing `ready` and expired-lease `running` rows is the real fix, it is
cheap on the same indexes, and it belongs to whichever slice owns the progress
bound — the same disposition `studio-purpose.md` records and the same one
`docs/v4/prototypes/durable-evidence-gaps/FINDING.md` §5 argues for. What would
overturn it: that slice landing first, in which case case 4 should assert the
operator path end to end rather than from a known identity.

## 5. Maintenance Authority denial

**Asserts:** a caller without maintenance Authority is refused, the refusal is
typed, and the attempt is recorded in the append-only audit.

**Falsification against unrepaired code:** the command applies. `actorOf`
checks only `principalKernel.is(actor)`
(`packages/runtime/src/durable/postgres-maintenance.ts:130`) — a brand proving
the value came from the application's own module, not a decision about this
actor and this run. Any branded Principal succeeds, so an assertion that the
outcome is a denial fails because the outcome is `applied`.

**This case forces an addition the v5 record did not list.** The rejection
union has six members and none of them is an Authority denial
(`postgres-maintenance.ts:20`), and `durable_command_rejection_known` admits
exactly those six (`internal-protocol-v4-sql.ts:232`). If a denial is to be
audited — and it must be, since the audit's purpose is that every attempt is
recorded, applied or rejected — then `AUTHORITY_DENIED` joins both the union
and the CHECK alongside `REASON_INVALID`. `internal-protocol-v5.md` is amended
accordingly.

Auditing a denial records the denied caller's identity against a run they
cannot see. That is correct: the audit is not visible to them, and an audit
that omits rejected attempts is exactly the artifact this slice is trying not
to ship.

## 6. Typed concurrent command winner

**Asserts:** two concurrent maintenance commands against one run elect exactly
one winner through Studio's surface, and the loser receives a typed
`VERSION_MISMATCH` carrying the run's current version.

**Falsification against unrepaired code:** the single-winner half already
holds — BETA-08 drives it at the kernel, fencing on `event_sequence`. The half
that fails is the loser's payload. `DurableMaintenanceOutcome` returns
`commandId`, `outcome`, `rejectionCode`, `stateBefore`, and `stateAfter`, and
**not** the current version (`postgres-maintenance.ts:28`). An assertion that
the loser can re-issue from what it received fails, because it must call
`inspect()` again — a second round trip and a second chance to race.

Take care that this test proves the Studio surface rather than re-proving the
kernel. BETA-08 already owns single-winner election; the new content here is
that the property survives the projection, and that the loser is handed enough
to act.

## What this inventory changes elsewhere

- `internal-protocol-v5.md` gains `AUTHORITY_DENIED` alongside `REASON_INVALID`
  in both the rejection union and the CHECK. Amended in the same commit.
- Case 3 adds an entry to the slice's narrower-claims list: BETA-09 does not
  build `questpie explain`, which accepted authority names in three places.
- Case 2 is disclosed as the weakest of the six. It is not strengthened by
  rewording, and pretending otherwise is the failure mode BETA-07 hit three
  times.
