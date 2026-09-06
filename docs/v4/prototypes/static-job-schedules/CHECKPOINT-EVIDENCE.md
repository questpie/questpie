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
canonical command digest separately binds the Mutation identity, codec-encoded
input digest, contract digest, and Runtime Graph digest. The current tracer
uses the generated input codec with nested timestamps and optional text. Raw
JSON hashing was falsified by a real committed receipt that completion could
not locate; the codec repair and expanded proof are recorded below.

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

Raw receipt lookup is used only by fenced checkpoint completion to bind the
receipt; it never returns a Mutation result. The low-level proof primitive
still permits raw completion and is not suitable for Job authoring. The added
`checkpoint-invocation.ts` composition owns reservation, generated invocation,
and completion without exposing completion through its caller interface. The
test now routes denied recovery and successful successor recovery through that
owner. The initial commit-before-completion window deliberately still uses the
low-level primitive. Production must bind this composition inside the generated
Job execution, not expose either proof factory to authors.

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

The canonical worktree subsequently ran all five current proof suites together
on PostgreSQL 17: activation, calendar, PostgreSQL calendar oracle, attempt
control, and this checkpoint integration. Result: 46 passed, 0 failed, 0 skipped,
180 assertions. The shared strict TypeScript project now includes these files
and the DOM library used by the imported production Runtime. Warning-denying
lint, formatting, and `git diff --check` pass. A final SELECT-only cleanup audit
found no remaining `qp_pin_`/`qp_checkpoint_` databases or `qp_schedule_proof_`
schemas. The existing PostgreSQL container and preview were preserved.

## Deliberate limits

This slice does not prove or implement the public Job Context projection,
generated checkpoint types or artifact decoders, the production checkpoint
schema/statements, Action
steps, sleep, signals, child work, schedules, receipt retention changes,
observation, or release readiness. It also does not exercise a second
concurrent in-flight PostgreSQL reservation or a separate Operation-admission
denial. Lease expiry simulates the recovery boundary; it is not an
operating-system process-kill tracer. The synthetic checkpoint completion
adapter is not proof that production Job acceptance, Context construction, or
checkpoint compilation already exists.

## Codec and invocation-owner extension

The disposable application now replaces only its copied `message.publish`
source with `checkpoint-publish.fixture.ts` and recompiles before loading the
generated Runtime. Its input adds nested `metadata.at: timestamp` and optional
`metadata.note: text`; no canonical fixture or generated file is edited.
The test reads the new Mutation input descriptor and executable pins from that
compilation. The fixture does not add a Collection or a second write kernel.

The first semantic RED reached a real Mutation commit and exact replay but
checkpoint completion returned `receiptUnavailable` instead of `completed`:
0 pass, 1 fail, 14 assertions. The previous raw JSON input digest could not
identify the timestamp-bearing receipt. Decode/encode through the existing
Runtime codec before canonical hashing made the same tracer pass (1/18).
A missing transitive Collection Issue mapping was corrected before this RED;
that initial compiler setup error was not semantic evidence.

The next RED was the absent invocation module. The composition now binds one
compiled Mutation to an inert attempt-local reference and the existing attempt
coordinator. Reference identity is checked before snapshotting. The coordinator
detaches the input before any await; the owner retains codec-encoded values and
gives the generated Mutation separately decoded Date objects. Later caller
changes cannot alter the reservation, dispatch, or completion command.
The caller cannot supply an Operation identity, executable digest, Call Identity,
or a completion callback.

The expanded PostgreSQL tracer checks:

- denied Context replay leaves the existing receipt committed and checkpoint
  reserved; catching the error permits neither another reservation nor success;
- successor recovery returns the exact original result even when the caller
  changes the input body and Date immediately after starting the step;
- malformed optional input fails before reservation, with the same safe
  `PROTOCOL_UNSUPPORTED` class as direct execution;
- forged, borrowed, and callable references fail before reservation;
- a real declared `AFTER_WRITE_REJECTED` failure after a successful Collection
  create rolls back that write, leaves no receipt, retains its error object
  through caught-error doom, and cannot dispatch step two;
- a UTF-8 input exceeding the existing 1 MiB Mutation bound is rejected before
  history allocation; two valid sequential commands complete distinct writes
  and ordered history, with optional input both present and absent.

The malformed-input check produced another semantic RED: direct execution
returned `PROTOCOL_UNSUPPORTED`, but the owner exposed `RuntimeCodecError`
with a field path (0/1, 24 assertions). The owner now uses the existing safe
Operation failure class for codec failures. An exploratory fixture using
unavailable `codec.json()` was rejected by compilation and removed; it proves
no JSON capability or JSON snapshot behavior.

This remains a one-Mutation proof composition, not the generated nested
reference projection. The caller supplies a trusted binding and history length;
the compiler/worker must eventually own and validate both. Handwritten test
types describe the loaded generated executor; they are not generated Job type
evidence. Arbitrary codec/prototype combinations, artifact tampering, exact
checkpoint failure projection, cancellation during real dispatch, worker
terminal settlement, process kill, and retained-receipt corruption remain open.
Attempt-model tests do not substitute for those integrated cases.

Current deterministic run (Bun 1.3.14, PostgreSQL 17, process-only connection
environment):

```sh
bun test docs/v4/prototypes/static-job-schedules/activation.test.ts \
  docs/v4/prototypes/static-job-schedules/calendar.test.ts \
  docs/v4/prototypes/static-job-schedules/calendar-postgres.test.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint-attempt.test.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint.test.ts
bunx --no-install tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json
bun run lint -- --deny-warnings \
  docs/v4/prototypes/static-job-schedules/checkpoint.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint.test.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint-invocation.ts \
  docs/v4/prototypes/static-job-schedules/checkpoint-publish.fixture.ts
git diff --check
```

The five suites pass: 46 tests, 213 assertions, zero failures or skips (8.31 s).
The checkpoint tracer accounts for 50 assertions. Strict proof types and
warning-denying lint pass. The authored fixture is compiled in the disposable
application, not included in the proof's standalone TypeScript project.
No production export, public authority, package version, or release artifact
changed; the previous release gates are not claimed as rerun for this proof.

Independent Standards review found no hard violation. Its one nonblocking
maintainability observation is that the mutable captured command relies on the
coordinator's single-in-flight invariant; production integration should carry
the prepared command explicitly rather than widening that assumption.

Independent Spec review found no blocker for the narrowed composition. It
correctly distinguished the original missing-channel failure from rollback of
an already successful write. A replacement control first failed with a committed
message instead of the expected declared error (0/1, 36 assertions). The
disposable fixture now awaits Collection creation and then throws its own
unmapped `AFTER_WRITE_REJECTED` error. The test requires that exact error, zero
matching business rows, zero receipts, reserved history, and caught-error doom.
The full green result above includes that control. Neither review is formal
acceptance of ADR-0043.

Both reviewers rechecked the rollback-control follow-up: the Spec qualification
is closed, and Standards found no new hard issue. After integration, the
canonical `feat/v4` worktree reran the five suites with the same 46 tests / 213
assertions and no skips (10.14 s), plus strict types and warning-denying lint.
