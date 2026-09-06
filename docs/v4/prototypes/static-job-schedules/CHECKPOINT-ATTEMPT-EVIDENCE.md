# Checkpoint attempt control-flow evidence

This page preserves the prototype's historical results. Its executable owner
and tests have been removed after porting the cases to the candidate Runtime:
[attempt admission and joining](../../../../tests/unit/checkpoint-attempt-owner.test.ts)
and [codec capture and references](../../../../tests/unit/checkpoint-run-boundary.test.ts).
The Runtime owns codec capture; no `structuredClone` checkpoint model remains.
The commands below describe the historical checkout, not the current tree.
ADR-0043 remains Proposed.

This is a proof-only coordinator for Proposed ADR-0043, not a public Job
Context, durable store, or acceptance record. `checkpoint-attempt.ts` owns only
one attempt's command cursor, in-flight work, failure state, and final join.
Its private adapter owns reservation, named Mutation invocation, and completion.
The coordinator stores no Mutation result across attempts.

## Executed proof

Each behavior was added through RED/GREEN. Initial absence failed import;
subsequent tests exposed caught-error successful settlement, concurrent
dispatch, incomplete/truncated settlement, missing cancellation, and overflow.
Independent review then exposed two further failures: a forgotten step could
outlive `finish`, and author input mutation could change the command after
reservation. Both were reproduced before repair.

`finish()` now closes admission, dooms an unresolved attempt, and joins all
owned work before reporting its outcome. Mutation promises have immediate
rejection ownership even when the handler forgets to await them. The original
promise still rejects for its caller, and `finish` retains the first failure.
A detached command snapshot is captured synchronously before the first await.

```text
bun test docs/v4/prototypes/static-job-schedules/checkpoint-attempt.test.ts
17 pass, 0 fail, 53 assertions
bun run --bun tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json
exit 0
```

Focused repository formatting, warning-denying lint, and `git diff --check`
also pass. Tests cover reserve/invoke/complete failure, concurrent calls at each
stage, undefined rejection, first-failure retention, early/truncated settlement,
observed cancellation, closed admission, the proposed 64-command cap, invalid
history lengths, forgotten-promise joining, and nested author-input mutation.
Final independent review also caught cancellation being replaced by a synthetic
incomplete-step error. The exact-identity race was demonstrated RED and repaired:
`finish` latches an existing abort before synthesizing its own failure, while
still joining pending work. The focused proof-only rereview passes.

A test-only deadlock occurred when a Bun rejection matcher waited before the
test released its deferred promise. The exact owned test process was stopped;
the test now attaches an ordinary promise handler before release. It created no
database resources. The corrected suite completes normally.

## Limits and integration ownership

The tests use controlled adapters to falsify ordering and lifetime behavior.
They do not prove PostgreSQL history uniqueness, lease fencing, authorization,
result receipts, generated types, or worker terminal settlement. The separate
`checkpoint.test.ts` exercises the real Mutation and Durable kernels.

`structuredClone` detaches this proof's command data from author aliases; it
is not a compiler decoder, immutable artifact proof, or a way to clone branded
public Mutation references. Production must resolve references and validate/
canonically encode input with the existing Mutation codec before producing its
private command. The adapters must not mutate the owned snapshot. Codec-rich
inputs, forged references, and artifact cross-pins still need generated proof.

Joining does not roll back a Mutation that was already dispatched. The
production worker must await this join before terminal settlement and cleanup,
and its existing bounded execution/transaction owner must cancel or settle
pending adapter work. This coordinator adds no timeout, retry loop, or second
authorization mechanism. A failure is local to this Physical Attempt; a new
attempt must reload durable history and replay through the same executor.
