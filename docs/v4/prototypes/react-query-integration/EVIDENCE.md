# Finite native Query / watch seam

Status: partial Product-interface proof, 2026-09-08. Not formal acceptance,
generated-client parity, a browser tracer, or the finished React integration.

## Result

The candidate passes 10 tests and 32 assertions against native Query Core
5.102.8. A fetch completes at the first snapshot while active observers keep one
watch and receive later complete replacements. The tested paths cover shared
observation, last unsubscribe, disable/re-enable, pre-initial cancellation,
native cache removal, terminal denial, synchronous failure during opening,
retained options after retirement, and replacement-generation cancellation.
An omitted field disappears on a complete update without relying on reset
metadata. No optimistic layer participates in that test.

These tests control a watch-shaped external peer; they do not execute a generated
client, server Policy, PostgreSQL or React. The synthetic Task result and supplied
key are test inputs, not application authoring requirements. Native DataTag keeps
the result type on the returned key; compiler-derived identity and declared-error
types remain unproved. Early terminal failure can reject native fetch with its
cancellation error; exact public Query failure translation remains R1 work.

## Red / green evidence

The first test failed against the unimplemented seam. Each subsequent lifetime
case exposed a specific defect before its fix: premature watch close, retained
data after disposal, missing disable/re-enable ownership, absent terminal-error
handling, leaked synchronous-open stop handle, pending fetch after unsubscribe,
and active watch surviving native cache removal.

The rapid-generation test initially used a fixed microtask count, which was too
timing-sensitive. It now waits on the actual second fetch settlement. As a
negative control, removing only the generation guard from final cleanup made
that focused test time out at 1,000 ms. Restoring the guard passed the complete
suite. The control was reverted; no known failing variant is retained.

## Reproduce independently

Copy this directory outside the monorepo and use the committed lockfile:

```sh
bun install --ignore-scripts --frozen-lockfile
bun run test
bun run types:check
```

The isolated run used Bun 1.3.14 and TypeScript 6.0.2. Both package scripts exited
zero. The strict type configuration uses the repository's skipLibCheck policy;
it does not claim to validate all upstream declaration internals. The first
ad-hoc typecheck without that policy also reported upstream Bun declaration
errors; those are not described as repaired here.

Repository formatting and scoped lint with the proof worktree's explicit config
passed. An initial lint invocation from the sibling worktree failed config-root
resolution; the corrected invocation selected the intended config rather than
weakening rules. Local Markdown links, the packet secret scanner and
`git diff --check` are checked before committing this slice.

## Next blocking work

R1 must establish compiler-supplied canonical keys, error types, owner identity
and reserved-options semantics. This prototype assumes one options owner per
supplied key; it is not a scope registry. User-provided placeholder data,
optimism, custom serializers or retry overrides are outside its tested contract.
R2 still needs real generated transport, React/browser lifecycle and complete
credential retirement. R3 still needs Task detail plus board, Mutation outcome,
pending overlays and PostgreSQL observation races. The fresh-watch causal
candidate has not been accepted or proved by these tests.
