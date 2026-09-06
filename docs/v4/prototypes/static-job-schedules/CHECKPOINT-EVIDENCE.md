# Minimum Mutation checkpoint falsification evidence

Status: proof scaffold; not production code, product authority, acceptance, or a
formal PASS.

This slice asks one narrow question from Proposed ADR-0043: can a Job retry use
the real generated named-Mutation executor and its existing receipt after the
Mutation commits but before a separately fenced checkpoint completion, without
copying the Mutation result or repeating the application write?

## Seam under test

`checkpoint.ts` adds proof-only PostgreSQL checkpoint storage and three private
operations: reserve, complete, and inspect. Reservation derives one stable Call
Identity from the Durable Run plus ordered checkpoint name and ordinal. The
canonical command digest separately binds the Mutation identity, the proof's
raw canonical-JSON input digest, contract digest, and Runtime Graph digest. For
this fixture, the Mutation input contains only codec-preserved strings, so that
raw digest agrees with the generated codec representation. This prototype does
not prove general codec-first normalization or byte agreement.

Both history mutations execute the production Durable attempt fence. Completion
requires the exact committed receipt locator retained by the checkpoint:
application, tenant, Operation, Principal, Call Identity, and input digest. It
stores only the receipt transaction identity. The proof schema has no result
bytes column and is explicitly not a proposed production migration.

`checkpoint.test.ts` creates a unique, CREATE-owned PostgreSQL database. It
compiles and loads the Collaboration generated application, accepts and claims
a real Job, and calls the real generated `message.publish` Mutation. It leaves
the checkpoint reserved after that Mutation commits, expires the first lease,
reclaims through the production Durable kernel, invokes the same generated
Mutation with the stable Call Identity, and completes under the successor
fence. The original holder is then rejected as stale.

The assertions require exactly one business row, one Mutation receipt for the
stable Call Identity, one checkpoint row, and no copied result column. Cleanup
closes all owned clients and drops only the database whose CREATE succeeded;
test and cleanup failures are aggregated.

## Authority characterization

The generated executor performs fresh Context resolution and Operation
admission before receipt lookup. The test revokes Membership and requires exact
replay to fail with the Context-owned `{ code: "notFound", resource: "tenant" }`
shape while the committed write remains.

Current Accepted Mutation receipt behavior returns the originally authorized,
immutable result on exact replay without rerunning the handler or Collection
Policy. The test characterizes this explicitly: after restoring valid Context
but demoting the caller to a role denied by the Collection Field Policy, exact
Call Identity replay succeeds, while the identical Mutation input under a fresh
Call Identity is denied through the declared
`{ code: "CHANNEL_UNAVAILABLE", status: 404 }` mapping. This is evidence
against interpreting Proposed ADR-0043 as a promise to rerun Collection Policy
on an existing receipt.

The test orchestration always calls the generated Mutation executor before
checkpoint completion. Raw receipt lookup is used only by fenced checkpoint
completion to bind the receipt; it never returns a Mutation result. The
low-level exported proof primitive does not itself prove that its caller just
performed an authorized generated invocation: a caller could invoke `complete`
after a denied replay while an earlier committed receipt exists. Production
therefore still requires an uncallable executor-owned composition boundary
that invokes the Mutation and completes the checkpoint as one framework
operation without exposing raw completion to Job code.

## TDD and deterministic checks

The initial focused test was written before `checkpoint.ts` existed:

```text
bun test docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
error: Cannot find module "./checkpoint"
0 pass, 1 fail, 1 error
```

After the proof scaffold was added, the following non-PostgreSQL checks passed:

```text
bun run format -- docs/v4/prototypes/static-job-schedules/checkpoint.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
bun run lint -- docs/v4/prototypes/static-job-schedules/checkpoint.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
bunx tsc --noEmit --strict --skipLibCheck --target ESNext \
  --module Preserve --moduleResolution Bundler --types bun \
  docs/v4/prototypes/static-job-schedules/checkpoint.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
git diff --check
```

The focused test imports cleanly without PostgreSQL configuration but skips.
That skip is not evidence.

The first live PostgreSQL 17 run reached reservation and exposed an ambiguous
ordinal parameter (`SQLSTATE 42P08`, integer versus `smallint`; 0 pass, 1 fail,
3 assertions). This was a proof-scaffold SQL typing/setup failure, not a
semantic falsification. The CREATE-owned database cleanup completed. The
reservation statement now casts that bind to `smallint` consistently.

The fresh live PostgreSQL 17 rerun passed:

```text
bun test /home/drepkovsky/code/questpie-v4-static-schedule-checkpoint-proof/docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
1 pass, 17 assertions, 0 fail (4.92 s)
```

This is focused executable evidence only. It is not formal acceptance or proof
that a production checkpoint implementation exists.

## Deliberate limits

This slice does not prove or implement the public Job Context projection,
generated checkpoint types or artifact decoders, the production checkpoint
schema/statements, codec-aware normalized command snapshot, uncallable
executor/completion owner, attempt-local doom, declared-error behavior, Action
steps, sleep, signals, child work, schedules, receipt retention changes,
observation, or release readiness. It also does not exercise a second
concurrent in-flight reservation, ordinal two, or a separate Operation-admission
denial. Lease expiry simulates the recovery boundary; it is not an
operating-system process-kill tracer. The synthetic checkpoint completion
adapter is not proof that production Job acceptance, Context construction, or
checkpoint compilation already exists.
